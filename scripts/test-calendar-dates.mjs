// Bank dates are bare calendar days stored as UTC midnight. West of UTC they
// must still read as that day, not the evening before.
process.env.TZ = "America/Los_Angeles";

import test from "node:test";
import assert from "node:assert/strict";
import { calendarDay, formatDate } from "../src/lib/format.ts";
import { aggregate, buildCashflow } from "../src/lib/analytics.ts";

const tx = (iso, amount) => ({
  amount, date: new Date(iso), category: "Dining", subcategory: null,
  merchant: "Sample Mart", isOffset: false,
});

test("a bank date reads as its own calendar day", () => {
  assert.deepEqual(calendarDay(new Date("2026-10-01T00:00:00.000Z")), { y: 2026, m: 10, day: 1 });
  assert.equal(formatDate("2026-10-01T00:00:00.000Z"), "Oct 1, 2026");
});

test("a real instant keeps the local day", () => {
  // 03:00 UTC on Oct 1 is the evening of Sep 30 in California.
  assert.deepEqual(calendarDay(new Date("2026-10-01T03:00:00.000Z")), { y: 2026, m: 9, day: 30 });
  assert.equal(formatDate("2026-10-01T03:00:00.000Z"), "Sep 30, 2026");
});

test("spend on the 1st counts in its own month, even as the window's first month", () => {
  const now = new Date(2026, 10, 15); // Nov 15, local
  const r = aggregate([tx("2026-10-01T00:00:00.000Z", 40), tx("2026-11-01T00:00:00.000Z", 10)], 2, now);
  assert.deepEqual(r.byMonth.map((b) => [b.month, b.spent]), [["2026-10", 40], ["2026-11", 10]]);
  assert.equal(r.summary.totalSpent, 50);
});

test("cash flow buckets the 1st into its own month", () => {
  const now = new Date(2026, 10, 15);
  const months = buildCashflow([tx("2026-11-01T00:00:00.000Z", 25)], 2, now);
  assert.deepEqual(months.map((m) => m.spend.length), [0, 1]);
});

test("localDay puts a bank date at local midnight of the same day", async () => {
  const { localDay } = await import("../src/lib/format.ts");
  const d = localDay(new Date("2026-10-01T00:00:00.000Z"));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 1, 0]);
  const instant = new Date("2026-10-01T03:00:00.000Z");
  assert.equal(localDay(instant), instant);
});
