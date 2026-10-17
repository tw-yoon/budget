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

import { queryStart } from "@/lib/analytics";
import { prisma } from "@/lib/prisma";
import { humanizePfc, localDay } from "@/lib/format";
import { REWARD_CATEGORY_LABELS, formatRate } from "@/lib/rewards";
import { computeEarnings } from "@/lib/earnings";
import { quarterKey, quarterLabel, quarterOf, type RotatingBonusInput } from "@/lib/rotating";
import { loadPerkPlacement } from "@/services/perk-credits.service";
import type {
  BenefitDTO,
  PerkCreditDTO,
  PerkQuestionDTO,
  RewardRateDTO,
  RotatingBonusDTO,
  UserCardDTO,
  UserCardsResponse,
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

export function parseCategories(raw: string): string[] {
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

// Local calendar day as YYYY-MM-DD (dates here are localDay-normalised).
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function getUserCardsWithProgress(
  now: Date = new Date()
): Promise<UserCardsResponse> {
  const [cards, { placement, rows }] = await Promise.all([
    prisma.userCard.findMany({
      include: {
        benefits: { orderBy: { createdAt: "asc" } },
        rewardRates: true,
        rotatingBonuses: { orderBy: [{ year: "desc" }, { quarter: "desc" }] },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPerkPlacement(now),
  ]);

  // Placed credits per perk and window key, with the purchase each one offsets.
  const purchaseIds = [...placement.placed.keys()]
    .map((id) => rows.get(id)?.linkedToId)
    .filter((x): x is string => !!x);
  const purchases = purchaseIds.length
    ? await prisma.transaction.findMany({
        where: { id: { in: purchaseIds } },
        select: { id: true, date: true, name: true, merchantName: true, amount: true },
      })
    : [];
  const purchaseById = new Map(
    purchases.map((p) => [
      p.id,
      { id: p.id, date: ymd(localDay(p.date)), name: p.merchantName ?? p.name, amount: p.amount },
    ])
  );
  const creditsByWindow = new Map<string, PerkCreditDTO[]>(); // `${benefitId}|${windowKey}`
  const confirmedPerks = new Set<string>();
  const placedRows = [...placement.placed]
    .map(([id, pl]) => ({ row: rows.get(id)!, pl }))
    .sort((a, b) => a.row.date.getTime() - b.row.date.getTime());
  for (const { row, pl } of placedRows) {
    if (pl.how === "confirmed") confirmedPerks.add(pl.benefitId);
    const k = `${pl.benefitId}|${pl.windowKey}`;
    const list = creditsByWindow.get(k) ?? [];
    list.push({
      id: row.id,
      date: ymd(row.date),
      name: row.name,
      amount: -row.amount,
      how: pl.how,
      purchase: row.linkedToId ? purchaseById.get(row.linkedToId) ?? null : null,
    });
    creditsByWindow.set(k, list);
  }

  const perkQuestions: PerkQuestionDTO[] = placement.questions.flatMap((q) => {
    const row = rows.get(q.transactionId)!;
    // The card can vanish between the two parallel reads; skip its question.
    const card = cards.find((c) => c.accountId === row.accountId);
    if (!card) return [];
    return {
      transactionId: q.transactionId,
      date: ymd(row.date),
      name: row.name,
      amount: -row.amount,
      cardId: card.id,
      cardName: card.name ?? card.issuer,
      suggestedBenefitId: q.suggestedBenefitId,
      windowFull: q.windowFull,
    };
  });

  const linkedIds = [
    ...new Set(cards.map((c) => c.accountId).filter((x): x is string => !!x)),
  ];

  const accounts = linkedIds.length
    ? await prisma.account.findMany({
        where: { id: { in: linkedIds } },
        select: { id: true, name: true, displayName: true },
      })
    : [];
  // The name given the account on Accounts wins over the bank's ("CREDIT CARD").
  const accountName = new Map(accounts.map((a) => [a.id, a.displayName ?? a.name]));
  const accountDisplayName = new Map(accounts.map((a) => [a.id, a.displayName]));

  // Pull this year's transactions for all linked accounts in one query, then
  // slice per benefit window in memory for category-spending mode and earnings,
  // which both skip transfers. Statement credits come from loadPerkPlacement.
  const txByAccount = new Map<
    string,
    {
      amount: number;
      date: Date;
      isTransfer: boolean;
      pfcPrimary: string;
      pfcDetailed: string | null;
      userCategory: string | null;
      name: string;
      merchantName: string | null;
      splits: { amount: number; userCategory: string }[];
    }[]
  >();
  if (linkedIds.length) {
    // Back to the start of last year: a monthly strip shifted to a card's
    // membership month can begin as early as December of the previous year.
    const yearStart = new Date(now.getFullYear() - 1, 0, 1);
    const txs = await prisma.transaction.findMany({
      where: {
        accountId: { in: linkedIds },
        isFee: false,
        pending: false,
        date: { gte: queryStart(yearStart) },
      },
      select: {
        accountId: true,
        amount: true,
        date: true,
        isTransfer: true,
        pfcPrimary: true,
        pfcDetailed: true,
        userCategory: true,
        name: true,
        merchantName: true,
        splits: { select: { amount: true, userCategory: true } },
      },
    });
    for (const t of txs) {
      const arr = txByAccount.get(t.accountId) ?? [];
      arr.push({
        amount: t.amount,
        date: localDay(t.date),
        isTransfer: t.isTransfer,
        pfcPrimary: t.pfcPrimary,
        pfcDetailed: t.pfcDetailed,
        userCategory: t.userCategory,
        name: t.name,
        merchantName: t.merchantName,
        splits: t.splits,
      });
      txByAccount.set(t.accountId, arr);
    }
  }

  // Quarters as one running index, so "last 8" and window overlap are subtraction.
  const qIndex = (year: number, quarter: number) => year * 4 + quarter - 1;
  const nowQ = quarterOf(now);
  const nowIdx = qIndex(nowQ.year, nowQ.quarter);

  const cardDTOs = cards.map((card): UserCardDTO => {
    const bonuses: RotatingBonusInput[] = card.rotatingBonuses.map((b) => ({
      year: b.year,
      quarter: b.quarter,
      multiplier: b.multiplier,
      unit: b.unit,
      categories: parseCategories(b.categories),
      merchants: parseCategories(b.merchants),
      excludeMerchants: parseCategories(b.excludeMerchants),
      cap: b.cap,
      activated: b.activated,
    }));
    const rotating: RotatingBonusDTO[] = bonuses
      .filter((b) => {
        const i = qIndex(b.year, b.quarter);
        return i <= nowIdx && i > nowIdx - 8;
      })
      .map((b) => ({
        ...b,
        key: quarterKey(b.year, b.quarter),
        label: quarterLabel(b.year, b.quarter),
        display: formatRate(b.multiplier, b.unit),
        categoryLabels: b.categories.map((c) => REWARD_CATEGORY_LABELS[c] ?? c),
        current: b.year === nowQ.year && b.quarter === nowQ.quarter,
      }));

    const allTxns = card.accountId ? txByAccount.get(card.accountId) ?? [] : [];
    const txns = allTxns.filter((t) => !t.isTransfer);

    const benefits: BenefitDTO[] = card.benefits.map((b) => {
      const cats = parseCategories(b.matchCategories);
      const keywords = parseCategories(b.matchText).map((k) => k.toLowerCase());

      // A perk carries its value on its own — no linked account needed — so it
      // takes precedence over transaction matching.
      const autoMode: BenefitDTO["autoMode"] = b.perkActiveFrom
        ? "perk"
        : card.accountId && (keywords.length > 0 || confirmedPerks.has(b.id))
          ? "credits"
          : card.accountId && cats.length > 0
            ? "spending"
            : null;

      // Auto-computed usage in an arbitrary window, per the benefit's mode.
      // Credits: the statement credits placeCredits put in this window (so a
      // refused or overflow row never counts); spending matches positive
      // transactions by category; a perk is flat.
      const creditsIn = (key: string) => creditsByWindow.get(`${b.id}|${key}`) ?? [];
      const autoUsed = (s: Date, e: Date, key: string): number => {
        const inWin = (t: { date: Date }) => t.date >= s && t.date < e;
        // An active perk delivers its full value in every window that was still
        // open when it was switched on. Windows that closed earlier stay at $0.
        if (autoMode === "perk") {
          return b.perkActiveFrom && e > b.perkActiveFrom ? b.amount : 0;
        }
        if (autoMode === "credits") {
          return creditsIn(key).reduce((sum, c) => sum + c.amount, 0);
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
      const used = curOverride != null ? curOverride : autoUsed(cur.start, cur.end, cur.key);
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
        const u = ov != null ? ov : autoUsed(w.start, w.end, w.key);
        return {
          label: w.label,
          short: w.short,
          key: w.key,
          used: round(u),
          target: b.amount,
          captured: b.amount > 0 && u >= b.amount,
          manual: ov != null,
          future: w.start > now,
          credits: creditsIn(w.key),
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
        openQuestions: perkQuestions.filter((q) => q.suggestedBenefitId === b.id).length,
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
          earnEnd,
          // Quarters overlapping the earnings window [earnStart, earnEnd).
          bonuses.filter((b) => {
            const i = qIndex(b.year, b.quarter);
            const s = quarterOf(earnStart);
            const e = quarterOf(new Date(earnEnd.getTime() - 1));
            return i >= qIndex(s.year, s.quarter) && i <= qIndex(e.year, e.quarter);
          })
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
      // Served by /api/card-art rather than linked from public/, since the file
      // lives in data/ with everything else the app writes.
      artUrl: card.artFile ? `/api/card-art/${card.artFile}` : null,
      linked: !!card.accountId,
      linkedAccountName: card.accountId
        ? accountName.get(card.accountId) ?? null
        : null,
      displayName: card.accountId
        ? accountDisplayName.get(card.accountId) ?? null
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
      hasRotating: card.rewardRates.some((r) => r.category === "ROTATING"),
      rotating,
    };
  });
  return { cards: cardDTOs, perkQuestions };
}
