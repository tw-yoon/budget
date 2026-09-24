/**
 * Reward earnings for one card over a window of its transactions, in the
 * card's own unit and in dollars, plus what it returned beyond the best
 * alternative card on the same spend. Kept apart from benefits.service so the
 * arithmetic can be tested without a database.
 */

import { REWARD_CATEGORY_LABELS, effectiveRate, formatRate } from "@/lib/rewards";
import { rewardCategoryFor } from "@/lib/reward-categories";
import { roundToCents, sliceTransaction } from "@/lib/splits";
import type { EarningsDTO } from "@/types";

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
    splits: { amount: number; userCategory: string }[];
  }[],
  start: Date,
  end: Date
): EarningsDTO {
  const spend = new Map<string, number>();
  for (const t of txns) {
    if (t.amount <= 0 || t.date < start || t.date >= end) continue;
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
      spend.set(c, (spend.get(c) ?? 0) + slice.amount);
    }
  }

  const unit = card.rewardRates.find((r) => r.category === "OTHER")?.unit ?? "X";
  let totalSpend = 0;
  let totalUnits = 0; // points, or cashback dollars — whatever the card pays in
  let totalValue = 0; // the above, in dollars

  const byCategory = [...spend.entries()]
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
    })
    .sort((a, b) => b.spend - a.spend);

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
