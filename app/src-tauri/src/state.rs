// Turns hook and mod messages into what Blip shows.
//
// translate() reads one message and keeps only what matters for the state.
// Machine keeps one state per session; the most urgent session wins.

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

// How long "Done" stays up when the session's app was already in front and the
// user active (the quiet rule, DECISIONS 9 Nov). Otherwise Done stays until the x.
pub const DONE_FOR: f64 = 5.0;
// The session's app in front, with the user active, this long counts as checked.
const CHECK_AFTER: f64 = 2.0;
// A session whose app was not found (a failed ps, a process tree with no app)
// is looked up again after this many seconds, while Blip is awake anyway.
const APP_RETRY: f64 = 10.0;
// The project line is cut to this many characters.
const PROJECT_MAX: usize = 40;
// "Done" waits this long first: in the CLI, Esc sends Stop and the mod's "aborted"
// follows up to one inbox poll (100 ms) later. Until then Blip keeps showing Working.
const SETTLE: f64 = 0.2;

// Claude Code's own bookkeeping tools, not work the user cares about.
const IGNORED_TOOLS: [&str; 2] = ["mcp__ccd_turn__wrap_up", "mcp__ccd_turn__update_plan"];

// The snippet in Sprout's bubble: the first line of the message, at most this many characters.
const SNIPPET: usize = 100;

// Claude Code starts a turn by itself when a background task ends (Phase 0 test 18).
const SELF_STARTED: &str = "<task-notification>";

// How many ended sessions and earlier prompts to remember, so late events can be dropped.
const REMEMBER: usize = 64;

// Ordered from least to most urgent, so the highest one wins across sessions.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    #[default]
    Hidden,
    // Sprout peeking under the notch: a finished session not checked yet.
    Peek,
    Done,
    Working,
    Error,
    NeedsYou,
}

#[derive(Debug, PartialEq)]
pub struct Event {
    session: String,
    prompt: Option<String>,
    agent: Option<String>,
    // When it was sent, by the sender's clock: the mod's ts, or the hook's whole seconds.
    // Missing for hooks from sessions opened before 30 Oct; Blip's arrival time is used then.
    sent: Option<f64>,
    // The session's Claude process, to notice a session that died without SessionEnd.
    pid: Option<u32>,
    // How the turn ended, in words: the last reply (Stop) or the error (StopFailure).
    text: Option<String>,
    // Where the session works (hooks only), and the chat's title when it has one.
    cwd: Option<String>,
    title: Option<String>,
    kind: Kind,
}

#[derive(Debug, PartialEq)]
enum Kind {
    // true when Claude Code started the turn by itself.
    Prompt(bool),
    Tool,
    // A permission or a question waits for the user. Paired with its PostToolUse by
    // tool and input, since PermissionRequest carries no tool_use_id.
    Asks(Ask),
    ToolDone(Ask),
    SubagentEnd,
    TurnEnd(End),
    SessionEnd,
}

#[derive(Debug, PartialEq)]
struct Ask {
    tool: String,
    input: String,
    agent: Option<String>,
}

#[derive(Debug, PartialEq)]
enum End {
    Answer,
    Aborted,
    Error,
}

pub fn translate(src: &str, msg: &Value) -> Option<Event> {
    let text = |key: &str| msg.get(key).and_then(Value::as_str);
    match src {
        "hook" => {
            let tool = text("tool_name").unwrap_or_default();
            let agent = text("agent_id").map(str::to_string);
            let key = || {
                let mut input = msg.get("tool_input").cloned().unwrap_or_default();
                // The answered question comes back with the answers added to its input.
                if let Some(input) = input.as_object_mut().filter(|_| tool == "AskUserQuestion") {
                    input.remove("answers");
                }
                Ask {
                    tool: tool.to_string(),
                    input: input.to_string(),
                    agent: agent.clone(),
                }
            };
            let kind = match text("hook_event_name")? {
                "UserPromptSubmit" => {
                    Kind::Prompt(text("prompt").is_some_and(|p| p.starts_with(SELF_STARTED)))
                }
                _ if IGNORED_TOOLS.contains(&tool) => return None,
                "PreToolUse" => Kind::Tool,
                "PermissionRequest" => Kind::Asks(key()),
                "PostToolUse" | "PostToolUseFailure" => Kind::ToolDone(key()),
                "SubagentStop" => Kind::SubagentEnd,
                "Stop" => Kind::TurnEnd(End::Answer),
                "StopFailure" => Kind::TurnEnd(End::Error),
                "SessionEnd" => Kind::SessionEnd,
                _ => return None,
            };
            let said = match kind {
                Kind::TurnEnd(End::Answer) => text("last_assistant_message"),
                Kind::TurnEnd(End::Error) => text("error"),
                _ => None,
            };
            Some(Event {
                session: text("session_id")?.to_string(),
                prompt: text("prompt_id").map(str::to_string),
                agent,
                sent: None,
                pid: None,
                text: said.and_then(snippet),
                cwd: text("cwd").map(str::to_string),
                title: text("session_title")
                    .map(str::trim)
                    .filter(|t| !t.is_empty())
                    .map(str::to_string),
                kind,
            })
        }
        "mod" => {
            // A subagent's own turn ending is not the user's turn ending.
            if text("kind")? != "turn.complete" || text("agentId").is_some() {
                return None;
            }
            let end = match text("reason") {
                Some("aborted") => End::Aborted,
                Some("error") => End::Error,
                _ => End::Answer, // answer or refusal
            };
            Some(Event {
                session: text("session")?.to_string(),
                prompt: None,
                agent: None,
                sent: msg.get("ts").and_then(Value::as_f64),
                pid: None,
                text: None,
                cwd: None,
                title: None,
                kind: Kind::TurnEnd(end),
            })
        }
        _ => None,
    }
}

impl Event {
    // What the hook's URL adds: the session's process and the time it was sent.
    pub fn with_process(mut self, pid: Option<u32>, sent: Option<f64>) -> Self {
        self.pid = pid;
        self.sent = sent;
        self
    }
}

#[derive(Default)]
pub struct Machine {
    sessions: HashMap<String, Session>,
    ended: VecDeque<String>,
    shown: Shown,
    // What the user is doing, while Blip needs to know (see needs_presence).
    presence: Option<Presence>,
    // Since when the presence above has been the same.
    presence_since: f64,
    // The peek was clicked: Sprout is down with "All done, <time>".
    recall: bool,
    // The user's home folder, shown as "~" in the project line.
    home: Option<String>,
}

// The app in front (its process id, never Blip itself) and whether the user
// used the mouse or keyboard lately with the screen unlocked.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Presence {
    pub front: Option<i32>,
    pub active: bool,
}

// The app a session runs in: its process id and its name ("Claude", "Terminal").
#[derive(Clone, Debug, PartialEq)]
pub struct App {
    pub pid: i32,
    pub name: String,
}

// What the page gets: the state, the snippet under Sprout's line, and for Done
// and the peek what the bubble says around it.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Shown {
    pub state: State,
    pub text: Option<String>,
    // The app a click opens ("Click me to open <app>"), when known.
    pub app: Option<String>,
    // "blip-notification · Done flow" (Done and the peek).
    pub project: Option<String>,
    // Done with the session's app already in front: about 5 s, no x, no hint.
    pub quiet: bool,
    // Other finished sessions not checked yet ("+N more").
    pub more: usize,
    // The peek was clicked: how long ago Claude finished ("25 min ago").
    pub recall: Option<String>,
}

#[derive(Default)]
struct Session {
    pid: Option<u32>,
    prompt: Option<String>,
    earlier: VecDeque<String>,
    prompt_sent: f64,
    running: bool,
    self_started: bool,
    asks: Vec<Ask>,
    subagent_asks: Vec<Ask>,
    outcome: Outcome,
    ended_at: f64,
    // When the latest question or permission came, to pick the newest when sessions tie.
    asked_at: f64,
    // The snippet of how the last turn ended.
    text: Option<String>,
    // The first folder the session reported and its chat title.
    cwd: Option<String>,
    title: Option<String>,
    app: Option<App>,
    // When the app was last looked up without finding it, so it is tried again
    // only after APP_RETRY.
    app_tried: Option<f64>,
    // A finish the user has not checked yet.
    finished: Option<Finished>,
}

struct Finished {
    at: f64,
    // Decided once, SETTLE after the finish: was the session's app in front?
    // None until then, or when Blip could not tell (then the full flow).
    quiet: Option<bool>,
    // The bubble is open (until the x); closed, Sprout peeks.
    bubble: bool,
}

#[derive(Clone, Copy, Default, PartialEq)]
enum Outcome {
    #[default]
    None,
    Done,
    // Esc, Deny or a turn nobody typed: nothing to announce.
    Quiet,
    Error,
}

impl Machine {
    pub fn handle(&mut self, event: Event, now: f64) {
        // A session that ended stays ended; its late events are from before a freeze.
        if self.ended.contains(&event.session) {
            return;
        }
        if event.kind == Kind::SessionEnd {
            self.end(&event.session);
            return;
        }
        let s = self.sessions.entry(event.session).or_default();
        if event.pid.is_some() {
            s.pid = event.pid;
        }
        if s.cwd.is_none() {
            s.cwd = event.cwd;
        }
        if event.title.is_some() {
            s.title = event.title;
        }

        // A subagent only matters while it waits for the user, which can outlast the main turn.
        if let Some(agent) = event.agent {
            let before = s.subagent_asks.len();
            match event.kind {
                Kind::Asks(ask) => {
                    s.subagent_asks.push(ask);
                    s.asked_at = now;
                }
                Kind::ToolDone(ask) => remove_one(&mut s.subagent_asks, &ask),
                // A denied or cancelled subagent never sends PostToolUse, but it does stop.
                Kind::SubagentEnd => s.subagent_asks.retain(|a| a.agent.as_ref() != Some(&agent)),
                _ => {}
            }
            if before > 0 && s.subagent_asks.is_empty() && !s.running {
                s.ended_at = now; // "Done" counts from when the wait ended
                if let Some(f) = &mut s.finished {
                    f.at = now;
                }
            }
            return;
        }

        if let Some(prompt) = event.prompt {
            if s.earlier.contains(&prompt) {
                return; // from an earlier turn, arriving late
            }
            if s.prompt.as_ref() != Some(&prompt) {
                if let Some(old) = s.prompt.replace(prompt) {
                    remember(&mut s.earlier, old);
                }
                s.prompt_sent = event.sent.unwrap_or(now);
                s.running = true;
                s.self_started = false;
                s.asks.clear();
                s.outcome = Outcome::None;
                s.text = None;
            }
        }
        // The hook's time is whole seconds, rounded down, so a mod message from the
        // current turn is never older than it; one from the turn before usually is.
        if matches!(event.kind, Kind::TurnEnd(_))
            && event.sent.is_some_and(|sent| sent < s.prompt_sent)
        {
            return;
        }
        // Kept even when the turn already ended: the mod's "turn.complete" can come before Stop.
        if event.text.is_some() {
            s.text = event.text;
        }

        if !s.running {
            // The turn is over. Only Esc or an error can still change how it ended:
            // the CLI sends Stop before the mod's "aborted".
            match event.kind {
                Kind::TurnEnd(End::Aborted) if s.outcome != Outcome::Error => {
                    s.outcome = Outcome::Quiet
                }
                Kind::TurnEnd(End::Error) => s.outcome = Outcome::Error,
                _ => return,
            }
            // That turn was not a finish to announce after all.
            if s.finished.as_ref().is_some_and(|f| f.at == s.ended_at) {
                s.finished = None;
            }
            return;
        }
        match event.kind {
            Kind::Prompt(self_started) => {
                s.self_started = self_started;
                // The user typed again: they have seen the last result.
                if !self_started {
                    s.finished = None;
                }
            }
            Kind::Asks(ask) => {
                s.asks.push(ask);
                s.asked_at = now;
            }
            Kind::ToolDone(ask) => remove_one(&mut s.asks, &ask),
            Kind::TurnEnd(end) => {
                s.running = false;
                s.ended_at = now;
                s.outcome = match end {
                    End::Error => Outcome::Error,
                    End::Aborted => Outcome::Quiet,
                    // Ending with a question still open means the user said no.
                    End::Answer if !s.asks.is_empty() || s.self_started => Outcome::Quiet,
                    End::Answer => Outcome::Done,
                };
                if s.outcome == Outcome::Done {
                    s.finished = Some(Finished {
                        at: now,
                        quiet: None,
                        bubble: true,
                    });
                }
                s.asks.clear();
            }
            Kind::Tool | Kind::SubagentEnd | Kind::SessionEnd => {}
        }
    }

    // Forgets a session: it sent SessionEnd, or its process is gone.
    pub fn end(&mut self, session: &str) {
        self.sessions.remove(session);
        remember(&mut self.ended, session.to_string());
    }

    // Sessions and their Claude process, for the liveness check.
    pub fn processes(&self) -> Vec<(String, u32)> {
        self.sessions
            .iter()
            .filter_map(|(id, s)| Some((id.clone(), s.pid?)))
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    pub fn state(&self, now: f64) -> State {
        self.sessions
            .values()
            .map(|s| s.state(now))
            .max()
            .unwrap_or_default()
    }

    // The session that decides what shows: the most urgent, and among sessions in
    // the same state the one that got there last.
    fn top(&self, now: f64) -> Option<&Session> {
        self.sessions.values().max_by(|a, b| {
            let (sa, sb) = (a.state(now), b.state(now));
            sa.cmp(&sb)
                .then(a.changed_at(sa).total_cmp(&b.changed_at(sb)))
        })
    }

    // What Sprout's bubble says under the state line: from the session that decides
    // the state, what it asks (needs you) or how its turn ended (done, error).
    pub fn text(&self, now: f64) -> Option<String> {
        let s = self.top(now)?;
        match s.state(now) {
            State::NeedsYou => s.subagent_asks.iter().chain(&s.asks).last().map(Ask::text),
            State::Done | State::Error => s.text.clone(),
            _ => None,
        }
    }

    // The next time the state changes by itself: Done showing after SETTLE, and
    // the quiet Done hiding again.
    pub fn next_change(&self, now: f64) -> Option<f64> {
        self.sessions
            .values()
            .filter_map(|s| s.finished.as_ref())
            .flat_map(|f| {
                let hide = (f.quiet != Some(false)).then_some(f.at + SETTLE + DONE_FOR);
                [Some(f.at + SETTLE), hide]
            })
            .flatten()
            .filter(|&t| t > now)
            .min_by(f64::total_cmp)
    }

    // True while Blip needs to know what the user is doing: a finish waits for
    // its quiet decision, or is not checked yet.
    pub fn needs_presence(&self) -> bool {
        self.sessions.values().any(|s| s.finished.is_some())
    }

    // What the user is doing now (Mac: front app, idle time, lock).
    pub fn set_presence(&mut self, presence: Option<Presence>, now: f64) {
        if presence != self.presence {
            self.presence = presence;
            self.presence_since = now;
        }
    }

    // Applies the rules that depend on time and presence: the quiet decision at
    // SETTLE, the quiet Done ending, and checking by having the app in front.
    fn tick(&mut self, now: f64) {
        let presence = self.presence;
        let checked = presence
            .filter(|p| p.active && now - self.presence_since >= CHECK_AFTER)
            .and_then(|p| p.front);
        for s in self.sessions.values_mut() {
            let app = s.app.as_ref().map(|a| a.pid);
            let Some(f) = &mut s.finished else { continue };
            if f.quiet.is_none() && now >= f.at + SETTLE {
                let in_front =
                    presence.is_some_and(|p| p.active && p.front.is_some() && p.front == app);
                f.quiet = Some(in_front);
                f.bubble = !in_front;
            }
            let over = match f.quiet {
                Some(true) => now >= f.at + SETTLE + DONE_FOR,
                Some(false) => checked.is_some() && checked == app,
                None => false,
            };
            if over {
                s.finished = None;
            }
        }
        if !self.sessions.values().any(Session::peeks) {
            self.recall = false;
        }
        // Nothing to watch: forget, so a stale reading never counts later.
        if !self.needs_presence() {
            self.presence = None;
        }
    }

    // The x: the bubble closes and Sprout goes up to peek.
    pub fn close_bubble(&mut self) {
        for f in self
            .sessions
            .values_mut()
            .filter_map(|s| s.finished.as_mut())
        {
            if f.quiet == Some(false) {
                f.bubble = false;
            }
        }
        self.recall = false;
    }

    // A click on the peek: Sprout comes down with "All done, <time>".
    pub fn open_recall(&mut self) {
        self.recall = self.sessions.values().any(Session::peeks);
    }

    // The app a click on Sprout or its bubble opens: the session that decides
    // what shows (for the peek, the latest finish).
    pub fn click_target(&self, now: f64) -> Option<i32> {
        Some(self.top(now)?.app.as_ref()?.pid)
    }

    // The user went to this app: every finish in it counts as checked.
    pub fn checked_app(&mut self, pid: i32) {
        for s in self.sessions.values_mut() {
            if s.app.as_ref().is_some_and(|a| a.pid == pid) {
                s.finished = None;
            }
        }
        if !self.sessions.values().any(Session::peeks) {
            self.recall = false;
        }
    }

    // Sessions with a Claude process and no app yet, not tried in the last
    // APP_RETRY. Marked as tried; set_app ends the tries.
    pub fn apps_wanted(&mut self, now: f64) -> Vec<(String, u32)> {
        self.sessions
            .iter_mut()
            .filter(|(_, s)| {
                s.app.is_none() && s.app_tried.is_none_or(|at| now - at >= APP_RETRY)
            })
            .filter_map(|(id, s)| {
                let pid = s.pid?;
                s.app_tried = Some(now);
                Some((id.clone(), pid))
            })
            .collect()
    }

    pub fn set_app(&mut self, session: &str, app: App) {
        if let Some(s) = self.sessions.get_mut(session) {
            s.app = Some(app);
        }
    }

    pub fn set_home(&mut self, home: Option<String>) {
        self.home = home;
    }

    pub fn shown(&self, now: f64) -> Shown {
        let state = self.state(now);
        let mut shown = Shown {
            state,
            text: self.text(now),
            ..Shown::default()
        };
        if let Some(s) = self.top(now) {
            shown.app = s.app.as_ref().map(|a| a.name.clone());
            if matches!(state, State::Done | State::Peek) {
                shown.project = s
                    .cwd
                    .as_deref()
                    .map(|cwd| project_line(cwd, s.title.as_deref(), self.home.as_deref()));
                let f = s.finished.as_ref();
                shown.quiet = f.is_some_and(|f| f.quiet == Some(true));
                shown.more = self
                    .sessions
                    .values()
                    .filter(|o| o.peeks() && !std::ptr::eq(*o, s))
                    .count();
                if state == State::Peek && self.recall {
                    shown.recall = f.map(|f| ago(now - f.at));
                }
            }
        }
        shown
    }

    // What to show, if anything differs from what was shown last.
    pub fn changed(&mut self, now: f64) -> Option<Shown> {
        self.tick(now);
        let shown = self.shown(now);
        (shown != self.shown).then(|| {
            self.shown = shown.clone();
            shown
        })
    }
}

impl Session {
    // When the session reached this state: its latest ask, or the end of its turn.
    fn changed_at(&self, state: State) -> f64 {
        match state {
            State::NeedsYou => self.asked_at,
            State::Done | State::Peek => self.finished.as_ref().map_or(self.ended_at, |f| f.at),
            _ => self.ended_at,
        }
    }

    // A finish the user still has to check (not a quiet one, which ends by itself).
    fn peeks(&self) -> bool {
        self.finished
            .as_ref()
            .is_some_and(|f| f.quiet != Some(true))
    }

    fn state(&self, now: f64) -> State {
        if !self.subagent_asks.is_empty() || !self.asks.is_empty() {
            return State::NeedsYou;
        }
        if self.running && !self.self_started {
            return State::Working;
        }
        if !self.running && self.outcome == Outcome::Error {
            return State::Error;
        }
        let Some(f) = &self.finished else {
            return State::Hidden;
        };
        let since = now - f.at;
        match f.quiet {
            _ if since < SETTLE => State::Working,
            Some(true) if since < SETTLE + DONE_FOR => State::Done,
            Some(true) => State::Hidden,
            _ if f.bubble => State::Done,
            _ => State::Peek,
        }
    }
}

impl Ask {
    // A question shows itself; any other tool shows its name ("mcp__server__tool" as "tool").
    fn text(&self) -> String {
        let input: Value = serde_json::from_str(&self.input).unwrap_or_default();
        let question = input["questions"][0]["question"].as_str();
        match question.and_then(snippet) {
            Some(q) if self.tool == "AskUserQuestion" => q,
            _ => format!(
                "Wants to use {}",
                self.tool.rsplit("__").next().unwrap_or(&self.tool)
            ),
        }
    }
}

// How long ago Claude finished, in coarser steps the longer it gets (DECISIONS
// 9 Nov): "just now", "N min ago", "N h ago" with the real hours, "yesterday",
// "N days ago". Counted from the time passed, not the calendar day. No cap.
pub fn ago(secs: f64) -> String {
    let secs = secs.max(0.0) as u64;
    match secs {
        0..60 => "just now".into(),
        60..3600 => format!("{} min ago", secs / 60),
        3600..86400 => format!("{} h ago", secs / 3600),
        86400..172800 => "yesterday".into(),
        _ => format!("{} days ago", secs / 86400),
    }
}

// "blip-notification · Done flow": the project folder's name, with a worktree's
// own folder left out, and the chat title when there is one. The home folder
// itself shows as "~". Mac and Windows paths. Cut to PROJECT_MAX characters.
pub fn project_line(cwd: &str, title: Option<&str>, home: Option<&str>) -> String {
    let mut path = cwd;
    for marker in ["/.claude/worktrees/", "\\.claude\\worktrees\\"] {
        if let Some(i) = path.find(marker) {
            path = &path[..i];
        }
    }
    let path = path.trim_end_matches(['/', '\\']);
    let is_home = home.is_some_and(|h| h.trim_end_matches(['/', '\\']) == path);
    let name = match path.rsplit(['/', '\\']).next() {
        _ if is_home => "~",
        Some(name) if !name.is_empty() => name,
        _ => cwd,
    };
    let line = match title {
        Some(t) => format!("{name} · {t}"),
        None => name.to_string(),
    };
    match line.char_indices().nth(PROJECT_MAX - 1) {
        Some((cut, _)) if line.chars().count() > PROJECT_MAX => {
            format!("{}…", line[..cut].trim_end())
        }
        _ => line,
    }
}

// The first line with words in it, without Markdown marks, cut to SNIPPET characters.
// Only marks are removed: a heading or quote start, a list bullet, bold and code quotes.
// A single "_" or "*" stays, since it is often part of a name ("update_state") or a sum.
fn snippet(message: &str) -> Option<String> {
    let line = message
        .lines()
        .map(|l| {
            let l = l.trim().trim_start_matches(['#', '>', ' ']);
            ["- ", "* ", "+ "]
                .iter()
                .find_map(|bullet| l.strip_prefix(bullet))
                .unwrap_or(l)
        })
        .find(|l| l.chars().any(char::is_alphanumeric))?;
    let line = line.replace("**", "").replace("__", "").replace('`', "");
    let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(match line.char_indices().nth(SNIPPET) {
        Some((cut, _)) => format!("{}…", line[..cut].trim_end()),
        None => line,
    })
}

fn remember(list: &mut VecDeque<String>, item: String) {
    if list.len() == REMEMBER {
        list.pop_front();
    }
    list.push_back(item);
}

fn remove_one(list: &mut Vec<Ask>, done: &Ask) {
    if let Some(i) = list.iter().position(|a| a == done) {
        list.remove(i);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Feeds a fixture (real lines from logs/received.jsonl, cleaned) and returns
    // the state after each line, with its line number in the original log.
    fn replay(machine: &mut Machine, fixture: &str) -> Vec<(u64, f64, State)> {
        fixture
            .lines()
            .map(|line| {
                let d: Value = serde_json::from_str(line).unwrap();
                let at = d["at"].as_f64().unwrap();
                if let Some(event) = translate(d["src"].as_str().unwrap(), &d["event"]) {
                    machine.handle(event, at);
                }
                (d["line"].as_u64().unwrap(), at, machine.state(at))
            })
            .collect()
    }

    fn at(states: &[(u64, f64, State)], line: u64) -> State {
        states.iter().find(|(l, _, _)| *l == line).unwrap().2
    }

    // When the last line arrived.
    fn end(states: &[(u64, f64, State)]) -> f64 {
        states.last().unwrap().1
    }

    fn hook(name: &str, session: &str, prompt: &str) -> Value {
        json!({ "hook_event_name": name, "session_id": session, "prompt_id": prompt })
    }

    fn feed(m: &mut Machine, src: &str, msg: Value, now: f64) {
        if let Some(event) = translate(src, &msg) {
            m.handle(event, now);
        }
    }

    // A hook message as the new send-event.sh sends it, with pid and send time.
    fn feed_sent(m: &mut Machine, msg: Value, pid: u32, sent: f64, now: f64) {
        let event = translate("hook", &msg).unwrap();
        m.handle(event.with_process(Some(pid), Some(sent)), now);
    }

    fn bash(name: &str, input: &str) -> Value {
        json!({ "hook_event_name": name, "session_id": "s", "prompt_id": "p",
                "tool_name": "Bash", "tool_input": { "command": input } })
    }

    #[test]
    fn an_allowed_permission_goes_back_to_working_then_done() {
        let mut m = Machine::default();
        let s = replay(&mut m, include_str!("fixtures/allow.jsonl"));
        assert_eq!(at(&s, 32), State::Working);
        assert_eq!(at(&s, 36), State::NeedsYou);
        assert_eq!(at(&s, 37), State::Working);
        assert_eq!(at(&s, 38), State::Working); // Done waits SETTLE for a possible Esc
        assert_eq!(at(&s, 39), State::Working); // the mod's second "turn ended" changes nothing
        assert_eq!(m.state(end(&s) + 1.0), State::Done);
    }

    #[test]
    fn a_turn_that_ends_with_a_question_open_was_a_deny() {
        // Desktop app: after Deny only the mod reports the end, there is no Stop.
        let s = replay(&mut Machine::default(), include_str!("fixtures/deny.jsonl"));
        assert_eq!(at(&s, 42), State::NeedsYou);
        assert_eq!(at(&s, 43), State::Working);
        assert_eq!(at(&s, 47), State::NeedsYou);
        assert_eq!(at(&s, 48), State::Hidden);
    }

    #[test]
    fn the_mod_and_stop_can_arrive_in_either_order() {
        let mut m = Machine::default();
        let s = replay(&mut m, include_str!("fixtures/mod_before_stop.jsonl"));
        assert_eq!(at(&s, 56), State::Working);
        assert_eq!(m.state(end(&s) + 1.0), State::Done);
    }

    #[test]
    fn questions_ask_for_the_user_and_esc_hides() {
        let s = replay(
            &mut Machine::default(),
            include_str!("fixtures/question_then_esc.jsonl"),
        );
        assert_eq!(at(&s, 59), State::NeedsYou);
        assert_eq!(at(&s, 60), State::Working);
        assert_eq!(at(&s, 75), State::NeedsYou); // AskUserQuestion comes as a PermissionRequest
        assert_eq!(at(&s, 77), State::Working);
        assert_eq!(at(&s, 89), State::Working); // update_plan ignored
        assert_eq!(at(&s, 90), State::Hidden); // Esc in the Desktop app: only the mod's "aborted"
    }

    #[test]
    fn late_events_after_a_freeze_do_not_bring_a_session_back() {
        // Blip was frozen; on waking it got these all at once and out of order.
        let s = replay(
            &mut Machine::default(),
            include_str!("fixtures/freeze_burst.jsonl"),
        );
        assert_eq!(at(&s, 95), State::Hidden);
        assert_eq!(at(&s, 117), State::Working); // s3 still running, s2 already ended
        assert_eq!(at(&s, 119), State::Hidden);
        assert_eq!(at(&s, 122), State::Hidden);
    }

    #[test]
    fn a_late_prompt_from_an_earlier_turn_is_dropped() {
        let mut m = Machine::default();
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p1"), 0.0);
        feed(&mut m, "hook", hook("Stop", "s", "p1"), 1.0);
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p2"), 2.0);
        feed(&mut m, "hook", hook("Stop", "s", "p1"), 3.0);
        assert_eq!(m.state(3.0), State::Working);
        // A mod message stamped before p2 started belongs to p1.
        feed(
            &mut m,
            "mod",
            json!({ "kind": "turn.complete", "session": "s", "reason": "answer", "ts": 1.5 }),
            4.0,
        );
        assert_eq!(m.state(4.0), State::Working);
    }

    const CLAUDE: i32 = 7;
    const NOTES: i32 = 8;

    fn claude() -> App {
        App {
            pid: CLAUDE,
            name: "Claude".into(),
        }
    }

    fn here(front: i32, active: bool) -> Option<Presence> {
        Some(Presence {
            front: Some(front),
            active,
        })
    }

    // A session in the Claude app that finished at 10.
    fn finished_at_10(m: &mut Machine) {
        feed(m, "hook", hook("UserPromptSubmit", "s", "p"), 0.0);
        m.set_app("s", claude());
        assert_eq!(m.changed(0.0).map(|s| s.state), Some(State::Working));
        feed(m, "hook", hook("Stop", "s", "p"), 10.0);
    }

    // Code review 9 Nov: a lookup that found nothing was never tried again.
    #[test]
    fn app_not_found_is_tried_again_later() {
        let mut m = Machine::default();
        feed_sent(&mut m, hook("UserPromptSubmit", "s", "p"), 42, 0.0, 0.0);
        assert_eq!(m.apps_wanted(0.0), vec![("s".to_string(), 42)]);
        assert_eq!(m.apps_wanted(1.0), vec![]); // just tried
        assert_eq!(m.apps_wanted(APP_RETRY), vec![("s".to_string(), 42)]);
        m.set_app("s", claude());
        assert_eq!(m.apps_wanted(100.0), vec![]); // found: done
    }

    fn state_after(m: &mut Machine, now: f64) -> State {
        m.changed(now);
        m.state(now)
    }

    #[test]
    fn done_with_claude_in_front_hides_after_five_seconds() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.set_presence(here(CLAUDE, true), 10.0);
        assert_eq!(m.next_change(10.0), Some(10.0 + SETTLE));
        assert_eq!(m.changed(10.0).map(|s| s.state), None);
        let shown = m.changed(10.25).unwrap();
        assert_eq!((shown.state, shown.quiet), (State::Done, true));
        assert_eq!(m.next_change(10.25), Some(10.0 + SETTLE + DONE_FOR));
        assert_eq!(m.changed(15.1).map(|s| s.state), None);
        assert_eq!(m.changed(15.25).map(|s| s.state), Some(State::Hidden));
        assert_eq!(m.next_change(15.25), None);
        assert!(!m.needs_presence()); // no peek after a quiet Done
    }

    #[test]
    fn done_elsewhere_stays_until_the_x_then_peeks() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.set_presence(here(NOTES, true), 10.0);
        let shown = m.changed(10.25).unwrap();
        assert_eq!((shown.state, shown.quiet), (State::Done, false));
        assert_eq!(shown.app.as_deref(), Some("Claude"));
        assert_eq!(state_after(&mut m, 3600.0), State::Done); // no timer
        m.close_bubble();
        assert_eq!(state_after(&mut m, 3601.0), State::Peek);
        assert_eq!(m.click_target(3601.0), Some(CLAUDE));
    }

    #[test]
    fn claude_in_front_while_the_user_is_away_is_the_full_flow() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.set_presence(here(CLAUDE, false), 10.0); // idle or locked
        assert_eq!(state_after(&mut m, 60.0), State::Done);
        assert!(!m.changed(60.0).is_some_and(|s| s.quiet));
    }

    #[test]
    fn without_presence_done_is_the_full_flow() {
        // Windows for now, or the front app could not be read.
        let mut m = Machine::default();
        finished_at_10(&mut m);
        assert_eq!(state_after(&mut m, 60.0), State::Done);
    }

    #[test]
    fn two_seconds_back_in_claude_counts_as_checked() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.set_presence(here(NOTES, true), 10.0);
        m.changed(10.25);
        m.close_bubble();
        m.set_presence(here(CLAUDE, true), 20.0);
        assert_eq!(state_after(&mut m, 21.5), State::Peek); // a quick pass by Claude
        m.set_presence(here(NOTES, true), 21.6);
        m.set_presence(here(CLAUDE, true), 30.0);
        assert_eq!(state_after(&mut m, 32.0), State::Hidden);
        assert!(!m.needs_presence());
    }

    #[test]
    fn coming_back_while_the_bubble_shows_clears_it_too() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.set_presence(here(CLAUDE, false), 10.0);
        assert_eq!(state_after(&mut m, 10.25), State::Done);
        m.set_presence(here(CLAUDE, true), 100.0); // the user is back
        assert_eq!(state_after(&mut m, 101.0), State::Done);
        assert_eq!(state_after(&mut m, 102.0), State::Hidden);
    }

    #[test]
    fn a_new_prompt_clears_the_peek_but_a_self_started_turn_does_not() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.changed(10.25);
        m.close_bubble();
        let mut auto = hook("UserPromptSubmit", "s", "p2");
        auto["prompt"] = json!("<task-notification>x</task-notification>");
        feed(&mut m, "hook", auto, 20.0);
        assert_eq!(state_after(&mut m, 20.0), State::Peek);
        feed(&mut m, "hook", hook("Stop", "s", "p2"), 21.0);
        assert_eq!(state_after(&mut m, 22.0), State::Peek);
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p3"), 30.0);
        assert_eq!(state_after(&mut m, 30.0), State::Working);
        feed(
            &mut m,
            "mod",
            json!({ "kind": "turn.complete", "session": "s", "reason": "aborted" }),
            31.0,
        );
        assert_eq!(state_after(&mut m, 31.0), State::Hidden);
    }

    #[test]
    fn the_session_ending_clears_the_peek() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.changed(10.25);
        m.close_bubble();
        m.end("s");
        assert_eq!(state_after(&mut m, 11.0), State::Hidden);
    }

    #[test]
    fn the_peek_click_says_how_long_ago() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.changed(10.25);
        m.close_bubble();
        m.open_recall();
        let shown = m.changed(10.0 + 25.0 * 60.0).unwrap();
        assert_eq!(shown.state, State::Peek);
        assert_eq!(shown.recall.as_deref(), Some("25 min ago"));
        m.close_bubble(); // its x
        assert_eq!(m.changed(10.0 + 26.0 * 60.0).unwrap().recall, None);
    }

    #[test]
    fn a_click_that_opens_claude_checks_it() {
        let mut m = Machine::default();
        finished_at_10(&mut m);
        m.changed(10.25);
        m.checked_app(CLAUDE);
        assert_eq!(state_after(&mut m, 11.0), State::Hidden);
    }

    #[test]
    fn several_sessions_the_peek_comes_last_and_counts_the_others() {
        let mut m = Machine::default();
        for (id, at) in [("a", 10.0), ("b", 20.0)] {
            feed(&mut m, "hook", hook("UserPromptSubmit", id, "p"), 0.0);
            feed(&mut m, "hook", hook("Stop", id, "p"), at);
        }
        m.set_app("a", claude());
        m.set_app(
            "b",
            App {
                pid: 9,
                name: "Terminal".into(),
            },
        );
        let shown = m.changed(21.0).unwrap();
        assert_eq!(
            (shown.state, shown.app.as_deref(), shown.more),
            (State::Done, Some("Terminal"), 1)
        );
        m.close_bubble();
        feed(&mut m, "hook", hook("UserPromptSubmit", "c", "p"), 22.0);
        assert_eq!(state_after(&mut m, 22.0), State::Working); // working beats the peek
        feed(&mut m, "hook", hook("SessionEnd", "c", "p"), 23.0);
        assert_eq!(state_after(&mut m, 23.0), State::Peek);
        m.checked_app(9);
        let shown = m.changed(24.0).unwrap();
        assert_eq!(
            (shown.state, shown.app.as_deref(), shown.more),
            (State::Peek, Some("Claude"), 0)
        );
    }

    #[test]
    fn the_time_wording() {
        let cases = [
            (0.0, "just now"),
            (59.0, "just now"),
            (60.0, "1 min ago"),
            (25.0 * 60.0, "25 min ago"),
            (3599.0, "59 min ago"),
            (3600.0, "1 h ago"),
            (12.0 * 3600.0, "12 h ago"),
            (86399.0, "23 h ago"),
            (86400.0, "yesterday"),
            (2.0 * 86400.0, "2 days ago"),
            (40.0 * 86400.0, "40 days ago"),
            (-5.0, "just now"),
        ];
        for (secs, words) in cases {
            assert_eq!(ago(secs), words, "{secs} s");
        }
    }

    #[test]
    fn the_project_line() {
        let home = Some("/Users/mac");
        let line = |cwd, title| project_line(cwd, title, home);
        assert_eq!(
            line("/Users/mac/Documents/Claude/blip-notification", None),
            "blip-notification"
        );
        assert_eq!(
            line(
                "/Users/mac/Documents/Claude/blip-notification",
                Some("Done flow")
            ),
            "blip-notification · Done flow"
        );
        assert_eq!(
            line("/Users/mac/code/app/.claude/worktrees/brave-fox", None),
            "app"
        );
        assert_eq!(line("/Users/mac/", None), "~");
        assert_eq!(line("C:\\Users\\mo\\Projects\\blip\\", None), "blip");
        assert_eq!(
            project_line("C:\\Users\\mo", None, Some("C:\\Users\\mo")),
            "~"
        );
        assert_eq!(line("C:\\code\\app\\.claude\\worktrees\\x", None), "app");
        let long = line(
            "/x/blip-notification",
            Some("A very long chat title that goes on and on"),
        );
        assert_eq!(long.chars().count(), PROJECT_MAX);
        assert!(long.starts_with("blip-notification · A very") && long.ends_with('…'));
    }

    #[test]
    fn the_project_comes_from_the_first_folder_and_the_latest_title() {
        let mut m = Machine::default();
        let mut first = hook("UserPromptSubmit", "s", "p");
        first["cwd"] = json!("/Users/mac/blip");
        feed(&mut m, "hook", first, 0.0);
        let mut later = hook("PreToolUse", "s", "p");
        later["cwd"] = json!("/Users/mac/blip/app");
        feed(&mut m, "hook", later, 1.0);
        let mut next = hook("UserPromptSubmit", "s", "p2");
        next["session_title"] = json!("Done flow");
        feed(&mut m, "hook", next, 2.0);
        feed(&mut m, "hook", hook("Stop", "s", "p2"), 3.0);
        let shown = m.changed(4.0).unwrap();
        assert_eq!(shown.project.as_deref(), Some("blip · Done flow"));
    }

    #[test]
    fn a_waiting_subagent_keeps_needs_you_after_stop() {
        // From the Windows test 18 notes: main Stop came while the subagent's PermissionRequest
        // waited; its PostToolUse came a minute later. Subagent events carry agent_id.
        let sub = |name: &str| {
            json!({ "hook_event_name": name, "session_id": "s", "prompt_id": "p", "agent_id": "a1",
                    "tool_name": "PowerShell", "tool_input": { "command": "x" } })
        };
        let mut m = Machine::default();
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p"), 0.0);
        feed(&mut m, "hook", sub("PreToolUse"), 7.7);
        assert_eq!(m.state(7.7), State::Working);
        feed(&mut m, "hook", sub("PermissionRequest"), 8.4);
        feed(&mut m, "hook", hook("Stop", "s", "p"), 11.6);
        assert_eq!(m.state(11.6), State::NeedsYou);
        feed(&mut m, "hook", sub("PostToolUse"), 73.3);
        assert_eq!(m.state(73.6), State::Done);
        // The subagent's own turn.complete is not the user's turn.
        feed(
            &mut m,
            "mod",
            json!({ "kind": "turn.complete", "session": "s", "reason": "error", "agentId": "a1", "ts": 76.2 }),
            76.2,
        );
        assert_eq!(m.state(76.2), State::Done);
    }

    #[test]
    fn errors_show_until_the_next_prompt() {
        // Built by hand: no real error turn has been logged yet.
        let mut m = Machine::default();
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p1"), 0.0);
        feed(&mut m, "hook", hook("StopFailure", "s", "p1"), 1.0);
        assert_eq!(m.state(100.0), State::Error);
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p2"), 101.0);
        assert_eq!(m.state(101.0), State::Working);
        // The mod's error can follow a Stop and still wins.
        feed(&mut m, "hook", hook("Stop", "s", "p2"), 102.0);
        feed(
            &mut m,
            "mod",
            json!({ "kind": "turn.complete", "session": "s", "reason": "error", "ts": 102.0 }),
            102.1,
        );
        assert_eq!(m.state(102.1), State::Error);
    }

    #[test]
    fn the_most_urgent_session_wins() {
        let mut m = Machine::default();
        feed(&mut m, "hook", hook("UserPromptSubmit", "a", "pa"), 0.0);
        feed(&mut m, "hook", hook("UserPromptSubmit", "b", "pb"), 0.0);
        feed(&mut m, "hook", hook("Stop", "a", "pa"), 1.0);
        assert_eq!(m.state(1.0), State::Working); // b working beats a done
        feed(
            &mut m,
            "hook",
            json!({ "hook_event_name": "PermissionRequest", "session_id": "b", "prompt_id": "pb", "tool_name": "Bash" }),
            2.0,
        );
        assert_eq!(m.state(2.0), State::NeedsYou);
        feed(&mut m, "hook", hook("SessionEnd", "b", "pb"), 3.0);
        assert_eq!(m.state(3.0), State::Done);
    }

    #[test]
    fn the_bubble_shows_the_first_line_of_the_last_reply() {
        let mut m = Machine::default();
        let mut stop = hook("Stop", "s1", "p1");
        stop["last_assistant_message"] = json!("\n## **Fixed** the `bubble`.\n\nMore below.");
        feed(&mut m, "hook", hook("UserPromptSubmit", "s1", "p1"), 0.0);
        feed(&mut m, "hook", stop, 0.0);
        assert_eq!(m.state(1.0), State::Done);
        assert_eq!(m.text(1.0).as_deref(), Some("Fixed the bubble."));
        // The next turn starts without it.
        feed(&mut m, "hook", hook("UserPromptSubmit", "s1", "p2"), 0.0);
        assert_eq!(m.text(1.0), None);
    }

    #[test]
    fn the_reply_counts_when_the_mod_ended_the_turn_first() {
        let mut m = Machine::default();
        feed(&mut m, "hook", hook("UserPromptSubmit", "s1", "p1"), 0.0);
        let done = json!({ "kind": "turn.complete", "session": "s1", "reason": "answer" });
        feed(&mut m, "mod", done, 0.0);
        let mut stop = hook("Stop", "s1", "p1");
        stop["last_assistant_message"] = json!("All set.");
        feed(&mut m, "hook", stop, 0.0);
        assert_eq!(m.text(1.0).as_deref(), Some("All set."));
    }

    #[test]
    fn needs_you_shows_the_question_or_the_tool() {
        let mut m = Machine::default();
        let mut ask = hook("PermissionRequest", "s1", "p1");
        ask["tool_name"] = json!("mcp__Claude_Browser__navigate");
        feed(&mut m, "hook", hook("UserPromptSubmit", "s1", "p1"), 0.0);
        feed(&mut m, "hook", ask, 0.0);
        assert_eq!(m.text(0.0).as_deref(), Some("Wants to use navigate"));
        let mut question = hook("PermissionRequest", "s1", "p1");
        question["tool_name"] = json!("AskUserQuestion");
        question["tool_input"] = json!({ "questions": [{ "question": "Which wording?" }] });
        feed(&mut m, "hook", question, 0.0);
        assert_eq!(m.text(0.0).as_deref(), Some("Which wording?"));
    }

    #[test]
    fn long_snippets_are_cut() {
        let long = "word ".repeat(40);
        let cut = snippet(&long).unwrap();
        assert_eq!(cut.chars().count(), SNIPPET); // 99 characters and the "…"
        assert!(cut.ends_with("word…"));
        assert_eq!(snippet("```\n---\n"), None);
    }

    #[test]
    fn snippets_keep_names_and_signs() {
        let keep = "-1 test left in update_state, 2*3 cases";
        assert_eq!(snippet(keep).as_deref(), Some(keep));
        assert_eq!(snippet("- **Item** one").as_deref(), Some("Item one"));
        assert_eq!(snippet("> # Quote").as_deref(), Some("Quote"));
    }

    #[test]
    fn a_new_snippet_is_shown_even_when_the_state_stays() {
        let mut m = Machine::default();
        let mut ask = hook("PermissionRequest", "s1", "p1");
        ask["tool_name"] = json!("Bash");
        feed(&mut m, "hook", hook("UserPromptSubmit", "s1", "p1"), 0.0);
        feed(&mut m, "hook", ask, 0.0);
        assert_eq!(
            m.changed(0.0).unwrap().text.as_deref(),
            Some("Wants to use Bash")
        );
        // Another session asks while the first still waits: same state, its text wins.
        let mut question = hook("PermissionRequest", "s2", "q1");
        question["tool_name"] = json!("AskUserQuestion");
        question["tool_input"] = json!({ "questions": [{ "question": "Which one?" }] });
        feed(&mut m, "hook", hook("UserPromptSubmit", "s2", "q1"), 1.0);
        feed(&mut m, "hook", question, 1.0);
        let shown = m.changed(1.0).unwrap();
        assert_eq!(
            (shown.state, shown.text.as_deref()),
            (State::NeedsYou, Some("Which one?"))
        );
        assert_eq!(m.changed(1.0), None);
    }

    #[test]
    fn other_messages_are_ignored() {
        assert_eq!(
            translate(
                "hook",
                &json!({ "hook_event_name": "Notification", "session_id": "s" })
            ),
            None
        );
        assert_eq!(
            translate("hook", &json!({ "hook_event_name": "Stop" })),
            None
        ); // no session
        assert_eq!(translate("mod", &json!({ "kind": "locktest" })), None);
        assert_eq!(translate("other", &json!({})), None);
    }

    #[test]
    fn a_parallel_tool_finishing_does_not_close_another_ask() {
        let mut m = Machine::default();
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p"), 0.0);
        feed(&mut m, "hook", bash("PreToolUse", "ls"), 1.0);
        feed(&mut m, "hook", bash("PreToolUse", "rm x"), 1.0);
        feed(&mut m, "hook", bash("PermissionRequest", "rm x"), 1.0);
        feed(&mut m, "hook", bash("PostToolUse", "ls"), 1.1); // auto-allowed
        assert_eq!(m.state(1.1), State::NeedsYou);
        feed(&mut m, "hook", bash("PostToolUseFailure", "rm x"), 2.0); // allowed, then failed
        assert_eq!(m.state(2.0), State::Working);
        feed(&mut m, "hook", hook("Stop", "s", "p"), 3.0);
        assert_eq!(m.state(4.0), State::Done); // a normal end, not a Deny
    }

    #[test]
    fn a_subagent_that_stops_clears_its_asks() {
        // Denied or cancelled: no PostToolUse, but SubagentStop (hooks docs: carries agent_id).
        let mut m = Machine::default();
        let mut ask = bash("PermissionRequest", "x");
        ask["agent_id"] = json!("a1");
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p"), 0.0);
        feed(&mut m, "hook", ask, 1.0);
        feed(&mut m, "hook", hook("Stop", "s", "p"), 2.0);
        assert_eq!(m.state(2.0), State::NeedsYou);
        let other =
            json!({ "hook_event_name": "SubagentStop", "session_id": "s", "agent_id": "a2" });
        feed(&mut m, "hook", other, 3.0);
        assert_eq!(m.state(3.0), State::NeedsYou);
        let stop =
            json!({ "hook_event_name": "SubagentStop", "session_id": "s", "agent_id": "a1" });
        feed(&mut m, "hook", stop, 4.0);
        assert_eq!(m.state(4.5), State::Done);
    }

    #[test]
    fn after_a_freeze_the_send_time_counts_not_the_arrival() {
        // Prompt sent at 100, Esc at 105 (Desktop: only the mod's "aborted"), Blip wakes at 110.
        let mut m = Machine::default();
        feed_sent(&mut m, hook("UserPromptSubmit", "s", "p"), 7, 100.0, 110.0);
        let esc =
            json!({ "kind": "turn.complete", "session": "s", "reason": "aborted", "ts": 105.4 });
        feed(&mut m, "mod", esc, 110.0);
        assert_eq!(m.state(110.0), State::Hidden);
    }

    #[test]
    fn a_turn_claude_started_itself_stays_quiet() {
        let mut m = Machine::default();
        let mut prompt = hook("UserPromptSubmit", "s", "p");
        prompt["prompt"] = json!("<task-notification>done</task-notification>");
        feed(&mut m, "hook", prompt, 0.0);
        assert_eq!(m.state(0.0), State::Hidden);
        feed(&mut m, "hook", bash("PermissionRequest", "x"), 1.0);
        assert_eq!(m.state(1.0), State::NeedsYou); // still shows when it needs the user
        feed(&mut m, "hook", bash("PostToolUse", "x"), 2.0);
        feed(&mut m, "hook", hook("Stop", "s", "p"), 3.0);
        assert_eq!(m.state(4.0), State::Hidden);
    }

    #[test]
    fn esc_in_the_cli_never_flashes_done() {
        // CLI: Stop first, the mod's "aborted" up to one inbox poll later.
        let mut m = Machine::default();
        feed(&mut m, "hook", hook("UserPromptSubmit", "s", "p"), 0.0);
        assert_eq!(m.changed(0.0).map(|s| s.state), Some(State::Working));
        feed(&mut m, "hook", hook("Stop", "s", "p"), 10.0);
        assert_eq!(m.changed(10.0).map(|s| s.state), None);
        let esc =
            json!({ "kind": "turn.complete", "session": "s", "reason": "aborted", "ts": 10.05 });
        feed(&mut m, "mod", esc, 10.1);
        assert_eq!(m.changed(10.1).map(|s| s.state), Some(State::Hidden));
        assert_eq!(m.next_change(10.1), None);
    }

    #[test]
    fn a_session_whose_process_is_gone_can_be_ended() {
        let mut m = Machine::default();
        feed_sent(&mut m, hook("UserPromptSubmit", "s", "p"), 42, 0.0, 0.0);
        assert_eq!(m.processes(), vec![("s".to_string(), 42)]);
        m.end("s");
        assert!(m.is_empty());
        feed_sent(&mut m, hook("Stop", "s", "p"), 42, 1.0, 1.0); // late: stays ended
        assert_eq!(m.state(1.0), State::Hidden);
    }
}
