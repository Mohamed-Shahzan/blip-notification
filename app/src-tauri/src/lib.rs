// Phase 0c placeholder window (transparent, always on top, click-through, top
// centre) with the Phase 1 bridge: hook events arrive on 127.0.0.1, mod events
// as small files in ~/.blip/inbox. Every event is written to logs/received.jsonl.
// The state (state.rs) goes to the page as "blip-state", where Sprout shows it.

mod state;

use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Listener, Manager, PhysicalPosition};
use tiny_http::{Request, Response, Server};

const PORT: u16 = 47821;

// Claude Code's hook messages were at most 16 KB in 982 logged events.
// Reading at most 1 MB stops one huge message from filling Blip's memory.
const MAX_BODY: u64 = 1024 * 1024;

// How often Blip looks in the inbox. Up to this much delay for mod events.
const INBOX_POLL: Duration = Duration::from_millis(100);
// A file that still does not parse after this long was cut off, not half written.
const HALF_WRITTEN: Duration = Duration::from_secs(2);
// Files older than this were left while Blip was closed or frozen: dropped unread.
const STALE: Duration = Duration::from_secs(30);
// While sessions are open, how often Blip checks that their Claude process still runs.
const ALIVE_CHECK: f64 = 15.0;

// The state thread, woken after each event so it can plan its next wake.
static STATE_THREAD: OnceLock<thread::Thread> = OnceLock::new();
// The cursor thread, asleep while Sprout is hidden and woken when it shows.
static CURSOR_THREAD: OnceLock<thread::Thread> = OnceLock::new();

// Click-through: the window ignores the mouse except over Sprout's body.
// The page sends that box ("sprout-box", in window points); the cursor loop
// checks it about 30 times a second while Sprout is shown, and sleeps otherwise.
// The same loop feeds the cursor to Sprout's eyes.
static SHOWN: AtomicBool = AtomicBool::new(false);
static SPROUT_BOX: Mutex<Option<HitBox>> = Mutex::new(None);
const CURSOR_POLL: Duration = Duration::from_millis(33);

#[derive(Clone, Copy, Deserialize)]
struct HitBox {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // No Dock icon on Mac (skipTaskbar only covers Windows and Linux).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app.get_webview_window("main").expect("main window");
            window.set_ignore_cursor_events(true)?;

            // Top centre of the primary screen.
            if let Some(monitor) = window.primary_monitor()? {
                let screen = monitor.size();
                let origin = monitor.position();
                let size = window.outer_size()?;
                let x = origin.x + (screen.width as i32 - size.width as i32) / 2;
                window.set_position(PhysicalPosition::new(x, origin.y))?;
            }

            app.manage(Mutex::new(state::Machine::default()));
            let handle = app.handle().clone();
            thread::spawn(move || listen(handle));
            let handle = app.handle().clone();
            thread::spawn(move || watch_inbox(handle));
            let handle = app.handle().clone();
            let thread = thread::spawn(move || watch_state(handle));
            let _ = STATE_THREAD.set(thread.thread().clone());

            app.listen("sprout-box", |event| {
                if let Ok(hit) = serde_json::from_str::<HitBox>(event.payload()) {
                    *SPROUT_BOX.lock().unwrap_or_else(|p| p.into_inner()) = Some(hit);
                }
            });
            let thread = thread::spawn(move || watch_cursor(window));
            let _ = CURSOR_THREAD.set(thread.thread().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Runs on its own thread so the window never waits on the network.
fn listen(app: AppHandle) {
    let server = match Server::http(("127.0.0.1", PORT)) {
        Ok(server) => server,
        Err(err) => {
            eprintln!("blip: cannot listen on 127.0.0.1:{PORT}: {err}");
            return;
        }
    };

    for request in server.incoming_requests() {
        let app = app.clone();
        // One thread per message, so a stuck or huge message never holds up the others.
        thread::spawn(move || handle(request, app));
    }
}

fn handle(mut request: Request, app: AppHandle) {
    let reader = request.as_reader();
    let mut body = Vec::new();
    let _ = (&mut *reader).take(MAX_BODY).read_to_end(&mut body);
    // Throw away anything past MAX_BODY in small pieces. Left unread, tiny_http
    // reads it all into one buffer when the request is dropped.
    let _ = io::copy(reader, &mut io::sink());
    // Answer as soon as the message is read, before any other work,
    // so Claude Code never waits on Blip.
    let url = request.url().to_string();
    let _ = request.respond(Response::empty(200));

    // Parse once; the slower name search only runs for a broken or cut-off message.
    let event = serde_json::from_slice::<serde_json::Value>(&body).unwrap_or_default();
    let name = event
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| event_name(&body));
    record(serde_json::json!({
        "ts": now(),
        "src": "hook",
        "name": name,
        "pid": query_value(&url, "pid"),
        "winpid": query_value(&url, "winpid"),
        "event": event,
    }));
    // Git Bash numbers its own processes, so on Windows only winpid is a real process id.
    let pid_key = if cfg!(windows) { "winpid" } else { "pid" };
    let pid = query_value(&url, pid_key).and_then(|v| v.parse().ok());
    let sent = query_value(&url, "ts").and_then(|v| v.parse().ok());
    let event = state::translate("hook", &event).map(|e| e.with_process(pid, sent));
    update_state(&app, event);
}

// While Sprout is shown: lets clicks reach the window only while the cursor
// is over Sprout, and sends the cursor to the page ("cursor", window points)
// when it moves, so the eyes follow it anywhere on screen. Tells the page when
// the cursor comes onto or leaves Sprout ("hover"), for compact working.
// Only asks the window to change when the answer changes.
fn watch_cursor(window: tauri::WebviewWindow) {
    let mut ignoring = true;
    let mut hovering = false;
    let mut last = None;
    loop {
        let shown = SHOWN.load(Ordering::Relaxed);
        let cursor = if shown {
            cursor_in_window(&window).ok()
        } else {
            None
        };
        if cursor.is_some() && cursor != last {
            let _ = window.emit("cursor", cursor);
        }
        last = cursor;
        let over = cursor.is_some_and(over_sprout);
        if over != hovering {
            hovering = over;
            let _ = window.emit("hover", over);
        }
        if over == ignoring && window.set_ignore_cursor_events(!over).is_ok() {
            ignoring = !over;
            eprintln!("blip: clicks {}", if over { "on" } else { "off" });
        }
        if shown {
            thread::sleep(CURSOR_POLL);
        } else {
            thread::park(); // update_state wakes it when Sprout shows
        }
    }
}

// Cursor and window are both in physical pixels from the main screen's
// top-left; the page works in points, so scale it.
fn cursor_in_window(window: &tauri::WebviewWindow) -> tauri::Result<(f64, f64)> {
    let cursor = window.cursor_position()?;
    let origin = window.outer_position()?;
    let scale = window.scale_factor()?;
    Ok((
        (cursor.x - origin.x as f64) / scale,
        (cursor.y - origin.y as f64) / scale,
    ))
}

fn over_sprout((x, y): (f64, f64)) -> bool {
    let hit = *SPROUT_BOX.lock().unwrap_or_else(|p| p.into_inner());
    hit.is_some_and(|hit| x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h)
}

fn machine(app: &AppHandle) -> MutexGuard<'_, state::Machine> {
    app.state::<Mutex<state::Machine>>()
        .inner()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// Feeds one event (or none, for the timer) and tells the page if the state or its snippet changed.
fn update_state(app: &AppHandle, event: Option<state::Event>) {
    let mut machine = machine(app);
    let now = now();
    if let Some(event) = event {
        machine.handle(event, now);
        if let Some(thread) = STATE_THREAD.get() {
            thread.unpark();
        }
    }
    if let Some(shown) = machine.changed(now) {
        // Only the state: the snippet is the user's text and stays out of the log.
        eprintln!("blip: state {:?}", shown.state);
        SHOWN.store(shown.state != state::State::Hidden, Ordering::Relaxed);
        if let Some(thread) = CURSOR_THREAD.get() {
            thread.unpark();
        }
        let _ = app.emit("blip-state", shown);
    }
}

// Sleeps until "Done" is due to show or hide, or the next process check while
// sessions are open. With nothing open and nothing due, it sleeps until an event.
fn watch_state(app: AppHandle) {
    let mut checked = now();
    loop {
        let (due, open) = {
            let machine = machine(&app);
            (machine.next_change(now()), !machine.is_empty())
        };
        let check = open.then_some(checked + ALIVE_CHECK);
        match due.into_iter().chain(check).min_by(f64::total_cmp) {
            Some(at) => thread::park_timeout(Duration::from_secs_f64((at - now()).max(0.0))),
            None => thread::park(),
        }
        if open && now() >= checked + ALIVE_CHECK {
            checked = now();
            let processes = machine(&app).processes();
            // Checked without holding the lock, so events never wait on it.
            for (session, pid) in processes {
                if !is_running(pid) {
                    machine(&app).end(&session);
                }
            }
        }
        update_state(&app, None);
    }
}

// True unless the check says for sure the process is gone, so a failed check never ends a session.
fn is_running(pid: u32) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        match output {
            Ok(out) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout).contains(&format!("\"{pid}\""))
            }
            _ => true,
        }
    }
    #[cfg(not(windows))]
    {
        // kill -0 sends nothing; it only asks whether the process exists.
        let status = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        status.map_or(true, |s| s.success())
    }
}

// One value from the query part of a URL such as /hook?pid=12&winpid=34.
fn query_value(url: &str, key: &str) -> Option<String> {
    let (_, query) = url.split_once('?')?;
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.to_string())
}

// The mod's folder. USERPROFILE first, the same order as the mod (register.js).
fn inbox_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(Path::new(&home).join(".blip").join("inbox"))
}

#[derive(Debug, PartialEq)]
enum InboxAction {
    Deliver,
    Wait,
    Drop,
}

// What to do with one inbox file. The mod's write is not atomic and the mods
// API has no rename, so a file that does not parse may still be being written.
fn inbox_action(parses: bool, age: Duration) -> InboxAction {
    if age > STALE {
        InboxAction::Drop
    } else if parses {
        InboxAction::Deliver
    } else if age > HALF_WRITTEN {
        InboxAction::Drop
    } else {
        InboxAction::Wait
    }
}

// Runs on its own thread. A folder check every INBOX_POLL; nothing the mod
// does can reach this thread, it only ever sees files.
fn watch_inbox(app: AppHandle) {
    let Some(dir) = inbox_dir() else {
        eprintln!("blip: no home folder, mod events are off");
        return;
    };
    // Odd entries already reported, so each is logged once, not every poll.
    let mut reported = HashSet::new();
    loop {
        // Made here, not once at start, so a folder that was missing or
        // deleted comes back without a restart. The mod also makes it.
        let _ = fs::create_dir_all(&dir);
        if let Ok(listing) = list_inbox(&dir) {
            // The mod never makes links. Removing one never touches its target.
            for link in listing.links {
                let _ = fs::remove_file(&link);
            }
            // Folders and other kinds: Blip did not make them, so it leaves them.
            for other in listing.others {
                if reported.insert(other.clone()) {
                    record(
                        serde_json::json!({ "ts": now(), "src": "mod", "ignored": other.file_name().map(|n| n.to_string_lossy()) }),
                    );
                }
            }
            for path in listing.files {
                read_inbox_file(&path, &app);
            }
        }
        thread::sleep(INBOX_POLL);
    }
}

#[derive(Debug, Default, PartialEq)]
struct InboxListing {
    // Regular files, oldest first: names start with the mod's time stamp.
    files: Vec<PathBuf>,
    links: Vec<PathBuf>,
    // Folders, pipes and anything else
    others: Vec<PathBuf>,
}

// The *.json entries in the inbox by kind. Links are not followed.
fn list_inbox(dir: &Path) -> io::Result<InboxListing> {
    let mut listing = InboxListing::default();
    for entry in fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|ext| ext == "json") {
            continue;
        }
        match entry.file_type() {
            Ok(kind) if kind.is_file() => listing.files.push(path),
            Ok(kind) if kind.is_symlink() => listing.links.push(path),
            _ => listing.others.push(path),
        }
    }
    listing.files.sort();
    Ok(listing)
}

// The text of one inbox file, at most MAX_BODY like the listener. None for
// anything that is not a regular file once open, so a file swapped for a pipe
// after the listing can never block this thread: on Mac the open does not
// wait (O_NONBLOCK, 0x4 in <sys/fcntl.h>). Windows keeps pipes outside the
// file system, so a folder there cannot hold one.
fn read_inbox_text(path: &Path) -> Option<String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "macos")]
    std::os::unix::fs::OpenOptionsExt::custom_flags(&mut options, 0x4);
    let file = options.open(path).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut text = String::new();
    file.take(MAX_BODY).read_to_string(&mut text).ok()?;
    Some(text)
}

fn read_inbox_file(path: &Path, app: &AppHandle) {
    let Ok(modified) = fs::metadata(path).and_then(|meta| meta.modified()) else {
        return; // gone already
    };
    let age = file_age(modified, SystemTime::now());
    let parsed = read_inbox_text(path)
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());

    match inbox_action(parsed.is_some(), age) {
        InboxAction::Wait => {}
        InboxAction::Drop => {
            record(
                serde_json::json!({ "ts": now(), "src": "mod", "dropped": path.file_name().map(|n| n.to_string_lossy()), "age_s": age.as_secs_f64() }),
            );
            let _ = fs::remove_file(path);
        }
        InboxAction::Deliver => {
            // Delivered only once it is gone, so a file that cannot be deleted
            // (locked by antivirus on Windows, say) never repeats every poll.
            if fs::remove_file(path).is_err() {
                return;
            }
            let event = parsed.unwrap_or_default();
            let name = event
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            record(serde_json::json!({ "ts": now(), "src": "mod", "name": name, "event": event }));
            update_state(app, state::translate("mod", &event));
        }
    }
}

// How long ago the file was written. A time in the future (the clock was set
// back) counts by its distance too, so such a file still gets old and dropped.
fn file_age(modified: SystemTime, now: SystemTime) -> Duration {
    now.duration_since(modified)
        .unwrap_or_else(|ahead| ahead.duration())
}

// Seconds since 1970 with milliseconds, like the Phase 0 logs.
fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

// Appends one line to logs/received.jsonl in the repo, for step 3's tests.
// Dev builds only: the path is this repo on the machine that built Blip, and
// the log holds prompts and code (logs/ is never committed).
#[cfg(debug_assertions)]
mod received_log {
    use std::fs::{self, File, OpenOptions};
    use std::io::Write;
    use std::path::Path;
    use std::sync::Mutex;

    // Opened once. One writer at a time, so two events never mix their lines.
    static LOG: Mutex<Option<File>> = Mutex::new(None);
    // Past this size the log moves to received.old.jsonl and starts again.
    const MAX_LOG: u64 = 20 * 1024 * 1024;

    pub fn record(line: serde_json::Value) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../logs");
        let path = dir.join("received.jsonl");
        let Ok(mut log) = LOG.lock() else {
            return;
        };
        let too_big = log
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .is_some_and(|meta| meta.len() > MAX_LOG);
        if too_big {
            *log = None;
            let _ = fs::rename(&path, dir.join("received.old.jsonl"));
        }
        if log.is_none() {
            let _ = fs::create_dir_all(&dir);
            *log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .ok();
        }
        if let Some(file) = log.as_mut() {
            let _ = writeln!(file, "{line}");
        }
    }
}

#[cfg(debug_assertions)]
use received_log::record;

#[cfg(not(debug_assertions))]
fn record(_line: serde_json::Value) {}

// The hook event name, also from a message cut off at MAX_BODY: Claude Code
// puts hook_event_name near the start, so it survives the cut.
fn event_name(body: &[u8]) -> String {
    if let Ok(event) = serde_json::from_slice::<serde_json::Value>(body)
        && let Some(name) = event.get("hook_event_name").and_then(|v| v.as_str())
    {
        return name.to_string();
    }
    String::from_utf8_lossy(body)
        .split_once("\"hook_event_name\"")
        .and_then(|(_, rest)| rest.split('"').nth(1))
        .unwrap_or("unknown")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        InboxAction, event_name, file_age, inbox_action, list_inbox, query_value, read_inbox_text,
    };
    use std::fs;
    use std::time::{Duration, SystemTime};

    // A real file, a folder, a link and a pipe, all named like mod files.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_inbox_reads_only_regular_files_and_never_blocks() {
        let dir = std::env::temp_dir().join(format!("blip-inbox-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("2-folder.json")).unwrap();
        fs::write(dir.join("3-real.json"), "{}").unwrap();
        fs::write(dir.join("1-real.json"), "{}").unwrap();
        fs::write(dir.join("notes.txt"), "not for Blip").unwrap();
        std::os::unix::fs::symlink(dir.join("1-real.json"), dir.join("4-link.json")).unwrap();
        let made = std::process::Command::new("mkfifo")
            .arg(dir.join("5-pipe.json"))
            .status()
            .unwrap();
        assert!(made.success());

        let mut listing = list_inbox(&dir).unwrap();
        listing.others.sort();
        assert_eq!(
            listing.files,
            [dir.join("1-real.json"), dir.join("3-real.json")]
        );
        assert_eq!(listing.links, [dir.join("4-link.json")]);
        assert_eq!(
            listing.others,
            [dir.join("2-folder.json"), dir.join("5-pipe.json")]
        );

        assert_eq!(
            read_inbox_text(&dir.join("1-real.json")).as_deref(),
            Some("{}")
        );
        // Would hang here if opening a pipe waited for a writer
        assert_eq!(read_inbox_text(&dir.join("5-pipe.json")), None);
        assert_eq!(read_inbox_text(&dir.join("2-folder.json")), None);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_dated_in_the_future_still_ages() {
        let now = SystemTime::now();
        let hour = Duration::from_secs(3600);
        assert_eq!(file_age(now - hour, now), hour);
        assert_eq!(file_age(now + hour, now), hour);
    }

    #[test]
    fn reads_the_process_ids_from_the_url() {
        assert_eq!(query_value("/hook?pid=812", "pid").as_deref(), Some("812"));
        assert_eq!(
            query_value("/hook?pid=812&winpid=9040", "winpid").as_deref(),
            Some("9040")
        );
        assert_eq!(query_value("/hook?pid=812", "winpid"), None);
        assert_eq!(query_value("/", "pid"), None);
    }

    #[test]
    fn inbox_files_are_delivered_waited_for_or_dropped() {
        let ms = Duration::from_millis;
        assert_eq!(inbox_action(true, ms(50)), InboxAction::Deliver);
        // Half written: wait, then give up
        assert_eq!(inbox_action(false, ms(50)), InboxAction::Wait);
        assert_eq!(inbox_action(false, ms(2500)), InboxAction::Drop);
        // Left while Blip was closed
        assert_eq!(
            inbox_action(true, Duration::from_secs(31)),
            InboxAction::Drop
        );
    }

    #[test]
    fn reads_the_name_from_a_full_message() {
        assert_eq!(
            event_name(br#"{"session_id":"a","hook_event_name":"Stop"}"#),
            "Stop"
        );
    }

    #[test]
    fn reads_the_name_from_a_cut_off_message() {
        assert_eq!(
            event_name(br#"{"hook_event_name": "PermissionRequest","tool_input":{"con"#),
            "PermissionRequest"
        );
    }

    #[test]
    fn broken_or_empty_messages_give_unknown() {
        assert_eq!(event_name(b""), "unknown");
        assert_eq!(event_name(b"not json"), "unknown");
        assert_eq!(event_name(b"\xff\xfe\x00"), "unknown");
        assert_eq!(event_name(br#"{"other":"x"}"#), "unknown");
    }
}
