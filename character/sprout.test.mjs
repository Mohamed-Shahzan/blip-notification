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
// leave it on old code (code review 10 Nov).
test("the website's copy matches", () => {
  const copy = readFileSync(new URL("../docs/sprout.js", import.meta.url), "utf8");
  assert.equal(copy, code, "copy character/sprout.js to docs/sprout.js");
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
  let now = 0, rafs = [], timers = [], id = 0;
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}),
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
  return { BlipSprout: context.BlipSprout, canvas, run, frames: () => rafs.length };
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
