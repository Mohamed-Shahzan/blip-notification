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

listen("blip-state", (event) => {
  sprout.setState(NAMES[event.payload] || event.payload);
  sendBox();
});

listen("cursor", (event) => {
  const [x, y] = event.payload;
  sprout.lookAt(x, y);
});
