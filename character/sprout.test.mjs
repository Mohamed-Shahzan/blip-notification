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
