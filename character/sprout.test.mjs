// Copyright (c) 2026 Mohamed. All rights reserved. See LICENSE.
// Tests for sprout.js that need no browser. Run: node --test character/sprout.test.mjs
// sprout.js is a plain script that sets BlipSprout on its global, so each test
// loads it into a fresh context with the platform it should see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("./sprout.js", import.meta.url), "utf8");

function load(platform) {
  const context = vm.createContext({ navigator: { platform } });
  vm.runInContext(code, context);
  return context.BlipSprout;
}

// Code review 10 Nov: on the Mac a Control-click (the right-click) opened the session.
test("a Mac Control-click is not a main press", () => {
  const { isMainPress } = load("MacIntel");
  assert.equal(isMainPress({ button: 0, ctrlKey: false }), true);
  assert.equal(isMainPress({ button: 0, ctrlKey: true }), false);
  assert.equal(isMainPress({ button: 2, ctrlKey: false }), false);
});

test("on Windows Control-click stays a main press", () => {
  const { isMainPress } = load("Win32");
  assert.equal(isMainPress({ button: 0, ctrlKey: true }), true);
  assert.equal(isMainPress({ button: 2, ctrlKey: false }), false);
});

// The website loads docs/sprout.js, a copy of this one: a missed copy would
// leave it on old code (code review 10 Nov). The copy has one change on purpose
// (22 Nov, docs/DECISIONS.md): a note at the top and the bubble placement measured
// as drawn, for the shrunk phone playground. The test builds the expected copy from
// this file plus exactly those changes, so any other difference still fails.
const WEBSITE_CHANGES = [
  ["// Copyright (c) 2026 Mohamed. All rights reserved. See LICENSE.\n",
   "// Copyright (c) 2026 Mohamed. All rights reserved. See LICENSE.\n// WEBSITE COPY. This file is character/sprout.js plus one change, on purpose (decided 22 Nov 2026, see docs/DECISIONS.md):\n// the bubble placement (search \"Measured as drawn\") uses Sprout's size as drawn on screen, so the bubble sits beside\n// Sprout when the page shrinks it (the phone playground). The app never shrinks Sprout and keeps the original lines.\n// When copying a newer character/sprout.js here, carry that block over (4 lines use k and hw), or the phone bubble lands on Sprout again.\n"],
  ["      // or with opts.bubbleBeside beside the body at eye level (48, 6), for a window with little room above.\n      const r = canvas.getBoundingClientRect(), u = drawPx() / UNITS_PER_SIZE;\n",
   "      // or with opts.bubbleBeside beside the body at eye level (48, 6), for a window with little room above.\n      // Measured as drawn: on a page that shrinks Sprout's container (a CSS transform), k is that shrink, so the\n      // offsets and Sprout's half-width match what is on screen. Without a transform k is 1 and nothing changes.\n      const r = canvas.getBoundingClientRect(), k = cw ? r.width / cw : 1, u = drawPx() / UNITS_PER_SIZE * k, hw = r.width / 2;\n"],
  ["      let left = r.left + cw / 2 + bx * u;\n      const room = root.innerWidth - EDGE - left, roomLeft = r.left + cw / 2 - bx * u - EDGE;\n",
   "      let left = r.left + hw + bx * u;\n      const room = root.innerWidth - EDGE - left, roomLeft = r.left + hw - bx * u - EDGE;\n"],
  ["      if (flip) left = Math.max(EDGE, r.left + cw / 2 - bx * u - bubble.offsetWidth);\n",
   "      if (flip) left = Math.max(EDGE, r.left + hw - bx * u - bubble.offsetWidth);\n"],
  ["      const anchor = r.top + root.scrollY + ch * .6 + by * u, h = bubble.offsetHeight;\n",
   "      const anchor = r.top + root.scrollY + r.height * .6 + by * u, h = bubble.offsetHeight;\n"]
];
test("the website's copy is this file plus its bubble change", () => {
  let want = code;
  for (const [from, to] of WEBSITE_CHANGES) {
    assert.ok(want.includes(from), "the website's bubble change no longer fits sprout.js; update it here and in docs/sprout.js: " + from.trim());
    want = want.replace(from, to);
  }
  const copy = readFileSync(new URL("../docs/sprout.js", import.meta.url), "utf8");
  assert.equal(copy, want, "copy character/sprout.js to docs/sprout.js and carry over the bubble block");
});

// Power while peeking (13 Nov): the peek holds still and sways once every 30 s
// for 2.4 s, so between sways nothing needs drawing.
test("the peek is still between sways and sways now and then", () => {
  const { peekSway, peekSwayWait } = load("MacIntel");
  assert.equal(peekSway(0), 0); // just began: still
  assert.equal(peekSway(10), 0);
  assert.equal(peekSwayWait(10), 17.6); // first sway starts at 27.6 s
  assert.ok(peekSway(28.8) > 0.49 && peekSway(28.8) < 0.51); // halfway through it
  assert.equal(peekSwayWait(28.8), 0);
  assert.equal(peekSway(30.5), 0); // over: still again
  assert.ok(Math.abs(peekSwayWait(30.5) - 27.1) < 1e-9); // next at 57.6 s
  assert.ok(peekSway(59) > 0); // and again every 30 s
});

// A browser stand-in with a hand-driven clock: frames run only when the test
// says so, timers fire when the clock passes them.
function fakeBrowser() {
  let now = 0, rafs = [], timers = [], id = 0, resizeCb = null, listeners = [], reduce = false;
  let drawn = 0;
  const ctx = new Proxy({}, {
    get: (o, k) => (k === "clearRect" ? () => { drawn++; } : k in o ? o[k] : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}),
    set: (o, k, v) => ((o[k] = v), true),
  });
  const canvas = {
    clientWidth: 900, clientHeight: 136, width: 0, height: 0,
    getContext: () => ctx, addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 136 }),
  };
  const context = vm.createContext({
    navigator: { platform: "MacIntel" }, devicePixelRatio: 2, Math, Date,
    performance: { now: () => now },
    requestAnimationFrame: (f) => (rafs.push([++id, f]), id),
    cancelAnimationFrame: (i) => { rafs = rafs.filter(([j]) => j !== i); },
    setTimeout: (f, ms = 0) => (timers.push([++id, now + ms, f]), id),
    clearTimeout: (i) => { timers = timers.filter(([j]) => j !== i); },
    addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { constructor(f) { resizeCb = f; } observe() {} disconnect() {} },
    matchMedia: (q) => {
      const mq = { query: q, get matches() { return q.includes("reduce") && reduce; }, addEventListener: (t, f, o) => listeners.push({ mq, f, once: o && o.once }), removeEventListener: (t, f) => { listeners = listeners.filter((l) => l.f !== f); } };
      return mq;
    },
  });
  vm.runInContext(code, context);
  // Advance the clock by ms in 16 ms frames, firing due timers on the way.
  function run(ms) {
    for (const end = now + ms; now < end; ) {
      now += 16;
      for (const t of timers.filter(([, at]) => at <= now)) { timers = timers.filter((x) => x !== t); t[2](); }
      const due = rafs; rafs = [];
      for (const [, f] of due) f(now);
    }
  }
  // The browser reports a change: a resize, another pixel ratio, Reduce Motion switched.
  const fire = (part) => { for (const l of listeners.filter((l) => l.mq.query.includes(part))) { if (l.once) listeners = listeners.filter((x) => x !== l); l.f(); } };
  return {
    BlipSprout: context.BlipSprout, canvas, run, frames: () => rafs.length, drawn: () => drawn,
    resize: () => resizeCb(),
    setRatio: (r) => { context.devicePixelRatio = r; fire("dppx"); },
    setReduce: (on) => { reduce = on; fire("reduce"); },
  };
}

test("a peek at rest stops drawing and wakes up to sway", () => {
  const b = fakeBrowser();
  const sprout = b.BlipSprout.create(b.canvas, { size: 32, bubble: false, pointer: false, handlePress: false, date: () => new Date(2026, 0, 2) });
  sprout.setState("done");
  sprout.setPeek(true);
  b.run(5000); // goes up and settles
  assert.equal(sprout.running, false, "settled peek still drawing");
  b.run(20000); // still resting at 25 s
  assert.equal(sprout.running, false);
  b.run(4000); // 29 s: inside the first sway (27.6 to 30 s)
  assert.equal(sprout.running, true, "no sway after 30 s");
  b.run(3000); // 32 s: the sway is over
  assert.equal(sprout.running, false, "still drawing after the sway");
  sprout.setHover("body"); // the pointer rests on the peek: it grows, then rests again
  b.run(2000);
  assert.equal(sprout.running, false, "a pointer on the peek keeps it drawing");
});

function peekAtRest(date = new Date(2026, 0, 2)) {
  const b = fakeBrowser();
  const sprout = b.BlipSprout.create(b.canvas, { size: 32, bubble: false, pointer: false, handlePress: false, date: () => date });
  sprout.setState("done");
  sprout.setPeek(true);
  return { b, sprout };
}

// Code review 13 Nov: things that change while the peek rests must wake the loop.
test("a resize wakes a resting peek, which draws again and rests", () => {
  const { b, sprout } = peekAtRest();
  b.run(5000);
  assert.equal(sprout.running, false);
  b.resize();
  assert.equal(sprout.running, true, "a resize clears the canvas: it must draw again");
  b.run(2000);
  assert.equal(sprout.running, false);
});

test("a new pixel ratio wakes a resting peek and is picked up", () => {
  const { b, sprout } = peekAtRest();
  b.run(5000);
  assert.equal(b.canvas.width, 1800); // 900 wide at ratio 2
  b.setRatio(1);
  assert.equal(sprout.running, true);
  b.run(500);
  assert.equal(b.canvas.width, 900);
  b.setRatio(2); // the watch re-arms: a second move is noticed too
  b.run(500);
  assert.equal(b.canvas.width, 1800);
});

test("Reduce Motion: no sway, and switching it off wakes the peek", () => {
  const { b, sprout } = peekAtRest();
  b.setReduce(true);
  b.run(40000); // no sway at 28 s, and no timer to wake it
  assert.equal(sprout.running, false);
  b.setReduce(false);
  assert.equal(sprout.running, true);
  b.run(2000);
  b.run(30000);
  assert.equal(sprout.running, false, "swaying again then resting");
});

test("birthday confetti finishes before the peek rests", () => {
  const { b, sprout } = peekAtRest(new Date(2026, 9, 18)); // 18 Oct
  b.run(3000);
  assert.equal(sprout.running, true, "confetti still falling");
  b.run(2500);
  assert.equal(sprout.running, false);
});

test("a colour change keeps a resting peek drawing until it has finished", () => {
  const { b, sprout } = peekAtRest();
  b.run(5000);
  assert.equal(sprout.running, false);
  sprout.setState("error"); // a new state starts a colour blend
  b.run(100);
  assert.equal(sprout.running, true, "stopped in the middle of the colour change");
  b.run(3000);
  assert.equal(sprout.running, false);
});

test("a peek that ends leaves no sway timer behind", () => {
  const { b, sprout } = peekAtRest();
  b.run(5000);
  sprout.setState("hidden");
  sprout.setPeek(false);
  b.run(2000);
  const before = b.drawn();
  b.run(40000); // a stale timer would wake the loop at about 27 s
  assert.equal(b.drawn(), before);
});
