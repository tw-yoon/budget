import test from "node:test";
import assert from "node:assert/strict";
import {
  remainderOf,
  sliceForAnalytics,
  sliceTransaction,
  validateNewSplit,
} from "../src/lib/splits.ts";

const target = { amount: 100, pending: false };
const row = { amount: 100, effectiveCategory: "General Merchandise" };
const part = (amount, userCategory, id = "p1") => ({ id, amount, userCategory });

test("an unsplit row is one slice under its own category", () => {
  assert.deepEqual(sliceTransaction(row, []), [
    { amount: 100, userCategory: "General Merchandise", isRemainder: true },
  ]);
});

test("a carve-out leaves the rest under the row's category", () => {
  assert.deepEqual(sliceTransaction(row, [part(30, "Food")]), [
    { amount: 30, userCategory: "Food", isRemainder: false },
    { amount: 70, userCategory: "General Merchandise", isRemainder: true },
  ]);
});

test("carve-outs accumulate and the remainder shrinks", () => {
  const parts = [part(30, "Food", "a"), part(25, "Home Improvement", "b")];
  assert.deepEqual(sliceTransaction(row, parts), [
    { amount: 30, userCategory: "Food", isRemainder: false },
    { amount: 25, userCategory: "Home Improvement", isRemainder: false },
    { amount: 45, userCategory: "General Merchandise", isRemainder: true },
  ]);
});

test("an exhausted remainder is omitted rather than shown as zero", () => {
  const slices = sliceTransaction(row, [part(100, "Food")]);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].isRemainder, false);
});

test("float drift never leaves a phantom remainder", () => {
  // 0.1 + 0.2 === 0.30000000000000004 in binary floating point.
  const cents = { amount: 0.3, effectiveCategory: "General Merchandise" };
  const parts = [part(0.1, "Food", "a"), part(0.2, "Food", "b")];
  assert.equal(sliceTransaction(cents, parts).length, 2);
});

test("a subcategorized part keeps its full category", () => {
  const slices = sliceTransaction(row, [part(30, "Food > Groceries")]);
  assert.equal(slices[0].userCategory, "Food > Groceries");
});

test("the remainder absorbs an amount revision", () => {
  const posted = { amount: 103.47, effectiveCategory: "General Merchandise" };
  const slices = sliceTransaction(posted, [part(30, "Food")]);
  assert.equal(slices[0].amount, 30);
  assert.equal(slices[1].amount, 73.47);
});

test("a revision below the carve-outs gives a negative remainder", () => {
  const shrunk = { amount: 20, effectiveCategory: "General Merchandise" };
  const slices = sliceTransaction(shrunk, [part(30, "Food")]);
  assert.equal(slices[1].amount, -10);
  assert.equal(slices[1].isRemainder, true);
});

test("slices always sum back to the transaction", () => {
  const parts = [part(30, "Food", "a"), part(25, "Travel", "b")];
  const total = sliceTransaction(row, parts).reduce((s, x) => s + x.amount, 0);
  assert.equal(Math.round(total * 100) / 100, row.amount);
});

test("slices still sum back when a sub-cent input is rounded to cents first", () => {
  // Regression test: the POST route used to store `Number(body.amount)`
  // unrounded, so a sub-cent value like 30.005 (from a client sending a plain
  // number, not a form-validated one) landed in the database as-is and broke
  // this same invariant by half a cent. The route now rounds with
  // `Math.round(amount * 100) / 100` before writing — mirrored here so the
  // invariant is pinned against that exact kind of input, not just clean ones.
  const rawAmount = 30.005;
  const rounded = Math.round(rawAmount * 100) / 100;
  const parts = [part(rounded, "Food", "a")];
  const total = sliceTransaction(row, parts).reduce((s, x) => s + x.amount, 0);
  assert.equal(Math.round(total * 100) / 100, row.amount);
});

// sliceForAnalytics — the per-row logic analytics uses, extracted here so a
// regression like the one below is caught by node:test rather than by a
// human eyeballing a dashboard number.

test("an ordinary income row stays income, not an offset", () => {
  // Regression test: a reviewer's first proposed fix for the income-
  // fabrication bug was `isOffset: isOffset || slice.amount < 0`. An unsplit
  // income row's sole slice is its whole (negative) amount, so that line
  // would have flipped isOffset to true here and wiped the row out of
  // totalIncome. This must stay false.
  const income = { amount: -500, effectiveCategory: "Paychecks", isOffset: false };
  assert.deepEqual(sliceForAnalytics(income, []), [
    { amount: -500, userCategory: "Paychecks", isOffset: false, countsAsTransaction: true },
  ]);
});

test("a reimbursement stays an offset", () => {
  const reimbursement = { amount: -20, effectiveCategory: "Food and Drink", isOffset: true };
  assert.deepEqual(sliceForAnalytics(reimbursement, []), [
    { amount: -20, userCategory: "Food and Drink", isOffset: true, countsAsTransaction: true },
  ]);
});

test("an over-allocated row's negative remainder nets as an offset", () => {
  const shrunk = { amount: 100, effectiveCategory: "General Merchandise", isOffset: false };
  assert.deepEqual(sliceForAnalytics(shrunk, [part(150, "Food")]), [
    { amount: 150, userCategory: "Food", isOffset: false, countsAsTransaction: true },
    { amount: -50, userCategory: "General Merchandise", isOffset: true, countsAsTransaction: false },
  ]);
});

test("carve-out slices on a normal split stay non-offset", () => {
  const normal = { amount: 100, effectiveCategory: "General Merchandise", isOffset: false };
  assert.deepEqual(sliceForAnalytics(normal, [part(30, "Food")]), [
    { amount: 30, userCategory: "Food", isOffset: false, countsAsTransaction: true },
    { amount: 70, userCategory: "General Merchandise", isOffset: false, countsAsTransaction: false },
  ]);
});

test("a slice tagged Transfer is filtered out entirely", () => {
  const normal = { amount: 100, effectiveCategory: "General Merchandise", isOffset: false };
  const parts = [part(30, "Transfer", "a"), part(20, "Transfer > Venmo", "b")];
  assert.deepEqual(sliceForAnalytics(normal, parts), [
    { amount: 50, userCategory: "General Merchandise", isOffset: false, countsAsTransaction: true },
  ]);
});

test("a row whose first carve-out is Transfer still gets counted via the next slice", () => {
  const normal = { amount: 100, effectiveCategory: "General Merchandise", isOffset: false };
  const parts = [part(30, "Transfer", "a"), part(20, "Food", "b")];
  assert.deepEqual(sliceForAnalytics(normal, parts), [
    { amount: 20, userCategory: "Food", isOffset: false, countsAsTransaction: true },
    { amount: 50, userCategory: "General Merchandise", isOffset: false, countsAsTransaction: false },
  ]);
});

test("a row whose every slice is Transfer-tagged yields nothing", () => {
  const normal = { amount: 30, effectiveCategory: "General Merchandise", isOffset: false };
  assert.deepEqual(sliceForAnalytics(normal, [part(30, "Transfer > Venmo")]), []);
});

test("an unsplit row yields exactly one slice, counted", () => {
  const normal = { amount: 100, effectiveCategory: "General Merchandise", isOffset: false };
  assert.deepEqual(sliceForAnalytics(normal, []), [
    { amount: 100, userCategory: "General Merchandise", isOffset: false, countsAsTransaction: true },
  ]);
});

test("remainderOf reports what is left", () => {
  assert.equal(remainderOf(100, [{ amount: 30 }]), 70);
  assert.equal(remainderOf(100, []), 100);
  assert.equal(remainderOf(100, [{ amount: 30 }, { amount: 80 }]), -10);
});

test("a valid carve-out is accepted", () => {
  assert.equal(validateNewSplit(target, [], { amount: 30, userCategory: "Food" }), null);
  assert.equal(
    validateNewSplit(target, [{ amount: 30 }], { amount: 70, userCategory: "Food" }),
    null
  );
});

test("money-in rows cannot be split", () => {
  const refund = { amount: -50, pending: false };
  assert.match(
    validateNewSplit(refund, [], { amount: 10, userCategory: "Food" }),
    /money out/
  );
});

test("pending rows cannot be split", () => {
  const pending = { amount: 100, pending: true };
  assert.match(
    validateNewSplit(pending, [], { amount: 10, userCategory: "Food" }),
    /Pending/
  );
});

test("a non-positive or unusable amount is refused", () => {
  for (const amount of [0, -5, Number.NaN]) {
    assert.match(
      validateNewSplit(target, [], { amount, userCategory: "Food" }),
      /greater than zero/
    );
  }
});

test("a blank category is refused", () => {
  assert.match(validateNewSplit(target, [], { amount: 30, userCategory: "  " }), /category/);
});

test("over-allocation is refused", () => {
  assert.match(
    validateNewSplit(target, [{ amount: 80 }], { amount: 30, userCategory: "Food" }),
    /left to split/
  );
});

test("a carve-out for exactly the remaining amount is allowed", () => {
  assert.equal(
    validateNewSplit(target, [{ amount: 70 }], { amount: 30, userCategory: "Food" }),
    null
  );
});
