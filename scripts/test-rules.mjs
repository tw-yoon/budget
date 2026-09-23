import test from "node:test";
import assert from "node:assert/strict";
import { ruleOutcomes, firstMatchingRule } from "../src/lib/rule-match.ts";

const rule = (id, pattern, category, extra = {}) => ({
  id,
  field: "EITHER",
  matchType: "CONTAINS",
  pattern,
  category,
  ...extra,
});
const row = (name, userCategory = null, userCategorySource = null, merchantName = null) => ({
  name,
  merchantName,
  userCategory,
  userCategorySource,
});

test("a row the rule already set counts as applied", () => {
  const out = ruleOutcomes(
    [rule("r1", "Tesla", "Transportation")],
    [row("TESLA, INC.", "Transportation", "RULE")]
  );
  assert.deepEqual(out.get("r1"), { applied: 1, pending: 0, handSet: 0 });
});

test("an uncategorized match is pending until Apply now", () => {
  const out = ruleOutcomes([rule("r1", "Tesla", "Transportation")], [row("TESLA, INC.")]);
  assert.deepEqual(out.get("r1"), { applied: 0, pending: 1, handSet: 0 });
});

test("a rule-set row carrying a different category is pending", () => {
  // e.g. the rule's category was edited since it last ran
  const out = ruleOutcomes(
    [rule("r1", "Tesla", "Transportation > Tesla")],
    [row("TESLA, INC.", "Transportation", "RULE")]
  );
  assert.deepEqual(out.get("r1"), { applied: 0, pending: 1, handSet: 0 });
});

test("hand-set and Venmo-set matches count as set by hand", () => {
  const out = ruleOutcomes(
    [rule("r1", "Tesla", "Transportation")],
    [
      row("TESLA, INC.", "Transportation > Taxis and Ride Shares", "MANUAL"),
      row("Tesla via Venmo", "Other", "VENMO"),
    ]
  );
  assert.deepEqual(out.get("r1"), { applied: 0, pending: 0, handSet: 2 });
});

test("a row counts only toward the first rule that matches it", () => {
  const out = ruleOutcomes(
    [rule("r1", "Tesla", "Transportation"), rule("r2", "TESLA, INC", "Shopping")],
    [row("TESLA, INC.")]
  );
  assert.deepEqual(out.get("r1"), { applied: 0, pending: 1, handSet: 0 });
  assert.deepEqual(out.get("r2"), { applied: 0, pending: 0, handSet: 0 });
});

test("every rule gets an entry, even with no matches", () => {
  const out = ruleOutcomes([rule("r1", "Zipcar", "Transportation")], [row("Tesla")]);
  assert.deepEqual(out.get("r1"), { applied: 0, pending: 0, handSet: 0 });
});

test("firstMatchingRule returns the winning rule itself", () => {
  const rules = [rule("r1", "Zip", "A"), rule("r2", "Zipcar", "B")];
  assert.equal(firstMatchingRule(rules, row("Zipcar"))?.id, "r1");
  assert.equal(firstMatchingRule(rules, row("Lyft")), null);
});
