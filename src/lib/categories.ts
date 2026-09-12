// Lightweight subcategory convention: a userCategory string may be
// "Parent > Sub" (e.g. "Entertainment > Movies"). Analytics roll up to the
// parent; the sub is display/detail only. No separator = plain category.
export const SUB_SEPARATOR = " > ";

/** Split a stored userCategory into its parent and optional subcategory. */
export function splitCategory(cat: string): { parent: string; sub: string | null } {
  const idx = cat.indexOf(SUB_SEPARATOR);
  if (idx === -1) return { parent: cat, sub: null };
  return {
    parent: cat.slice(0, idx).trim(),
    sub: cat.slice(idx + SUB_SEPARATOR.length).trim() || null,
  };
}

/** The parent (roll-up) category of a possibly-subcategorized value. */
export function parentCategory(cat: string): string {
  return splitCategory(cat).parent;
}

/** Build a stored userCategory from a parent and optional subcategory. */
export function joinCategory(parent: string, sub?: string | null): string {
  const s = sub?.trim();
  return s ? `${parent}${SUB_SEPARATOR}${s}` : parent;
}

// Issuers the user can pick from.
export const ISSUERS = ["AMEX", "CHASE", "DISCOVER"] as const;
export type Issuer = (typeof ISSUERS)[number];

export const ISSUER_LABELS: Record<string, string> = {
  AMEX: "Amex",
  CHASE: "Chase",
  DISCOVER: "Discover",
};

export const BENEFIT_PERIODS = [
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
] as const;
export type BenefitPeriod = (typeof BENEFIT_PERIODS)[number];

export const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMIANNUAL: "Semi-annual",
  ANNUAL: "Annual",
};

// PFC primaries a benefit can be auto-tracked against (from synced spending).
export const TRACKABLE_CATEGORIES = [
  "FOOD_AND_DRINK",
  "TRAVEL",
  "TRANSPORTATION",
  "ENTERTAINMENT",
  "GENERAL_MERCHANDISE",
  "PERSONAL_CARE",
  "RENT_AND_UTILITIES",
  "GENERAL_SERVICES",
  "MEDICAL",
  "HOME_IMPROVEMENT",
] as const;

// Full month names, indexed 0-11. Used wherever a membership start month is
// picked (card header, add-card form).
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
