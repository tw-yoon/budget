import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_MODE_KEY,
  resolveAnalyticsMode,
} from "../src/lib/analytics-mode.ts";

test("a stored pro is honoured", () => {
  assert.equal(resolveAnalyticsMode("pro"), "pro");
});

test("a stored normal stays normal", () => {
  assert.equal(resolveAnalyticsMode("normal"), "normal");
});

test("an unrecognised string falls back to normal", () => {
  assert.equal(resolveAnalyticsMode("expert"), "normal");
  assert.equal(resolveAnalyticsMode(""), "normal");
  assert.equal(resolveAnalyticsMode("PRO"), "normal");
});

test("a missing value falls back to normal", () => {
  assert.equal(resolveAnalyticsMode(null), "normal");
  assert.equal(resolveAnalyticsMode(undefined), "normal");
});

test("a value of the wrong type resolves rather than throwing", () => {
  for (const value of [0, 1, true, false, {}, [], { mode: "pro" }, ["pro"]]) {
    assert.equal(resolveAnalyticsMode(value), "normal");
  }
});

test("the store key is stable", () => {
  // The key names a value already written to data/ui-state.json on the user's
  // machine; changing it silently resets their preference.
  assert.equal(ANALYTICS_MODE_KEY, "analytics-mode");
});
