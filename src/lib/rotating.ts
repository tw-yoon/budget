/**
 * Rotating quarterly bonus rates (e.g. 5% on gas this quarter, up to $1,500).
 * Pure helpers shared by earnings and Best Card; quarters are calendar
 * quarters in local time.
 */

import { REWARD_CATEGORY_LABELS } from "@/lib/rewards";

export interface RotatingBonusInput {
  year: number;
  quarter: number;
  multiplier: number;
  unit: string;
  categories: string[];
  merchants: string[];
  /** Merchants the issuer excludes ("excluding Walmart"); beat any match. */
  excludeMerchants: string[];
  cap: number | null;
  activated: boolean;
}

export function quarterOf(d: Date): { year: number; quarter: number } {
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
}

export function quarterKey(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

export function quarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

export interface PlaidCategory {
  pfcPrimary: string;
  pfcDetailed: string | null;
}

// Bonus categories rotating cards use that aren't reward categories, matched
// on Plaid's personal-finance categories.
export const BONUS_EXTRA_CATEGORIES: {
  key: string;
  label: string;
  matches: (p: PlaidCategory) => boolean;
}[] = [
  {
    key: "UTILITIES",
    label: "Utilities",
    matches: (p) =>
      !!p.pfcDetailed?.startsWith("RENT_AND_UTILITIES_") && p.pfcDetailed !== "RENT_AND_UTILITIES_RENT",
  },
  {
    key: "HOME_IMPROVEMENT",
    label: "Home Improvement",
    matches: (p) => p.pfcPrimary === "HOME_IMPROVEMENT" || !!p.pfcDetailed?.startsWith("HOME_IMPROVEMENT_"),
  },
  { key: "SUPERSTORES", label: "Superstores", matches: (p) => p.pfcDetailed === "GENERAL_MERCHANDISE_SUPERSTORES" },
  {
    key: "ONLINE_MARKETPLACES",
    label: "Online Marketplaces",
    matches: (p) => p.pfcDetailed === "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
  },
  { key: "FITNESS", label: "Fitness Clubs", matches: (p) => p.pfcDetailed === "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS" },
  { key: "HOTELS", label: "Hotels", matches: (p) => p.pfcDetailed === "TRAVEL_LODGING" },
  { key: "MOVIES", label: "Movies & Streaming TV", matches: (p) => p.pfcDetailed === "ENTERTAINMENT_TV_AND_MOVIES" },
];

export function bonusCategoryLabel(key: string): string {
  return REWARD_CATEGORY_LABELS[key] ?? BONUS_EXTRA_CATEGORIES.find((e) => e.key === key)?.label ?? key;
}

// A purchase earns the bonus when its reward category is one of the bonus's
// categories, its Plaid codes match one of the bonus's extra categories, or
// its name or merchant name contains one of the merchants, unless the name or
// merchant name contains an excluded merchant. `plaid` is null when the user
// overrode the category: then only the reward category counts, as in earnings.
export function bonusMatches(
  b: RotatingBonusInput,
  rewardCategory: string,
  name: string,
  merchantName: string | null,
  plaid: PlaidCategory | null = null
): boolean {
  const hay = [name, merchantName ?? ""].map((s) => s.toLowerCase());
  const named = (list: string[]) =>
    list.some((m) => {
      const needle = m.trim().toLowerCase();
      return needle !== "" && hay.some((h) => h.includes(needle));
    });
  if (named(b.excludeMerchants)) return false;
  const extra = (e: (typeof BONUS_EXTRA_CATEGORIES)[number]) =>
    plaid !== null && b.categories.includes(e.key) && e.matches(plaid);
  return b.categories.includes(rewardCategory) || BONUS_EXTRA_CATEGORIES.some(extra) || named(b.merchants);
}

// The bonus for a purchase date's quarter. Activation doesn't gate the math:
// it only keeps the "Set Up" prompt showing.
export function bonusFor(bonuses: RotatingBonusInput[], d: Date): RotatingBonusInput | null {
  const { year, quarter } = quarterOf(d);
  return bonuses.find((b) => b.year === year && b.quarter === quarter) ?? null;
}
