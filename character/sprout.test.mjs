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
