// Sprout follows the state Blip's Rust side sends as "blip-state".
const { listen } = window.__TAURI__.event;

// Body size in CSS pixels. The window (tauri.conf.json, 620 x 136) fits its
// 128 x 163 canvas (raised 34 px in styles.css) plus the widest bubble line
// (277 px) on either side.
const SIZE = 64;
const canvas = document.querySelector("#sprout");
const box = BlipSprout.canvasSize(SIZE);
canvas.style.width = box.width + "px";
canvas.style.height = box.height + "px";
const sprout = BlipSprout.create(canvas, { size: SIZE });

// Rust names match Sprout's, except "needs_you" (Sprout calls it "needs").
const NAMES = { needs_you: "needs" };

listen("blip-state", (event) => {
  sprout.setState(NAMES[event.payload] || event.payload);
});
