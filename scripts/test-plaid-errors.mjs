import test from "node:test";
import assert from "node:assert/strict";
import { describePlaidError, summarizeFailures } from "../src/lib/plaid-errors.ts";

test("a login-required item names the bank and says what to do", () => {
  const s = describePlaidError("ITEM_LOGIN_REQUIRED", "Marcus by Goldman Sachs");
  assert.match(s, /Marcus by Goldman Sachs/);
  assert.match(s, /sign in again/);
  assert.match(s, /Settings → Connections/);
});

test("the raw code is kept so it stays searchable", () => {
  const s = describePlaidError("ITEM_LOGIN_REQUIRED", "Marcus by Goldman Sachs");
  assert.match(s, /\(ITEM_LOGIN_REQUIRED\)/);
});

test("a bank outage reads as temporary, not as something to fix", () => {
  const s = describePlaidError("INSTITUTION_DOWN", "Chase");
  assert.match(s, /Chase/);
  assert.doesNotMatch(s, /sign in|reconnect/i);
});

test("an unmapped code still names the bank rather than standing alone", () => {
  const s = describePlaidError("SOME_NEW_CODE", "Discover");
  assert.match(s, /Discover/);
  assert.match(s, /\(SOME_NEW_CODE\)/);
});

test("a missing code does not render undefined", () => {
  const s = describePlaidError(null, "Discover");
  assert.match(s, /Discover/);
  assert.doesNotMatch(s, /undefined|null/);
});

test("one failure reads as a sentence, with no count prefix", () => {
  const s = summarizeFailures([
    { institution: "Marcus by Goldman Sachs", error: "ITEM_LOGIN_REQUIRED" },
  ]);
  assert.match(s, /^Marcus by Goldman Sachs/);
  assert.doesNotMatch(s, /item\(s\)|^1 /);
});

test("several failures are counted and separated", () => {
  const s = summarizeFailures([
    { institution: "Marcus by Goldman Sachs", error: "ITEM_LOGIN_REQUIRED" },
    { institution: "Chase", error: "INSTITUTION_DOWN" },
  ]);
  assert.match(s, /^2 banks failed:/);
  assert.match(s, /Marcus by Goldman Sachs/);
  assert.match(s, /Chase/);
  assert.match(s, /;/);
});
