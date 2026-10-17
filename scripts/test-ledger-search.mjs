process.env.TZ = "America/Los_Angeles";

import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDateRange, ledgerSearchWhere } from "../src/lib/ledger-search.ts";

const now = new Date(2026, 9, 16); // Oct 16, 2026 local

test("amounts: whole dollars span the dollar, cents are exact", () => {
  assert.deepEqual(parseAmount("12"), { lo: 12, hi: 13 });
  const c = parseAmount("$1,234.56");
  assert.ok(c.lo < 1234.56 && 1234.56 < c.hi && c.hi < 1234.57);
  const d = parseAmount("12.3");
  assert.ok(d.lo < 12.3 && 12.39 < d.hi && d.hi < 12.4);
  assert.equal(parseAmount("starbucks"), null);
  assert.equal(parseAmount("1.234"), null);
});

test("dates in the usual spellings", () => {
  assert.deepEqual(parseDateRange("2026-10-05", now), [2026, 9, 5, "day"]);
  assert.deepEqual(parseDateRange("10/5", now), [2026, 9, 5, "day"]);
  assert.deepEqual(parseDateRange("10/5/25", now), [2025, 9, 5, "day"]);
  assert.deepEqual(parseDateRange("Oct 5, 2026", now), [2026, 9, 5, "day"]);
  assert.deepEqual(parseDateRange("october", now), [2026, 9, 1, "month"]);
  assert.deepEqual(parseDateRange("sept", now), [2026, 8, 1, "month"]);
  assert.deepEqual(parseDateRange("2025", now), [2025, 0, 1, "year"]);
  // No year and still ahead this year: last year's.
  assert.deepEqual(parseDateRange("dec 3", now), [2025, 11, 3, "day"]);
  assert.equal(parseDateRange("mart", now), null);
  assert.equal(parseDateRange("13/1", now), null);
});

test("the filter covers text, both signs of an amount, the label and the day", () => {
  const or = ledgerSearchWhere("12", now).OR;
  assert.ok(or.some((c) => c.personalNote));
  assert.ok(or.some((c) => c.amount?.gte === 12));
  assert.ok(or.some((c) => c.amount?.lte === -12));
  assert.ok(or.some((c) => c.label === 12));
  const day = ledgerSearchWhere("2026-10-01", now).OR.filter((c) => c.date);
  assert.deepEqual(day[0].date, {
    gte: new Date("2026-10-01T00:00:00.000Z"),
    lt: new Date("2026-10-02T00:00:00.000Z"),
  });
  assert.equal(ledgerSearchWhere("coffee", now).OR.length, 7);
});
