/**
 * Rule matching, and what a rule has done to the rows it matches.
 *
 * Deliberately free of imports so `node:test` can load it directly under
 * Node's native type stripping. `@/lib/rules` re-exports all of it.
 */

/** The fields of a rule needed to evaluate a match. */
export interface RuleMatcher {
  field: string;
  matchType: string;
  pattern: string;
}

/** The transaction fields a rule matches against. */
export interface RuleTarget {
  name: string;
  merchantName: string | null;
}

/** Build the haystack string(s) a rule inspects for a given field. */
function haystacks(field: string, tx: RuleTarget): string[] {
  switch (field) {
    case "MERCHANT":
      return [tx.merchantName ?? ""];
    case "NAME":
      return [tx.name];
    case "EITHER":
    default:
      return [tx.merchantName ?? "", tx.name];
  }
}

/**
 * Does `rule` match `tx`? Text matching is case-insensitive. An invalid regex
 * never matches (rather than throwing) so one bad rule can't break a sync.
 */
export function ruleMatches(rule: RuleMatcher, tx: RuleTarget): boolean {
  const pattern = rule.pattern.trim();
  if (!pattern) return false;

  const fields = haystacks(rule.field, tx);

  if (rule.matchType === "REGEX") {
    let re: RegExp;
    try {
      re = new RegExp(pattern, "i");
    } catch {
      return false;
    }
    return fields.some((f) => re.test(f));
  }

  const needle = pattern.toLowerCase();
  return fields.some((f) => {
    const hay = f.toLowerCase();
    switch (rule.matchType) {
      case "EQUALS":
        return hay === needle;
      case "STARTS_WITH":
        return hay.startsWith(needle);
      case "CONTAINS":
      default:
        return hay.includes(needle);
    }
  });
}

/**
 * Return the category assigned by the first matching rule, or null if none
 * match. `rules` must already be ordered (priority asc, then createdAt asc) and
 * filtered to enabled rules by the caller.
 */
export function firstMatch(
  rules: (RuleMatcher & { category: string })[],
  tx: RuleTarget
): string | null {
  return firstMatchingRule(rules, tx)?.category ?? null;
}

/** The first of `rules` (already in evaluation order) that matches `tx`. */
export function firstMatchingRule<R extends RuleMatcher>(rules: R[], tx: RuleTarget): R | null {
  for (const rule of rules) {
    if (ruleMatches(rule, tx)) return rule;
  }
  return null;
}

/** A transaction as the rules engine sees it, with who set its category. */
export interface RuleRow extends RuleTarget {
  userCategory: string | null;
  // null = uncategorized, "RULE" = a rule set it; anything else (MANUAL,
  // VENMO) was set by hand, and rules leave it alone.
  userCategorySource: string | null;
}

/** Was this category set by hand (MANUAL, VENMO), so rules keep off it? */
export function isHandSet(source: string | null): boolean {
  return source !== null && source !== "RULE";
}

/** Where the rows a rule is the first match for stand. */
export interface RuleOutcome {
  applied: number; // already carry this rule's category
  pending: number; // Apply now would (re)set them
  handSet: number; // set by hand — kept unless the rule is told to take over
}

/**
 * Per rule id, how its matches stand. Each row counts toward the first rule
 * that matches it only, since that is the one the engine would use. `rules`
 * must be the enabled rules in evaluation order.
 */
export function ruleOutcomes(
  rules: (RuleMatcher & { id: string; category: string })[],
  rows: RuleRow[]
): Map<string, RuleOutcome> {
  const out = new Map<string, RuleOutcome>(
    rules.map((r) => [r.id, { applied: 0, pending: 0, handSet: 0 }])
  );
  for (const row of rows) {
    const rule = firstMatchingRule(rules, row);
    if (!rule) continue;
    const o = out.get(rule.id)!;
    if (isHandSet(row.userCategorySource)) o.handSet++;
    else if (row.userCategorySource === "RULE" && row.userCategory === rule.category) {
      o.applied++;
    } else o.pending++;
  }
  return out;
}
