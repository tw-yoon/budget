/**
 * Pure matching logic for the auto-categorization rules engine. No DB or React
 * here so it can be unit-tested and shared between the sync service and the API.
 *
 * A rule matches a transaction when its `pattern` matches the chosen `field`
 * (the merchant name, the raw name, or either) under the chosen `matchType`.
 * The first matching enabled rule — ordered by priority then creation — wins,
 * and its `category` is written to the transaction's userCategory.
 */

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

// The PFC primaries the bank-side data uses.
export const PFC_PRIMARIES = [
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

// The matcher lives in an import-free module so node:test can load it.
export {
  ruleMatches,
  firstMatch,
  firstMatchingRule,
  ruleOutcomes,
  isHandSet,
  type RuleMatcher,
  type RuleTarget,
  type RuleRow,
  type RuleOutcome,
} from "@/lib/rule-match";
