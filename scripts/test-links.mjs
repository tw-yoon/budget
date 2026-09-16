import test from "node:test";
import assert from "node:assert/strict";
import { nextLabelFrom } from "../src/lib/labels.ts";

test("first label is 1 when no transaction is labelled yet", () => {
  assert.equal(nextLabelFrom(null), 1);
});

test("next label follows the current maximum", () => {
  assert.equal(nextLabelFrom(412), 413);
});
