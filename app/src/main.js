// Sprout follows the state Blip's Rust side sends as "blip-state".
const { listen } = window.__TAURI__.event;

// Body size in CSS pixels. The window (tauri.conf.json, 660 x 136) fits its
// 128 x 163 canvas (raised 34 px in styles.css) plus the widest bubble line
// (277 px) beside the body on either side.
const SIZE = 64;
const canvas = document.querySelector("#sprout");
const box = BlipSprout.canvasSize(SIZE);
canvas.style.width = box.width + "px";
canvas.style.height = box.height + "px";
const sprout = BlipSprout.create(canvas, { size: SIZE, bubbleBeside: true });

// Tell Rust where Sprout's body is (window points), so clicks only land there.
// The body is centred at 60% of the canvas height; the box adds the antenna.
const { emit } = window.__TAURI__.event;
function sendBox() {
  const r = canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height * 0.6;
  emit("sprout-box", { x: cx - SIZE * 0.6, y: cy - SIZE * 0.85, w: SIZE * 1.2, h: SIZE * 1.4 });
}
sendBox();
new ResizeObserver(sendBox).observe(canvas);

// Rust names match Sprout's, except "needs_you" (Sprout calls it "needs").
const NAMES = { needs_you: "needs" };

listen("blip-state", (event) => {
  sprout.setState(NAMES[event.payload] || event.payload);
});
