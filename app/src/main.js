// Sprout follows the state Blip's Rust side sends as "blip-state".
const { listen, emit } = window.__TAURI__.event;

// Body size in CSS pixels. The window (tauri.conf.json, 660 x 136) fits its
// 128 x 163 canvas (raised 34 px in styles.css) plus the widest bubble line
// (277 px) beside the body on either side.
const SIZE = 64;
const canvas = document.querySelector("#sprout");
const box = BlipSprout.canvasSize(SIZE);
canvas.style.width = box.width + "px";
canvas.style.height = box.height + "px";
// pointer: false, since the page only sees the mouse over Sprout itself. Rust
// sends the cursor from anywhere on screen instead ("cursor", window points).
const sprout = BlipSprout.create(canvas, {
  size: SIZE,
  bubbleBeside: true,
  pointer: false,
  settings: { lookRange: 1.75 }, // eyes travel further than the default (Mohamed, 29 Oct)
  compactTop: 34, // the window's top edge: the canvas is raised 34 px in styles.css
});

// Tell Rust where Sprout's body is (window points), so clicks only land there.
// Sent again on every state change, in case the first one came before Rust listened.
function sendBox() {
  emit("sprout-box", sprout.bodyBox());
}
sendBox();
new ResizeObserver(sendBox).observe(canvas);

// Rust names match Sprout's, except "needs_you" (Sprout calls it "needs").
const NAMES = { needs_you: "needs" };

// Sprout says its line when it changes to one of these. Working stays quiet,
// since it starts every turn. Done's bubble closes when Rust hides Sprout.
const SPEAKS = ["needs", "done", "error"];
const SPEAK_FOR = 6000;
// Several permissions in a row flip needs you and working back and forth;
// the same line with the same snippet again this soon stays unsaid.
const REPEAT_GAP = 10000;
let spoke = { state: "", text: null, at: -Infinity };
// The latest snippet from Rust, so a right-click can redraw the bubble with or without it.
let lastText = null;

// The message snippet under the line (PRD Level 1). Right-click Sprout hides or
// shows it; the choice is kept between launches.
const SHOW_TEXT = "blip.showText";
let showText = true;
try {
  showText = localStorage.getItem(SHOW_TEXT) !== "off";
} catch {}
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  showText = !showText;
  try {
    localStorage.setItem(SHOW_TEXT, showText ? "on" : "off");
  } catch {}
  // In a state with a line, show it again with the snippet added or taken away;
  // otherwise say what changed.
  if (SPEAKS.includes(sprout.state)) speak();
  else sprout.say(showText ? "Message text on" : "Message text off", true, 1500, null);
});

function speak() {
  sprout.say(sprout.line, true, SPEAK_FOR, showText ? lastText : null);
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
let pointer = null; // the cursor's last position (window points)
let shownState = "";

function setCompact(on) {
  if (sprout.compact !== on) {
    sprout.setCompact(on);
    sendBox();
  }
}

function overSprout() {
  if (!pointer) return false;
  const b = sprout.bodyBox();
  return pointer[0] >= b.x && pointer[0] <= b.x + b.w && pointer[1] >= b.y && pointer[1] <= b.y + b.h;
}

// Shrinks unless the pointer is on Sprout; then checks again a little later.
function shrinkWhenFree() {
  clearTimeout(shrinkTimer);
  if (overSprout()) shrinkTimer = setTimeout(shrinkWhenFree, SHRINK_AGAIN);
  else setCompact(true);
}

function goSmall() {
  small = true;
  if (toldLong) return shrinkWhenFree();
  toldLong = true;
  sprout.say(LONG_LINE, true, LONG_FOR, null);
  shrinkTimer = setTimeout(shrinkWhenFree, LONG_FOR);
}

function compactFor(state) {
  clearTimeout(shrinkTimer);
  small = false;
  setCompact(false);
  if (state === "working") shrinkTimer = setTimeout(goSmall, SHRINK_AFTER);
  else if (state !== "needs") toldLong = false;
}

// A click on the small form brings full Sprout back, like hovering.
canvas.addEventListener("pointerdown", () => {
  if (small) {
    setCompact(false);
    shrinkTimer = setTimeout(shrinkWhenFree, SHRINK_AGAIN);
  }
});

listen("blip-state", (event) => {
  const { text } = event.payload;
  const state = NAMES[event.payload.state] || event.payload.state;
  lastText = text;
  sprout.setState(state);
  // Rust also resends the same state when only its snippet changes.
  if (state !== shownState) compactFor(state);
  shownState = state;
  const now = performance.now();
  if (state === "hidden") spoke = { state: "", text: null, at: -Infinity };
  const repeat = spoke.state === state && spoke.text === text && now - spoke.at < REPEAT_GAP;
  if (SPEAKS.includes(state) && !repeat) {
    speak();
    spoke = { state, text, at: now };
  }
  sendBox();
});

listen("cursor", (event) => {
  const [x, y] = event.payload;
  sprout.lookAt(x, y);
  pointer = [x, y];
  if (small && overSprout()) {
    setCompact(false);
    clearTimeout(shrinkTimer);
    shrinkTimer = setTimeout(shrinkWhenFree, SHRINK_AGAIN);
  }
});
