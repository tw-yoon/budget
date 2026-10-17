import type { RotatingBonusInput } from "@/lib/rotating";

export const REWARD_CATEGORIES = [
  "DINING",
  "GROCERIES",
  "TRAVEL",
  "GAS",
  "TRANSIT",
  "ENTERTAINMENT",
  "ONLINE_SHOPPING",
  "DRUGSTORES",
  "ROTATING",
  "OTHER",
] as const;
export type RewardCategory = (typeof REWARD_CATEGORIES)[number];

export const REWARD_CATEGORY_LABELS: Record<string, string> = {
  DINING: "Dining",
  GROCERIES: "Groceries",
  TRAVEL: "Travel",
  GAS: "Gas",
  TRANSIT: "Transit",
  ENTERTAINMENT: "Streaming",
  ONLINE_SHOPPING: "Online Shopping",
  DRUGSTORES: "Drugstores",
  ROTATING: "Rotating (quarterly)",
  OTHER: "Everything else",
};

// Categories shown in the "best card by category" recommender (OTHER is the base).
export const BONUS_CATEGORIES = REWARD_CATEGORIES.filter((c) => c !== "OTHER");

export const REWARD_UNITS = ["X", "PERCENT"] as const;

export function formatRate(multiplier: number, unit: string): string {
  return unit === "PERCENT" ? `${multiplier}%` : `${multiplier}x`;
}

export interface SimpleRate {
  category: string;
  multiplier: number;
  unit: string;
}

// The rate a card earns for a category: its specific bonus, else its base
// ("OTHER") rate, else a 1x default.
export function effectiveRate(
  rates: SimpleRate[],
  category: string
): { multiplier: number; unit: string; isBonus: boolean } {
  const exact = rates.find((r) => r.category === category);
  if (exact) return { multiplier: exact.multiplier, unit: exact.unit, isBonus: true };
  const base = rates.find((r) => r.category === "OTHER");
  if (base) return { multiplier: base.multiplier, unit: base.unit, isBonus: false };
  return { multiplier: 1, unit: "X", isBonus: false };
}

type Rate = { multiplier: number; unit: string; isBonus: boolean };

// Dollars earned per dollar of spend; points at `pointValueCents` each.
function dollarsPer(multiplier: number, unit: string, pointValueCents: number): number {
  return unit === "PERCENT" ? multiplier / 100 : (multiplier * pointValueCents) / 100;
}

// The better of a normal rate and a rotating bonus, by dollar value. A bonus
// replaces the normal rate rather than adding to it, so a lower bonus never
// lowers earnings.
export function betterOfBonus(
  normal: Rate,
  bonus: { multiplier: number; unit: string },
  pointValueCents = 1
): Rate {
  return dollarsPer(bonus.multiplier, bonus.unit, pointValueCents) >
    dollarsPer(normal.multiplier, normal.unit, pointValueCents)
    ? { multiplier: bonus.multiplier, unit: bonus.unit, isBonus: true }
    : normal;
}

// effectiveRate, raised to the quarter's bonus when the bonus covers the
// category. Only categories count here: merchants need a purchase to match.
export function effectiveRateWithBonus(
  rates: SimpleRate[],
  category: string,
  bonus: RotatingBonusInput | null,
  pointValueCents = 1
): Rate {
  const normal = effectiveRate(rates, category);
  return bonus?.categories.includes(category)
    ? betterOfBonus(normal, bonus, pointValueCents)
    : normal;
}
