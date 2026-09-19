import test from "node:test";
import assert from "node:assert/strict";
import {
  remainderOf,
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
