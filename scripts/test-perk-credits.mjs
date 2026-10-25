import test from "node:test";
import assert from "node:assert/strict";
import {
  isCreditCandidate, placeCredits, learnKeyword, rankPurchases, pickAutoPair,
  matchesKeyword, appendUnique, parsePerkAnswer, parsePurchasePick, canAutoPair, openPurchases, parseKeywords, parseNotes,
} from "../src/lib/perk-credits.ts";

const key = (p, d) => `${d.getFullYear()}-${d.getMonth() + 1}`;
const askSince = new Date(2026, 6, 18);
const coffee = { id: "coffee", accountId: "a1", amount: 7, period: "MONTHLY", keywords: ["Sample Coffee"] };
let n = 0;
const row = (over) => ({
  id: `t${++n}`, accountId: "a1", date: new Date(2026, 9, 3), amount: -7,
  name: "Sample Coffee", merchantName: null, pfcDetailed: null,
  pending: false, isFee: false, decision: null, benefitId: null, ...over,
});
const run = (perks, rows, since = askSince) => placeCredits(perks, rows, key, since);

test("a keyword match in an open window counts as auto", () => {
  const r = row({});
  const out = run([coffee], [r]);
  assert.deepEqual(out.placed.get(r.id), { benefitId: "coffee", how: "auto", windowKey: "2026-10" });
  assert.deepEqual(out.questions, []);
});

test("a second match in a full window becomes a question", () => {
  const a = row({});
  const b = row({ date: new Date(2026, 9, 9) });
  const out = run([coffee], [a, b]);
  assert.ok(out.placed.has(a.id));
  assert.ok(!out.placed.has(b.id));
  assert.deepEqual(out.questions, [{ transactionId: b.id, suggestedBenefitId: "coffee", windowFull: true }]);
});

test("partial credits add up until the window is full", () => {
  const perk = { id: "dining", accountId: "a1", amount: 50, period: "SEMIANNUAL", keywords: ["Sample Dining"] };
  const a = row({ name: "Sample Dining", amount: -25.99 });
  const b = row({ name: "Sample Dining", amount: -8.69, date: new Date(2026, 9, 4) });
  const out = run([perk], [a, b]);
  assert.equal(out.placed.get(a.id).how, "auto");
  assert.equal(out.placed.get(b.id).how, "auto");
});

test("two perks matching the same keyword ask instead of counting", () => {
  const p1 = { ...coffee, id: "p1", keywords: ["credit"] };
  const p2 = { ...coffee, id: "p2", keywords: ["Sample Credit"] };
  const r = row({ name: "AMEX Sample Credit" });
  const out = run([p1, p2], [r]);
  assert.equal(out.placed.size, 0);
  assert.equal(out.questions.length, 1);
  assert.equal(out.questions[0].suggestedBenefitId, "p1");
});

test("an unmatched row named credit is asked about", () => {
  const r = row({ name: "AMEX Example Credit", amount: -12 });
  const out = run([{ ...coffee, keywords: [] }], [r]);
  assert.deepEqual(out.questions, [{ transactionId: r.id, suggestedBenefitId: null, windowFull: false }]);
});

test("an amount equal to a perk suggests that perk", () => {
  const r = row({ name: "Sample Coffee Shop" });
  const out = run([{ ...coffee, keywords: [] }], [r]);
  assert.deepEqual(out.questions, [{ transactionId: r.id, suggestedBenefitId: "coffee", windowFull: false }]);
});

test("rows older than askSince are never asked about but still count", () => {
  const a = row({ date: new Date(2026, 5, 1) });
  const b = row({ date: new Date(2026, 5, 1), name: "Example Credit", amount: -3 });
  const out = run([coffee], [a, b]);
  assert.equal(out.placed.get(a.id).how, "auto");
  assert.deepEqual(out.questions, []);
});

test("a yes counts even without a keyword and past the cap", () => {
  const a = row({});
  const b = row({ name: "Misc", decision: "YES", benefitId: "coffee", date: new Date(2026, 9, 5) });
  const out = run([coffee], [a, b]);
  assert.equal(out.placed.get(b.id).how, "confirmed");
  const c = row({ date: new Date(2026, 9, 6) });
  assert.equal(run([coffee], [a, b, c]).questions[0].windowFull, true);
});

test("not a perk is never placed or asked", () => {
  const r = row({ decision: "NO", benefitId: null });
  const out = run([coffee], [r]);
  assert.equal(out.placed.size, 0);
  assert.deepEqual(out.questions, []);
});

test("a refused perk is skipped but another may be suggested", () => {
  const dining = { id: "dining", accountId: "a1", amount: 7, period: "MONTHLY", keywords: [] };
  const r = row({ name: "Sample Coffee", decision: "NO", benefitId: "coffee" });
  const out = run([{ ...coffee, keywords: ["Sample"] }, dining], [r]);
  assert.equal(out.placed.size, 0);
  assert.equal(out.questions[0].suggestedBenefitId, "dining");
});

test("rows on another card's account are ignored", () => {
  const r = row({ accountId: "a2" });
  const out = run([coffee], [r]);
  assert.equal(out.placed.size, 0);
  assert.deepEqual(out.questions, []);
});

test("card payments, pending rows and fees are not candidates", () => {
  const base = { amount: -5, pending: false, isFee: false, pfcDetailed: null };
  assert.equal(isCreditCandidate({ ...base, pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }), false);
  assert.equal(isCreditCandidate({ ...base, pfcDetailed: "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT" }), false);
  assert.equal(isCreditCandidate({ ...base, pending: true }), false);
  assert.equal(isCreditCandidate({ ...base, isFee: true }), false);
  assert.equal(isCreditCandidate({ ...base, amount: 5 }), false);
  assert.equal(isCreditCandidate({ ...base, pfcDetailed: "TRANSFER_IN_OTHER_TRANSFER_IN" }), true);
});

test("learnKeyword", () => {
  assert.equal(learnKeyword({ merchantName: "Sample Coffee", name: "x" }), "Sample Coffee");
  assert.equal(learnKeyword({ merchantName: null, name: "AMEX Sample Credit" }), "Sample Credit");
  assert.equal(learnKeyword({ merchantName: null, name: "SAMPLE COFFEE 004512" }), "SAMPLE COFFEE");
});

test("learnKeyword skips generic keywords", () => {
  assert.equal(learnKeyword({ merchantName: null, name: "AMEX CREDIT 123" }), "");
  assert.equal(learnKeyword({ merchantName: null, name: "Statement Credit - Refund" }), "");
  assert.equal(learnKeyword({ merchantName: null, name: "AB 12" }), "");
  assert.equal(learnKeyword({ merchantName: "Amex", name: "x" }), "");
  assert.equal(learnKeyword({ merchantName: null, name: "AMEX Sample Credit" }), "Sample Credit");
  // The route appends with appendUnique, which keeps the list as is for "".
  const list = ["Sample Coffee"];
  assert.equal(appendUnique(list, learnKeyword({ merchantName: null, name: "AMEX CREDIT 123" })), list);
});

test("cent sums at the cap count as full", () => {
  const perk = { id: "dining", accountId: "a1", amount: 30, period: "MONTHLY", keywords: ["Sample Dining"] };
  const mk = (amount, day) => row({ name: "Sample Dining", amount, date: new Date(2026, 9, day) });
  const [a, b, c] = [mk(-10.1, 1), mk(-19.9, 2), mk(-1, 3)];
  const out = run([perk], [a, b, c]);
  assert.ok(out.placed.has(a.id) && out.placed.has(b.id));
  assert.ok(!out.placed.has(c.id));
  assert.deepEqual(out.questions, [{ transactionId: c.id, suggestedBenefitId: "dining", windowFull: true }]);
});

const credit = { date: new Date(2026, 9, 10), amount: -7 };
const daysBack = (n) => new Date(2026, 9, 10 - n);
const buy = (name, amount, back, merchantName = null) =>
  ({ id: `p${++n}`, date: daysBack(back), amount, name, merchantName });
const perk = (over = {}) => ({ keywords: ["Sample Coffee"], pairedMerchants: [], ...over });

test("a single keyword purchase is picked", () => {
  const p = buy("Sample Coffee", 7, 2);
  assert.equal(pickAutoPair(rankPurchases(credit, [p], perk())), p.id);
});

test("two strong matches pick nothing", () => {
  const ranked = rankPurchases(credit, [buy("Sample Coffee", 7, 2), buy("Sample Coffee", 8, 3)], perk());
  assert.equal(pickAutoPair(ranked), null);
});

test("a remembered merchant ranks first", () => {
  const bistro = buy("x", 40, 40, "Sample Bistro");
  const other = buy("Other Place", 40, 1);
  const ranked = rankPurchases(credit, [other, bistro], perk({ keywords: [], pairedMerchants: ["sample bistro"] }));
  assert.equal(ranked[0].id, bistro.id);
  assert.equal(ranked[0].strong, true);
});

test("purchases smaller than the credit or older than 45 days are dropped", () => {
  const ok = buy("A", 7, 45);
  const ranked = rankPurchases(credit, [buy("B", 6.9, 1), buy("C", 7, 46), buy("D", 7, -1), ok], perk());
  assert.deepEqual(ranked.map((r) => r.id), [ok.id]);
});

test("weak matches rank by date and are never auto-picked", () => {
  const near = buy("A", 9, 1);
  const far = buy("B", 9, 5);
  const ranked = rankPurchases(credit, [far, near], perk());
  assert.deepEqual(ranked.map((r) => r.id), [near.id, far.id]);
  assert.equal(pickAutoPair(ranked), null);
});

test("matchesKeyword checks name and merchant, ignoring case and empty keywords", () => {
  assert.equal(matchesKeyword(["sample coffee"], { name: "SAMPLE COFFEE 123", merchantName: null }), true);
  assert.equal(matchesKeyword(["Sample Coffee"], { name: "AMEX CREDIT", merchantName: "Sample Coffee" }), true);
  assert.equal(matchesKeyword(["", "Bistro"], { name: "Sample Coffee", merchantName: null }), false);
});

test("appendUnique trims, skips empties and case-insensitive duplicates", () => {
  assert.deepEqual(appendUnique(["Sample Coffee"], " sample coffee "), ["Sample Coffee"]);
  assert.deepEqual(appendUnique(["Sample Coffee"], "  "), ["Sample Coffee"]);
  assert.deepEqual(appendUnique(["Sample Coffee"], " Sample Bistro "), ["Sample Coffee", "Sample Bistro"]);
});

test("parsePerkAnswer accepts yes, detach and not-a-perk only", () => {
  assert.deepEqual(parsePerkAnswer({ decision: "yes", benefitId: "b1" }), { decision: "YES", benefitId: "b1" });
  assert.deepEqual(parsePerkAnswer({ decision: "no", benefitId: "b1" }), { decision: "NO", benefitId: "b1" });
  assert.deepEqual(parsePerkAnswer({ decision: "no", benefitId: null }), { decision: "NO", benefitId: null });
  for (const bad of [null, "yes", {}, { decision: "yes", benefitId: null }, { decision: "yes" },
    { decision: "no" }, { decision: "maybe", benefitId: "b1" }, { decision: "yes", benefitId: 3 }, { decision: "no", benefitId: "" }])
    assert.equal(parsePerkAnswer(bad), null, JSON.stringify(bad));
});

test("parsePurchasePick: id, explicit null, or malformed", () => {
  assert.equal(parsePurchasePick({ purchaseId: "t9" }), "t9");
  assert.equal(parsePurchasePick({ purchaseId: null }), null);
  for (const bad of [null, {}, { purchaseId: "" }, { purchaseId: 9 }]) assert.equal(parsePurchasePick(bad), undefined);
});

test("canAutoPair skips linked, unpaired and hand-categorized credits", () => {
  const r = { linkedToId: null, noAutoPair: false, userCategorySource: null };
  assert.ok(canAutoPair(r));
  assert.ok(canAutoPair({ ...r, userCategorySource: "RULE" }));
  assert.ok(!canAutoPair({ ...r, userCategorySource: "MANUAL" }));
  assert.ok(!canAutoPair({ ...r, noAutoPair: true }));
  assert.ok(!canAutoPair({ ...r, linkedToId: "p1" }));
});

test("openPurchases drops linked purchases and ones a refund already offsets", () => {
  const ps = [{ id: "p1", linkedToId: null }, { id: "p2", linkedToId: null }, { id: "p3", linkedToId: "x" }];
  assert.deepEqual(openPurchases(ps, new Set(["p2"])).map((p) => p.id), ["p1"]);
});

test("parseKeywords trims, dedupes and refuses bad keywords", () => {
  assert.deepEqual(parseKeywords([" Sample Coffee ", "sample coffee", "Resy"]), ["Sample Coffee", "Resy"]);
  assert.deepEqual(parseKeywords([]), []);
  assert.ok("error" in parseKeywords("Resy"));
  assert.ok("error" in parseKeywords([3]));
  assert.ok("error" in parseKeywords(["  "]));
  assert.ok("error" in parseKeywords(["credit"]));
  assert.ok("error" in parseKeywords(["AMEX Statement Credit 2"]));
  assert.ok("error" in parseKeywords(["x".repeat(61)]));
  assert.ok("error" in parseKeywords(Array.from({ length: 21 }, (_, i) => `Sample Shop ${i}`)));
  assert.equal(parseKeywords(Array.from({ length: 20 }, (_, i) => `Sample Shop ${i}`)).length, 20);
});

test("a credit counts toward its linked purchase's window, not its posting date", () => {
  const aug = row({ date: new Date(2026, 8, 1), spentOn: new Date(2026, 7, 31) });
  const sep = row({ date: new Date(2026, 8, 20) });
  const out = run([coffee], [aug, sep]);
  assert.equal(out.placed.get(aug.id).windowKey, "2026-8");
  assert.equal(out.placed.get(sep.id).windowKey, "2026-9");
  assert.deepEqual(out.questions, []);
});

test("parseNotes trims, clears on empty or null, and rejects non-text or too long", () => {
  assert.equal(parseNotes("  Sample Bistro  "), "Sample Bistro");
  assert.equal(parseNotes("   "), null);
  assert.equal(parseNotes(null), null);
  assert.ok(parseNotes(5).error);
  assert.ok(parseNotes("x".repeat(1001)).error);
});
