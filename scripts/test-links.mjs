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
