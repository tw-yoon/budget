/**
 * Pure matching logic for the auto-categorization rules engine. No DB or React
 * here so it can be unit-tested and shared between the sync service and the API.
 *
 * A rule matches a transaction when its `pattern` matches the chosen `field`
 * (the merchant name, the raw name, or either) under the chosen `matchType`.
 * The first matching enabled rule — ordered by priority then creation — wins,
 * and its `category` is written to the transaction's userCategory.
 */

import { humanizePfc } from "@/lib/format";

// P2P categories a rule can assign. Kept in sync with VENMO_CATEGORIES in
// `@/lib/venmo` but duplicated here so this module stays client-bundleable
// (venmo.ts pulls in node:fs for CSV parsing and can't ship to the browser).
const P2P_CATEGORIES = [
  "Dining",
  "Groceries",
  "Travel",
  "Entertainment",
  "Housing",
  "Shopping",
  "Reimbursement",
  "Transfer",
  "Other",
];

export const RULE_FIELDS = ["MERCHANT", "NAME", "EITHER"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_MATCH_TYPES = [
  "CONTAINS",
  "EQUALS",
  "STARTS_WITH",
  "REGEX",
] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export const FIELD_LABELS: Record<RuleField, string> = {
  MERCHANT: "Merchant",
  NAME: "Description",
  EITHER: "Merchant or description",
};

export const MATCH_TYPE_LABELS: Record<RuleMatchType, string> = {
  CONTAINS: "contains",
  EQUALS: "equals",
  STARTS_WITH: "starts with",
  REGEX: "matches regex",
};

// PFC primaries the bank-side data uses, humanized, unioned with the P2P
// categories — the set a rule can assign. Deduped, alphabetical, with the
// exclusion sentinel "Transfer" kept available.
const PFC_PRIMARIES = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "RENT_AND_UTILITIES",
  "TRANSPORTATION",
  "TRAVEL",
];

export const RULE_CATEGORIES: string[] = Array.from(
  new Set([...P2P_CATEGORIES, ...PFC_PRIMARIES.map(humanizePfc)])
).sort((a, b) => a.localeCompare(b));

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
  for (const rule of rules) {
    if (ruleMatches(rule, tx)) return rule.category;
  }
  return null;
}
