import test from "node:test";
import assert from "node:assert/strict";
import { CADENCES, CADENCE_LABELS, mapFrequency, monthlyCost } from "../src/lib/subscriptions.ts";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("every cadence normalizes to a monthly cost", () => {
  close(monthlyCost(12, "WEEKLY"), 52);
  close(monthlyCost(12, "BIWEEKLY"), 26);
  close(monthlyCost(12, "MONTHLY"), 12);
  close(monthlyCost(12, "QUARTERLY"), 4);
  close(monthlyCost(12, "YEARLY"), 1);
});

test("a year of any cadence costs the same as twelve monthly costs", () => {
  const perYear = { WEEKLY: 52, BIWEEKLY: 26, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 };
  for (const c of CADENCES) close(monthlyCost(10, c) * 12, 10 * perYear[c]);
});

test("an unknown cadence is treated as monthly", () => {
  assert.equal(monthlyCost(15, "FORTNIGHTLY"), 15);
});

test("every cadence has a label", () => {
  for (const c of CADENCES) assert.ok(CADENCE_LABELS[c], c);
});

test("Plaid's frequencies map onto cadences", () => {
  assert.equal(mapFrequency("WEEKLY"), "WEEKLY");
  assert.equal(mapFrequency("BIWEEKLY"), "BIWEEKLY");
  assert.equal(mapFrequency("MONTHLY"), "MONTHLY");
  assert.equal(mapFrequency("ANNUALLY"), "YEARLY");
});

test("semi-monthly is approximated as biweekly", () => {
  // 26 charges a year instead of 24, so the monthly cost reads ~8% high.
  assert.equal(mapFrequency("SEMI_MONTHLY"), "BIWEEKLY");
});

test("a missing or unknown frequency is assumed monthly", () => {
  assert.equal(mapFrequency(null), "MONTHLY");
  assert.equal(mapFrequency(undefined), "MONTHLY");
  assert.equal(mapFrequency("UNKNOWN"), "MONTHLY");
});

test("every mapped frequency is a known cadence", () => {
  for (const f of ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY", "ANNUALLY", "UNKNOWN", null]) {
    assert.ok(CADENCES.includes(mapFrequency(f)), String(f));
  }
});
