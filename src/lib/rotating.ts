/**
 * Rotating quarterly bonus rates (e.g. 5% on gas this quarter, up to $1,500).
 * Pure helpers shared by earnings and Best Card; quarters are calendar
 * quarters in local time.
 */

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

// A purchase earns the bonus when its reward category is one of the bonus's
// categories, or its name or merchant name contains one of the merchants,
// unless the name or merchant name contains an excluded merchant.
export function bonusMatches(
  b: RotatingBonusInput,
  rewardCategory: string,
  name: string,
  merchantName: string | null
): boolean {
  const hay = [name, merchantName ?? ""].map((s) => s.toLowerCase());
  const named = (list: string[]) =>
    list.some((m) => {
      const needle = m.trim().toLowerCase();
      return needle !== "" && hay.some((h) => h.includes(needle));
    });
  if (named(b.excludeMerchants)) return false;
  return b.categories.includes(rewardCategory) || named(b.merchants);
}

// The bonus for a purchase date's quarter. Activation doesn't gate the math:
// it only keeps the "Set Up" prompt showing.
export function bonusFor(bonuses: RotatingBonusInput[], d: Date): RotatingBonusInput | null {
  const { year, quarter } = quarterOf(d);
  return bonuses.find((b) => b.year === year && b.quarter === quarter) ?? null;
}
