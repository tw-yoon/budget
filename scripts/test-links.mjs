import test from "node:test";
import assert from "node:assert/strict";
import { nextLabelFrom } from "../src/lib/labels.ts";

test("first label is 1 when no transaction is labelled yet", () => {
  assert.equal(nextLabelFrom(null), 1);
});

test("next label follows the current maximum", () => {
  assert.equal(nextLabelFrom(412), 413);
});

import { validateLink } from "../src/lib/links.ts";

const purchase = { id: "p1", amount: 84.2, linkedToId: null };
const refund = { id: "r1", amount: -30, linkedToId: null };

test("a refund may link to a purchase", () => {
  assert.equal(validateLink(refund, purchase), null);
});

test("a transaction may not link to itself", () => {
  assert.match(validateLink(refund, refund), /itself/);
});

test("a purchase may not be linked to a purchase", () => {
  assert.match(validateLink(purchase, purchase2()), /money-in/);
});

test("a refund may not link to another refund", () => {
  assert.match(validateLink(refund, { id: "r2", amount: -5, linkedToId: null }), /money out/);
});

test("chains are refused", () => {
  assert.match(
    validateLink(refund, { id: "p2", amount: 10, linkedToId: "p9" }),
    /itself linked/
  );
});

function purchase2() {
  return { id: "p2", amount: 12, linkedToId: null };
}

import { resolveLinkedCategory } from "../src/lib/links.ts";

test("an unlinked, uncategorized inflow is plain income", () => {
  const r = resolveLinkedCategory({ amount: -30, userCategory: null, linkedToCategory: null });
  assert.equal(r.raw, null);
  assert.equal(r.isOffset, false);
});

test("a categorized inflow offsets its own category", () => {
  const r = resolveLinkedCategory({ amount: -30, userCategory: "Dining", linkedToCategory: null });
  assert.equal(r.raw, "Dining");
  assert.equal(r.isOffset, true);
});

test("a linked inflow inherits its purchase's category, subcategory and all", () => {
  const r = resolveLinkedCategory({
    amount: -30,
    userCategory: null,
    linkedToCategory: "Shopping > Electronics",
  });
  assert.equal(r.raw, "Shopping > Electronics");
  assert.equal(r.isOffset, true);
});

test("a row's own category wins over the link", () => {
  const r = resolveLinkedCategory({
    amount: -30,
    userCategory: "Dining",
    linkedToCategory: "Shopping",
  });
  assert.equal(r.raw, "Dining");
});

test("an outflow is never an offset, however it is categorized", () => {
  const r = resolveLinkedCategory({ amount: 84.2, userCategory: "Shopping", linkedToCategory: null });
  assert.equal(r.isOffset, false);
});
