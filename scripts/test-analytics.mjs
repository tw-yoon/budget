import test from "node:test";
import assert from "node:assert/strict";
import { buildCashflow } from "../src/lib/analytics.ts";

const now = new Date(2026, 9, 15);
const tx = (amount, subcategory, isOffset = false) => ({
  amount, date: new Date(2026, 9, 5), category: "General Merchandise", subcategory,
  merchant: "Sample Mart", isOffset, countsAsTransaction: true,
});

test("a refund with no sub can't leave the subs bigger than their category", () => {
  const [m] = buildCashflow([tx(300, "Electronics"), tx(100, "Clothing"), tx(-200, null, true)], 1, now);
  const [gm] = m.spend;
  assert.equal(gm.amount, 200);
  assert.deepEqual(gm.subs, [{ name: "Electronics", amount: 150 }, { name: "Clothing", amount: 50 }]);
});

test("subs that fit are left alone", () => {
  const [m] = buildCashflow([tx(300, "Electronics"), tx(100, null), tx(-50, "Electronics", true)], 1, now);
  assert.deepEqual(m.spend[0].subs, [{ name: "Electronics", amount: 250 }]);
});
