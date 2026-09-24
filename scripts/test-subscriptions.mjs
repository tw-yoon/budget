import test from "node:test";
import assert from "node:assert/strict";
import {
  CADENCES,
  CADENCE_LABELS,
  estimateNext,
  mapFrequency,
  monthlyCost,
} from "../src/lib/subscriptions.ts";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("every cadence normalizes to a monthly cost", () => {
  close(monthlyCost(12, "WEEKLY"), 52);
  close(monthlyCost(12, "BIWEEKLY"), 26);
  close(monthlyCost(12, "SEMI_MONTHLY"), 24);
  close(monthlyCost(12, "MONTHLY"), 12);
  close(monthlyCost(12, "QUARTERLY"), 4);
  close(monthlyCost(12, "YEARLY"), 1);
});

test("a year of any cadence costs the same as twelve monthly costs", () => {
  const perYear = { WEEKLY: 52, BIWEEKLY: 26, SEMI_MONTHLY: 24, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 };
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

test("twice a month is its own cadence, not every two weeks", () => {
  // 24 charges a year against 26 — folding one into the other reads ~8% high.
  assert.equal(mapFrequency("SEMI_MONTHLY"), "SEMI_MONTHLY");
  assert.equal(CADENCE_LABELS.SEMI_MONTHLY, "Twice a month");
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

// ── the next charge ──────────────────────────────────────────────────────

// Local date, since estimateNext steps in local time from noon UTC.
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("the next charge is one cadence after the last", () => {
  const next = (c) => ymd(estimateNext("2026-01-31", c));
  assert.equal(next("WEEKLY"), "2026-02-07");
  assert.equal(next("BIWEEKLY"), "2026-02-14");
  assert.equal(next("SEMI_MONTHLY"), "2026-02-15");
  assert.equal(next("MONTHLY"), "2026-03-03"); // Feb 31 rolls over
  assert.equal(next("QUARTERLY"), "2026-05-01"); // Apr 31 rolls over
  assert.equal(next("YEARLY"), "2027-01-31");
});

test("twice a month lands about half a month later", () => {
  // Charges on the 15th and at month end, stepping from either one.
  assert.equal(ymd(estimateNext("2026-04-15", "SEMI_MONTHLY")), "2026-04-30");
  assert.equal(ymd(estimateNext("2026-04-30", "SEMI_MONTHLY")), "2026-05-15");
});

test("an unknown cadence steps a month", () => {
  assert.equal(ymd(estimateNext("2026-01-15", "FORTNIGHTLY")), "2026-02-15");
});

test("no usable last date means no estimate", () => {
  assert.equal(estimateNext(null, "MONTHLY"), null);
  assert.equal(estimateNext(undefined, "MONTHLY"), null);
  assert.equal(estimateNext("not a date", "MONTHLY"), null);
});
