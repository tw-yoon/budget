/**
 * Computes benefit progress for the user's cards.
 *
 * Progress source per benefit:
 *   - "manual": user logged a usage amount (usedManual) — takes priority
 *   - "auto":   an active flat-value perk, or the card is linked to an account
 *               AND the benefit has categories/keywords; progress = the perk's
 *               full value, or matched activity in the period window
 *   - "none":   nothing to track against (no manual value, no link/category)
 */

import { prisma } from "@/lib/prisma";
import { humanizePfc } from "@/lib/format";
import { REWARD_CATEGORY_LABELS, effectiveRate, formatRate } from "@/lib/rewards";
import { rewardCategoryFor } from "@/lib/reward-categories";
import type {
  BenefitDTO,
  EarningsDTO,
  RewardRateDTO,
  UserCardDTO,
} from "@/types";

// Display order for a card's earning rates: bonus categories first, base last.
const RATE_ORDER = [
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
];

export function periodWindow(
  period: string,
  now: Date = new Date()
): { start: Date; end: Date; label: string; key: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "MONTHLY":
      return {
        start: new Date(y, m, 1),
        end: new Date(y, m + 1, 1),
        label: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
        key: `${y}-${String(m + 1).padStart(2, "0")}`,
      };
    case "QUARTERLY": {
      const q = Math.floor(m / 3);
      return {
        start: new Date(y, q * 3, 1),
        end: new Date(y, q * 3 + 3, 1),
        label: `Q${q + 1} ${y}`,
        key: `${y}-Q${q + 1}`,
      };
    }
    case "SEMIANNUAL": {
      const h = m < 6 ? 0 : 6;
      return {
        start: new Date(y, h, 1),
        end: new Date(y, h + 6, 1),
        label: h === 0 ? `H1 ${y}` : `H2 ${y}`,
        key: `${y}-H${h === 0 ? 1 : 2}`,
      };
    }
    case "ANNUAL":
    default:
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: `${y}`, key: `${y}` };
  }
}

// Every period window in a benefit year — drives the yearly credit view (12
// cells for MONTHLY, 4 for QUARTERLY, 2 for SEMIANNUAL, 1 for ANNUAL). `short`
// is a compact cell label; `label` is the full tooltip text.
//
// `startMonth` (1-12, the month the card was opened) shifts only the MONTHLY
// strip, so its twelve cells run from the month you got the card rather than
// from January — the months before it are ones you didn't hold the card. A
// monthly credit resets on the calendar month regardless, so this changes which
// twelve windows are shown, never when one resets. Quarterly and semiannual
// stay pinned to the calendar: issuers define those windows explicitly (Amex's
// Resy credit is "January through June and July through December"), so shifting
// them would show windows that don't exist.
export function periodsInYear(
  period: string,
  year: number,
  startMonth?: number | null
): { start: Date; end: Date; label: string; short: string; key: string }[] {
  const monthName = (y: number, m: number, fmt: "long" | "short") =>
    new Date(y, m, 1).toLocaleString("en-US", { month: fmt });

  switch (period) {
    case "MONTHLY": {
      const offset = startMonth && startMonth >= 1 && startMonth <= 12 ? startMonth - 1 : 0;
      return Array.from({ length: 12 }, (_, i) => {
        const m = offset + i;
        // Date normalizes month >= 12 into the next year, so a shifted strip
        // rolls into the following year on its own.
        const start = new Date(year, m, 1);
        const wy = start.getFullYear();
        const wm = start.getMonth();
        return {
          start,
          end: new Date(year, m + 1, 1),
          label: `${monthName(wy, wm, "long")} ${wy}`,
          short: monthName(wy, wm, "short"),
          key: `${wy}-${String(wm + 1).padStart(2, "0")}`,
        };
      });
    }
    case "QUARTERLY":
      return Array.from({ length: 4 }, (_, q) => ({
        start: new Date(year, q * 3, 1),
        end: new Date(year, q * 3 + 3, 1),
        label: `Q${q + 1} ${year}`,
        short: `Q${q + 1}`,
        key: `${year}-Q${q + 1}`,
      }));
    case "SEMIANNUAL":
      return [
        { start: new Date(year, 0, 1), end: new Date(year, 6, 1), label: `H1 ${year}`, short: "H1", key: `${year}-H1` },
        { start: new Date(year, 6, 1), end: new Date(year, 12, 1), label: `H2 ${year}`, short: "H2", key: `${year}-H2` },
      ];
    case "ANNUAL":
    default:
      return [
        { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1), label: `${year}`, short: `${year}`, key: `${year}` },
      ];
  }
}

function parseCategories(raw: string): string[] {
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

// JSON map of periodKey -> manual override amount.
function parseOverrides(raw: string): Record<string, number> {
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(p)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

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
function computeEarnings(
  card: { rewardRates: SimpleRateWithUnit[]; pointValueCents: number; id: string },
  others: { name: string | null; issuer: string; rewardRates: SimpleRateWithUnit[]; pointValueCents: number }[],
  txns: { amount: number; date: Date; pfcPrimary: string; pfcDetailed: string | null; userCategory: string | null }[],
  start: Date,
  end: Date
): EarningsDTO {
  const spend = new Map<string, number>();
  for (const t of txns) {
    if (t.amount <= 0 || t.date < start || t.date >= end) continue;
    const c = rewardCategoryFor(t);
    spend.set(c, (spend.get(c) ?? 0) + t.amount);
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
        spend: round(amount),
        rate: formatRate(rate.multiplier, rate.unit),
        isBonus: rate.isBonus,
        earned: round(earned),
        value: round(value),
        vsBest: round(value - altValue),
        bestAlternative: altLabel || null,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  // Incremental is computed per category and summed, not from these totals —
  // the best alternative can differ category by category.
  const incrementalValue = round(byCategory.reduce((sum, c) => sum + c.vsBest, 0));

  return {
    unit,
    pointValueCents: card.pointValueCents,
    totalSpend: round(totalSpend),
    totalEarned: round(totalUnits),
    totalValue: round(totalValue),
    incrementalValue,
    byCategory,
  };
}

export async function getUserCardsWithProgress(
  now: Date = new Date()
): Promise<UserCardDTO[]> {
  const cards = await prisma.userCard.findMany({
    include: {
      benefits: { orderBy: { createdAt: "asc" } },
      rewardRates: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const linkedIds = [
    ...new Set(cards.map((c) => c.accountId).filter((x): x is string => !!x)),
  ];

  const accounts = linkedIds.length
    ? await prisma.account.findMany({
        where: { id: { in: linkedIds } },
        select: { id: true, name: true },
      })
    : [];
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  // Pull this year's transactions for all linked accounts in one query, then
  // slice per benefit window in memory. Both outflows (category-spending mode)
  // and inflows (statement-credit reimbursements, matched by name) are needed.
  const txByAccount = new Map<
    string,
    {
      amount: number;
      date: Date;
      pfcPrimary: string;
      pfcDetailed: string | null;
      userCategory: string | null;
      name: string;
      merchantName: string | null;
    }[]
  >();
  if (linkedIds.length) {
    // Back to the start of last year: a monthly strip shifted to a card's
    // membership month can begin as early as December of the previous year.
    const yearStart = new Date(now.getFullYear() - 1, 0, 1);
    const txs = await prisma.transaction.findMany({
      where: {
        accountId: { in: linkedIds },
        isTransfer: false,
        isFee: false,
        pending: false,
        date: { gte: yearStart },
      },
      select: {
        accountId: true,
        amount: true,
        date: true,
        pfcPrimary: true,
        pfcDetailed: true,
        userCategory: true,
        name: true,
        merchantName: true,
      },
    });
    for (const t of txs) {
      const arr = txByAccount.get(t.accountId) ?? [];
      arr.push({
        amount: t.amount,
        date: t.date,
        pfcPrimary: t.pfcPrimary,
        pfcDetailed: t.pfcDetailed,
        userCategory: t.userCategory,
        name: t.name,
        merchantName: t.merchantName,
      });
      txByAccount.set(t.accountId, arr);
    }
  }

  return cards.map((card) => {
    const txns = card.accountId ? txByAccount.get(card.accountId) ?? [] : [];

    const benefits: BenefitDTO[] = card.benefits.map((b) => {
      const cats = parseCategories(b.matchCategories);
      const keywords = parseCategories(b.matchText).map((k) => k.toLowerCase());

      // A perk carries its value on its own — no linked account needed — so it
      // takes precedence over transaction matching.
      const autoMode: BenefitDTO["autoMode"] = b.perkActiveFrom
        ? "perk"
        : card.accountId && keywords.length > 0
          ? "credits"
          : card.accountId && cats.length > 0
            ? "spending"
            : null;

      // Auto-computed usage in an arbitrary window, per the benefit's mode.
      // Credits reimbursements post as inflows (amount < 0) matched by name;
      // spending matches positive transactions by category; a perk is flat.
      const autoUsed = (s: Date, e: Date): number => {
        const inWin = (t: { date: Date }) => t.date >= s && t.date < e;
        // An active perk delivers its full value in every window that was still
        // open when it was switched on. Windows that closed earlier stay at $0.
        if (autoMode === "perk") {
          return b.perkActiveFrom && e > b.perkActiveFrom ? b.amount : 0;
        }
        if (autoMode === "credits") {
          return txns
            .filter(
              (t) =>
                t.amount < 0 &&
                inWin(t) &&
                keywords.some(
                  (k) =>
                    t.name.toLowerCase().includes(k) ||
                    (t.merchantName?.toLowerCase().includes(k) ?? false)
                )
            )
            .reduce((sum, t) => sum - t.amount, 0);
        }
        if (autoMode === "spending") {
          return txns
            .filter((t) => t.amount > 0 && inWin(t) && cats.includes(t.pfcPrimary))
            .reduce((sum, t) => sum + t.amount, 0);
        }
        return 0;
      };

      // Per-window manual overrides (keyed by period). The legacy single
      // `usedManual` still applies to the current window when no keyed override
      // exists, so older data keeps working.
      const overrides = parseOverrides(b.manualOverrides);
      const cur = periodWindow(b.period, now);
      const overrideFor = (key: string, isCurrent: boolean): number | null => {
        if (key in overrides) return overrides[key];
        if (isCurrent && b.usedManual != null) return b.usedManual;
        return null;
      };

      const curOverride = overrideFor(cur.key, true);
      const used = curOverride != null ? curOverride : autoUsed(cur.start, cur.end);
      const source: BenefitDTO["source"] =
        curOverride != null ? "manual" : autoMode ? "auto" : "none";
      const label = cur.label;

      // Yearly view: one cell per period window, each independently overridable.
      // Monthly strips run from the card's membership month; everything else
      // stays on the calendar. When that month is still ahead of us this year,
      // the current benefit year started in the previous one.
      const startMonth = b.period === "MONTHLY" ? card.membershipStartMonth : null;
      const offset = startMonth && startMonth >= 1 && startMonth <= 12 ? startMonth - 1 : 0;
      const year = now.getMonth() < offset ? now.getFullYear() - 1 : now.getFullYear();
      const yearBreakdown = periodsInYear(b.period, year, startMonth).map((w) => {
        const isCurrent = now >= w.start && now < w.end;
        const ov = overrideFor(w.key, isCurrent);
        const u = ov != null ? ov : autoUsed(w.start, w.end);
        return {
          label: w.label,
          short: w.short,
          key: w.key,
          used: round(u),
          target: b.amount,
          captured: b.amount > 0 && u >= b.amount,
          manual: ov != null,
          future: w.start > now,
        };
      });

      const ytdCaptured = round(
        yearBreakdown
          .filter((w) => !w.future)
          .reduce((s, w) => s + Math.min(w.used, b.amount), 0)
      );
      const yearTarget = round(b.amount * yearBreakdown.length);

      return {
        id: b.id,
        name: b.name,
        notes: b.notes,
        amount: b.amount,
        period: b.period,
        matchCategories: cats,
        categoryLabels: cats.map(humanizePfc),
        matchText: parseCategories(b.matchText),
        perkActiveFrom: b.perkActiveFrom ? b.perkActiveFrom.toISOString() : null,
        used: round(used),
        cappedUsed: round(Math.min(used, b.amount)),
        pct: b.amount > 0 ? Math.min(1, used / b.amount) : 0,
        periodLabel: label,
        source,
        autoMode,
        yearBreakdown,
        ytdCaptured,
        yearTarget,
      };
    });

    const rewardRates: RewardRateDTO[] = card.rewardRates
      .map((r) => ({
        id: r.id,
        category: r.category,
        categoryLabel: REWARD_CATEGORY_LABELS[r.category] ?? r.category,
        multiplier: r.multiplier,
        unit: r.unit,
        display: formatRate(r.multiplier, r.unit),
        notes: r.notes,
      }))
      .sort(
        (a, b) => RATE_ORDER.indexOf(a.category) - RATE_ORDER.indexOf(b.category)
      );

    // Earnings run over the same benefit year the monthly strips use, so they
    // line up with the annual fee that paid for them rather than with Jan 1.
    const cardOffset =
      card.membershipStartMonth && card.membershipStartMonth >= 1 && card.membershipStartMonth <= 12
        ? card.membershipStartMonth - 1
        : 0;
    const earnYear = now.getMonth() < cardOffset ? now.getFullYear() - 1 : now.getFullYear();
    const earnStart = new Date(earnYear, cardOffset, 1);
    const earnEnd = new Date(earnYear, cardOffset + 12, 1);

    const earnings = card.accountId
      ? computeEarnings(
          card,
          cards.filter((o) => o.id !== card.id),
          txns,
          earnStart,
          earnEnd
        )
      : null;

    const creditsYtd = round(benefits.reduce((s, b) => s + b.ytdCaptured, 0));
    const creditsAnnualMax = round(benefits.reduce((s, b) => s + b.yearTarget, 0));

    return {
      id: card.id,
      issuer: card.issuer,
      name: card.name,
      last4: card.last4,
      membershipStartYear: card.membershipStartYear,
      membershipStartMonth: card.membershipStartMonth,
      annualFee: card.annualFee,
      pointValueCents: card.pointValueCents,
      linked: !!card.accountId,
      linkedAccountName: card.accountId
        ? accountName.get(card.accountId) ?? null
        : null,
      benefits,
      benefitCount: benefits.length,
      benefitsUsedCount: benefits.filter((b) => b.pct >= 1).length,
      creditsYtd,
      creditsAnnualMax,
      rewardRates,
      earnings,
      earningsPeriodLabel: `${earnStart.toLocaleString("en-US", { month: "short", year: "numeric" })} – ${new Date(
        earnEnd.getFullYear(),
        earnEnd.getMonth() - 1,
        1
      ).toLocaleString("en-US", { month: "short", year: "numeric" })}`,
    };
  });
}
