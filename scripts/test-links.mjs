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

const purchase = { id: "p1", amount: 84.2, linkedToId: null, isFee: false, pending: false, poolsOthers: false };
const refund = { id: "r1", amount: -30, linkedToId: null, isFee: false, pending: false, poolsOthers: false };

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
  assert.match(
    validateLink(refund, { id: "r2", amount: -5, linkedToId: null, isFee: false, pending: false, poolsOthers: false }),
    /money out/
  );
});

test("chains are refused", () => {
  assert.match(
    validateLink(refund, { id: "p2", amount: 10, linkedToId: "p9", isFee: false, pending: false, poolsOthers: false }),
    /itself linked/
  );
});

test("a deposit that pools other payments cannot be linked as a refund", () => {
  assert.match(
    validateLink({ ...refund, poolsOthers: true }, purchase),
    /pools other payments/
  );
});

test("a fee on the refund side cannot be linked", () => {
  assert.match(validateLink({ ...refund, isFee: true }, purchase), /Fees cannot be linked/);
});

test("a fee on the target side cannot be linked", () => {
  assert.match(validateLink(refund, { ...purchase, isFee: true }), /Fees cannot be linked/);
});

test("a pending refund cannot be linked", () => {
  assert.match(validateLink({ ...refund, pending: true }, purchase), /Pending transactions/);
});

test("a pending target cannot be linked", () => {
  assert.match(validateLink(refund, { ...purchase, pending: true }), /Pending transactions/);
});

function purchase2() {
  return { id: "p2", amount: 12, linkedToId: null, isFee: false, pending: false, poolsOthers: false };
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

import { scoreCandidate, rankCandidates } from "../src/lib/links.ts";

const base = {
  date: new Date("2026-09-10"),
  amount: -30,
  name: "Amazon refund",
  merchantName: "Amazon",
  counterparty: null,
};

const cand = (over) => ({
  id: "c",
  label: 1,
  date: new Date("2026-09-01"),
  name: "Amazon Marketplace",
  merchantName: "Amazon",
  counterparty: null,
  amount: 84.2,
  ...over,
});

test("a purchase after the refund is not a candidate", () => {
  assert.ok(scoreCandidate(base, cand({ date: new Date("2026-09-20") })) < 0);
});

test("a purchase beyond the 90 day window is not a candidate", () => {
  assert.ok(scoreCandidate(base, cand({ date: new Date("2026-01-01") })) < 0);
});

test("a same-merchant purchase outranks a stranger on the same day", () => {
  const same = scoreCandidate(base, cand({}));
  const other = scoreCandidate(base, cand({ merchantName: "Shell", name: "Shell Oil" }));
  assert.ok(same > other);
});

test("a purchase that covers the refund outranks one that cannot", () => {
  const covers = scoreCandidate(base, cand({ amount: 84.2 }));
  const tooSmall = scoreCandidate(base, cand({ amount: 4 }));
  assert.ok(covers > tooSmall);
});

test("a recent purchase outranks an older identical one", () => {
  const recent = scoreCandidate(base, cand({ date: new Date("2026-09-08") }));
  const older = scoreCandidate(base, cand({ date: new Date("2026-07-08") }));
  assert.ok(recent > older);
});

test("ranking drops non-candidates and caps the list", () => {
  const rows = [
    cand({ id: "future", date: new Date("2026-09-20") }),
    cand({ id: "a" }),
    cand({ id: "b", merchantName: "Shell", name: "Shell Oil" }),
  ];
  const out = rankCandidates(base, rows, 2);
  assert.equal(out.length, 2);
  assert.ok(!out.some((r) => r.id === "future"));
  assert.equal(out[0].id, "a");
});

import { netAmount } from "../src/lib/links.ts";

test("a purchase with no refunds nets to itself", () => {
  assert.equal(netAmount(84.2, []), 84.2);
});

test("refunds reduce a purchase's net cost", () => {
  assert.equal(netAmount(84.2, [{ amount: -30 }, { amount: -4.2 }]), 50);
});

test("over-refunding is allowed and goes negative", () => {
  assert.equal(netAmount(10, [{ amount: -15 }]), -5);
});
