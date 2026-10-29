// Pulse the blob once for every event the listener receives.
const { listen, emit } = window.__TAURI__.event;

const blob = document.querySelector(".blob");

listen("blip-event", (event) => {
  blob.classList.remove("pulse");
  void blob.offsetWidth; // restart the animation if it is already running
  blob.classList.add("pulse");
  // Phase 0 check: tell Rust the page got the event, so it shows in the dev log.
  emit("blip-pulsed", event.payload);
});
