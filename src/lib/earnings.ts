/**
 * Reward earnings for one card over a window of its transactions, in the
 * card's own unit and in dollars, plus what it returned beyond the best
 * alternative card on the same spend. Kept apart from benefits.service so the
 * arithmetic can be tested without a database.
 */

import { REWARD_CATEGORY_LABELS, betterOfBonus, effectiveRate, formatRate } from "@/lib/rewards";
import { rewardCategoryFor } from "@/lib/reward-categories";
import {
  bonusFor,
  bonusMatches,
  quarterKey,
  quarterLabel,
  type RotatingBonusInput,
} from "@/lib/rotating";
import { roundToCents, sliceTransaction } from "@/lib/splits";
import type { EarningsCategoryDTO, EarningsDTO } from "@/types";

/**
 * Cash value of a card's earnings on one dollar of spend in a category.
 *
 * Cards don't share a unit — points ("X") and cashback ("PERCENT") can't be
 * compared directly — so both are converted to dollars. Points use the card's
 * own `pointValueCents`, since a Membership Rewards point and an Ultimate
 * Rewards point aren't worth the same, and neither is worth a fixed amount.
 */
function dollarsPerDollar(
  rates: SimpleRateWithUnit[],
  category: string,
  pointValueCents: number
): number {
  const { multiplier, unit } = effectiveRate(rates, category);
  return unit === "PERCENT" ? multiplier / 100 : (multiplier * pointValueCents) / 100;
}

type SimpleRateWithUnit = { category: string; multiplier: number; unit: string };

/**
 * What a card earned on its own spending, and how much of that it earned *over*
 * the best alternative you hold.
 *
 * Gross earnings overstate what a card is worth: you'd have put that spending
 * on some card regardless. The number that answers "is this card carrying its
 * fee?" is the incremental one — what this card returned beyond what your
 * next-best card would have returned on the very same transactions.
 */
export function computeEarnings(
  card: { rewardRates: SimpleRateWithUnit[]; pointValueCents: number; id: string },
  others: { name: string | null; issuer: string; rewardRates: SimpleRateWithUnit[]; pointValueCents: number }[],
  txns: {
    amount: number;
    date: Date;
    pfcPrimary: string;
    pfcDetailed: string | null;
    userCategory: string | null;
    name: string;
    merchantName: string | null;
    splits: { amount: number; userCategory: string }[];
  }[],
  start: Date,
  end: Date,
  bonuses: RotatingBonusInput[] = []
): EarningsDTO {
  const spend = new Map<string, number>();
  // One bucket per quarter's bonus. Earned and the alternatives' values add up
  // slice by slice, since each slice keeps its own category's rates.
  const bonusBuckets = new Map<
    string,
    { bonus: RotatingBonusInput; spend: number; earned: number; value: number; alt: number[] }
  >();
  // Process by date so the cap is used up in the order the purchases happened.
  const sorted = [...txns].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const t of sorted) {
    if (t.amount <= 0 || t.date < start || t.date >= end) continue;
    const bonus = bonusFor(bonuses, t.date);
    // A split transaction earns per part: a grocery carve-out at a big-box
    // store earns the grocery rate, and the rest earns the row's own rate.
    // rewardCategoryFor needs nothing but a category and the two Plaid
    // fallbacks, which is exactly what a slice plus its row supplies.
    for (const slice of sliceTransaction(
      { amount: t.amount, effectiveCategory: t.userCategory ?? "" },
      t.splits
    )) {
      const c = rewardCategoryFor({
        // An empty effectiveCategory means the row had no override, so the
        // remainder must fall through to Plaid exactly as the row did.
        userCategory: slice.userCategory || null,
        pfcPrimary: t.pfcPrimary,
        pfcDetailed: t.pfcDetailed,
      });
      let normalAmount = slice.amount;
      // Checked once per slice, so a purchase matching both a category and a
      // merchant earns the bonus once.
      // A slice whose normal rate beats the bonus skips the bucket, and the cap.
      // betterOfBonus returns the very same object when the normal rate wins.
      const normalRate = effectiveRate(card.rewardRates, c);
      const bonusRate = bonus ? betterOfBonus(normalRate, bonus, card.pointValueCents) : normalRate;
      if (bonus && bonusRate !== normalRate && bonusMatches(bonus, c, t.name, t.merchantName)) {
        const key = quarterKey(bonus.year, bonus.quarter);
        const bucket = bonusBuckets.get(key) ?? {
          bonus,
          spend: 0,
          earned: 0,
          value: 0,
          alt: others.map(() => 0),
        };
        bonusBuckets.set(key, bucket);
        const amount =
          bonus.cap === null ? slice.amount : Math.min(slice.amount, Math.max(0, bonus.cap - bucket.spend));
        if (amount > 0) {
          const rate = bonusRate;
          const earned = rate.multiplier * (rate.unit === "PERCENT" ? amount / 100 : amount);
          bucket.spend += amount;
          bucket.earned += earned;
          bucket.value += rate.unit === "PERCENT" ? earned : (earned * card.pointValueCents) / 100;
          others.forEach((o, i) => {
            bucket.alt[i] += dollarsPerDollar(o.rewardRates, c, o.pointValueCents) * amount;
          });
          normalAmount -= amount;
        }
      }
      // Past the cap (or no bonus), the slice earns its own category's rate.
      if (normalAmount > 0) spend.set(c, (spend.get(c) ?? 0) + normalAmount);
    }
  }

  const unit = card.rewardRates.find((r) => r.category === "OTHER")?.unit ?? "X";
  let totalSpend = 0;
  let totalUnits = 0; // points, or cashback dollars — whatever the card pays in
  let totalValue = 0; // the above, in dollars

  const byCategory: EarningsCategoryDTO[] = [...spend.entries()]
    .map(([category, amount]) => {
      const rate = effectiveRate(card.rewardRates, category);
      const earned = rate.multiplier * (rate.unit === "PERCENT" ? amount / 100 : amount);
      // Cashback is already dollars; points convert at the card's own rate.
      const value =
        rate.unit === "PERCENT" ? earned : (earned * card.pointValueCents) / 100;

      // The best any other card would have done on this same spend.
      let altValue = 0;
      let altLabel = "";
      for (const o of others) {
        const v = dollarsPerDollar(o.rewardRates, category, o.pointValueCents) * amount;
        if (v > altValue) {
          altValue = v;
          altLabel = o.name ?? o.issuer;
        }
      }

      totalSpend += amount;
      totalUnits += earned;
      totalValue += value;

      return {
        key: category,
        category,
        categoryLabel: REWARD_CATEGORY_LABELS[category] ?? category,
        spend: roundToCents(amount),
        rate: formatRate(rate.multiplier, rate.unit),
        isBonus: rate.isBonus,
        earned: roundToCents(earned),
        value: roundToCents(value),
        vsBest: roundToCents(value - altValue),
        bestAlternative: altLabel || null,
      };
    });

  for (const [key, b] of bonusBuckets) {
    if (b.spend === 0) continue;
    // The best alternative is the one card that would have done best across
    // the bucket's slices, each at that card's rate for the slice's category.
    let altValue = 0;
    let altLabel = "";
    others.forEach((o, i) => {
      if (b.alt[i] > altValue) {
        altValue = b.alt[i];
        altLabel = o.name ?? o.issuer;
      }
    });
    totalSpend += b.spend;
    totalUnits += b.earned;
    totalValue += b.value;
    byCategory.push({
      key: `ROTATING-${key}`,
      category: "ROTATING",
      categoryLabel: `${quarterLabel(b.bonus.year, b.bonus.quarter)} bonus`,
      spend: roundToCents(b.spend),
      rate: formatRate(b.bonus.multiplier, b.bonus.unit),
      isBonus: true,
      earned: roundToCents(b.earned),
      value: roundToCents(b.value),
      vsBest: roundToCents(b.value - altValue),
      bestAlternative: altLabel || null,
    });
  }
  byCategory.sort((a, b) => b.spend - a.spend);

  // Incremental is computed per category and summed, not from these totals —
  // the best alternative can differ category by category.
  const incrementalValue = roundToCents(byCategory.reduce((sum, c) => sum + c.vsBest, 0));

  return {
    unit,
    pointValueCents: card.pointValueCents,
    totalSpend: roundToCents(totalSpend),
    totalEarned: roundToCents(totalUnits),
    totalValue: roundToCents(totalValue),
    incrementalValue,
    byCategory,
  };
}
