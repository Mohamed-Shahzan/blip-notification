// Sprout follows the state Blip's Rust side sends as "blip-state".
const { listen, emit } = window.__TAURI__.event;

// Body size in CSS pixels. The window (tauri.conf.json, 900 x 136) fits its
// 128 x 163 canvas (raised 34 px in styles.css) plus a bubble of about 400 px
// beside the body, so the done bubble with its hint and x fits on the right
// (at 660 px it was pushed over Sprout's head, 9 Nov). Longer lines wrap.
const SIZE = 64;
const canvas = document.querySelector("#sprout");
const box = BlipSprout.canvasSize(SIZE);
canvas.style.width = box.width + "px";
canvas.style.height = box.height + "px";
// pointer: false, since the page only sees the mouse over Sprout itself. Rust
// sends the cursor from anywhere on screen instead ("cursor", window points).
// The peek's size, as a body size: the done-flow sketch (character/done-flow.html)
// showed it with a 32 px Sprout, and that is the size Mohamed picked on 9 Nov.
const PEEK_SIZE = 32;
// Clicks are Blip's (Rust's) to handle, not Sprout's own poke (DECISIONS 9 Nov, one click).
const sprout = BlipSprout.create(canvas, {
  size: SIZE,
  bubbleBeside: true,
  pointer: false,
  handlePress: false,
  peekSize: PEEK_SIZE,
  settings: { lookRange: 1.75 }, // eyes travel further than the default (Mohamed, 29 Oct)
  compactTop: 34, // the window's top edge: the canvas is raised 34 px in styles.css
});

// Tell Rust what can be clicked (window points): Sprout's body or the peek, and
// a bubble with an x, so clicks land there and pass through everywhere else.
// Sent again on every change, and once more after the bubble's 0.2 s grow.
let boxTimer = 0;
function sendBox() {
  emit("sprout-box", sprout.hitBoxes());
  clearTimeout(boxTimer);
  boxTimer = setTimeout(() => emit("sprout-box", sprout.hitBoxes()), 250);
}
sendBox();
new ResizeObserver(sendBox).observe(canvas);

// One click (DECISIONS 9 Nov): on Sprout or its bubble it opens the session's
// app, on the x it closes the bubble, on the peek Sprout says when Claude finished.
function click(what) {
  emit("blip-click", what);
}
canvas.style.cursor = "pointer";
canvas.addEventListener("pointerdown", (e) => {
  if (BlipSprout.isMainPress(e)) click(sprout.peek ? "peek" : "sprout");
});
const ACTS = { onClick: () => click("sprout"), onClose: () => click("x") };

// Rust names match Sprout's, except "needs_you" (Sprout calls it "needs").
const NAMES = { needs_you: "needs" };

// Sprout says its line when it changes to one of these. Working stays quiet,
// since it starts every turn. Done and error have their own bubble (doneBubble).
const SPEAKS = ["needs"];
const SPEAK_FOR = 6000;
// Several permissions in a row flip needs you and working back and forth;
// the same line with the same snippet again this soon stays unsaid.
const REPEAT_GAP = 10000;
let spoke = { state: "", text: null, at: -Infinity };
// The latest state from Rust, so a right-click can redraw the bubble with or without the snippet.
let last = { state: "hidden" };
// How long "Message text on/off" shows after a right-click.
const TOGGLE_FOR = 1500;
// Brings a quiet or recall bubble back after that line; a new right-click restarts it.
let toggleTimer = 0;
let lastText = null;

// The message snippet under the line (PRD Level 1). Right-click Sprout hides or
// shows it; the choice is kept between launches.
const SHOW_TEXT = "blip.showText";
let showText = true;
try {
  showText = localStorage.getItem(SHOW_TEXT) !== "off";
} catch {}
// On Sprout or its bubble (the window takes clicks only there): code review 10 Nov.
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // While peeking Sprout cannot say what changed, so nothing changes (code review 10 Nov).
  if (sprout.peek) return;
  showText = !showText;
  try {
    localStorage.setItem(SHOW_TEXT, showText ? "on" : "off");
  } catch {}
  // In a state with a line, show it again with the snippet added or taken away;
  // otherwise say what changed.
  // The done bubbles (also quiet, and the peek's recall) are redrawn as they
  // were: replacing them would lose the x (code review 9 Nov). The quiet and
  // recall bubbles never show the snippet, so they first say what changed,
  // then come back unless the state moved on (code review 10 Nov).
  const bubbled = last.state === "done" || last.state === "error";
  if (bubbled && !last.quiet && !last.recall) doneBubble(last, true);
  else if (bubbled || last.recall) {
    const was = last;
    sprout.say(showText ? "Message text on" : "Message text off", true, TOGGLE_FOR, null);
    clearTimeout(toggleTimer);
    toggleTimer = setTimeout(() => {
      if (last !== was) return;
      doneBubble(last, true);
      sendBox(); // the x is back: its hit box too
    }, TOGGLE_FOR);
  } else if (SPEAKS.includes(sprout.state) && !sprout.peek) speak();
  else sprout.say(showText ? "Message text on" : "Message text off", true, TOGGLE_FOR, null);
  sendBox();
});

function speak() {
  sprout.say(sprout.line, true, SPEAK_FOR, showText ? lastText : null);
}

// The done bubble (DECISIONS 9 Nov, "Done line"): "All done. Click me to open
// your session" and the project line; Claude's first line too when message
// text is on. Stays until the x. With the app already in front (quiet): "All
// done" and the project for about 5 s, no x (Rust hides it). The peek's recall:
// "All done, <time>. Click me to open your session". Without a known app a
// click cannot open anything, so no hint. Only said again when it changes.
// An error has the same bubble, x and peek (Mohamed, 18 Nov), with
// "Something went wrong" and the error's text; it is never quiet.
let doneSaid = "";
function doneBubble(s, force) {
  const hint = s.app ? ". Click me to open your session" : "";
  const more = s.more ? `+${s.more} more finished` : null;
  const said = s.error ? "Something went wrong" : "All done";
  let line, detail;
  if (s.recall) {
    line = `${said}, ${s.recall}${hint}`;
    detail = [s.project, more];
  } else if (s.quiet) {
    line = said;
    detail = [s.project];
  } else {
    line = `${said}${hint}`;
    detail = [s.project, more, showText ? s.text : null];
  }
  detail = detail.filter(Boolean);
  const key = JSON.stringify([line, detail, s.quiet]);
  if (key === doneSaid && !force) return;
  doneSaid = key;
  sprout.say(line, true, Infinity, detail, s.quiet ? undefined : ACTS);
}

// Compact working (Mohamed, 30 Oct): after SHRINK_AFTER in Working, Sprout says
// LONG_LINE once at full size and shrinks into its bulb when the bubble closes.
// The pointer on it brings full Sprout back; off it for SHRINK_AGAIN, it shrinks again.
// Any other state is always full size.
const SHRINK_AFTER = 20000;
const LONG_LINE = "This will take a while. I'll tell you when it's done.";
const LONG_FOR = 4000;
const SHRINK_AGAIN = 1500;
let shrinkTimer = 0;
let toldLong = false; // said once per task: reset when Sprout hides, is done or errors
let small = false; // whether Sprout should be small when the pointer is not on it
let hovering = false; // Rust says when the cursor is on Sprout ("hover"), as for clicks
let lastCursor = null; // the latest cursor from Rust, window points
let shownState = "";

function setCompact(on) {
  if (sprout.compact !== on) {
    sprout.setCompact(on);
    sendBox();
  }
}

function shrinkLater(ms) {
  clearTimeout(shrinkTimer);
  shrinkTimer = setTimeout(shrinkWhenFree, ms);
}

// Shrinks unless the pointer is on Sprout; then checks again a little later.
function shrinkWhenFree() {
  if (!small) return;
  if (hovering) shrinkLater(SHRINK_AGAIN);
  else setCompact(true);
}

function goSmall() {
  small = true;
  if (toldLong) return shrinkWhenFree();
  toldLong = true;
  sprout.say(LONG_LINE, true, LONG_FOR, null);
  shrinkLater(LONG_FOR);
}

function compactFor(state) {
  clearTimeout(shrinkTimer);
  small = false;
  setCompact(false);
  if (state === "working") shrinkTimer = setTimeout(goSmall, SHRINK_AFTER);
  else if (state !== "needs") toldLong = false;
}

// Hover (and so a click, which needs the pointer on it) brings full Sprout back.
listen("hover", (event) => {
  hovering = event.payload;
  sprout.setHover(hovering && lastCursor ? sprout.partAt(...lastCursor) : null);
  if (small && hovering) {
    setCompact(false);
    shrinkLater(SHRINK_AGAIN);
  }
});

listen("blip-state", (event) => {
  const s = event.payload;
  last = s;
  const { text } = s;
  // Rust's "peek" is Sprout in done (or error), peeking (setPeek); its recall comes back down.
  const peeking = s.state === "peek" && !s.recall;
  const finish = s.error ? "error" : "done";
  const state = s.state === "peek" ? finish : NAMES[s.state] || s.state;
  lastText = text;
  if (peeking) sprout.setPeek(true); // first, so going back to the peek is not a new done hop
  sprout.setState(state);
  if (!peeking) sprout.setPeek(false);
  // Rust also resends the same state when only its snippet changes.
  if (state !== shownState) compactFor(state);
  shownState = state;
  const now = performance.now();
  if (state === "hidden" || peeking) {
    spoke = { state: "", text: null, at: -Infinity };
    doneSaid = "";
  }
  if ((state === "done" || state === "error") && !peeking) doneBubble(s);
  else doneSaid = "";
  const repeat = spoke.state === state && spoke.text === text && now - spoke.at < REPEAT_GAP;
  if (SPEAKS.includes(state) && !repeat) {
    speak();
    spoke = { state, text, at: now };
  }
  sendBox();
});

// Blip is rarely the front app, so the page gets no hover of its own; Rust
// sends the cursor instead, and the part under it shows a hover cue.
listen("cursor", (event) => {
  const [x, y] = event.payload;
  lastCursor = [x, y];
  sprout.lookAt(x, y);
  sprout.setHover(hovering ? sprout.partAt(x, y) : null);
});
