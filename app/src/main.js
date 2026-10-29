// Sprout follows the state Blip's Rust side sends as "blip-state".
const { listen } = window.__TAURI__.event;

const SIZE = 32; // body size in CSS pixels
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
