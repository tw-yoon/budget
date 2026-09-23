import test from "node:test";
import assert from "node:assert/strict";
import {
  PRO_MODE_KEY,
  LEGACY_ANALYTICS_MODE_KEY,
  resolveProMode,
} from "../src/lib/pro-mode.ts";

test("a stored pro is honoured", () => {
  assert.equal(resolveProMode("pro"), "pro");
});

test("a stored normal stays normal", () => {
  assert.equal(resolveProMode("normal"), "normal");
});

test("an unrecognised string falls back to normal", () => {
  assert.equal(resolveProMode("expert"), "normal");
  assert.equal(resolveProMode(""), "normal");
  assert.equal(resolveProMode("PRO"), "normal");
});

test("a missing value falls back to normal", () => {
  assert.equal(resolveProMode(null), "normal");
  assert.equal(resolveProMode(undefined), "normal");
});

test("a value of the wrong type resolves rather than throwing", () => {
  for (const value of [0, 1, true, false, {}, [], { mode: "pro" }, ["pro"]]) {
    assert.equal(resolveProMode(value), "normal");
  }
});

test("the store keys are stable", () => {
  // PRO_MODE_KEY names a value written to data/ui-state.json on the user's
  // machine; changing it silently resets their preference. The legacy key is
  // still read as a fallback, so it has to stay exact too.
  assert.equal(PRO_MODE_KEY, "pro-mode");
  assert.equal(LEGACY_ANALYTICS_MODE_KEY, "analytics-mode");
});
