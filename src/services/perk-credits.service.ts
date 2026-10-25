/**
 * Loads card perks and candidate statement-credit rows and runs placeCredits
 * over them. Placement is computed on every read, never stored: only the
 * owner's answers (benefitDecision/benefitId) live on the rows.
 */

import { prisma } from "@/lib/prisma";
import { localDay } from "@/lib/format";
import { queryStart } from "@/lib/analytics";
import { validateLink } from "@/lib/links";
import {
  appendUnique,
  canAutoPair,
  isCreditCandidate,
  openPurchases,
  pickAutoPair,
  placeCredits,
  rankPurchases,
  PAIR_WINDOW_DAYS,
  type CreditRow,
  type PerkInput,
  type Placement,
} from "@/lib/perk-credits";
import { parseCategories, periodWindow, ymd } from "@/services/benefits.service";
import type { PerkPurchaseDTO } from "@/types";

export type CreditRowWithLink = CreditRow & {
  linkedToId: string | null; noAutoPair: boolean; userCategorySource: string | null;
};

const ASK_DAYS = 90;
const DAY = 86_400_000;

export async function loadPerkPlacement(now: Date = new Date()): Promise<{
  placement: Placement;
  rows: Map<string, CreditRowWithLink>;
  perks: PerkInput[];
}> {
  const cards = await prisma.userCard.findMany({
    where: { accountId: { not: null } },
    select: {
      accountId: true,
      benefits: {
        where: { perkActiveFrom: null },
        select: { id: true, amount: true, period: true, matchText: true },
      },
    },
  });
  const perks: PerkInput[] = cards.flatMap((c) =>
    c.benefits.map((b) => ({
      id: b.id,
      accountId: c.accountId!,
      amount: b.amount,
      period: b.period,
      keywords: parseCategories(b.matchText),
    }))
  );

  const rows = new Map<string, CreditRowWithLink>();
  const accountIds = [...new Set(perks.map((p) => p.accountId))];
  if (accountIds.length) {
    const txs = await prisma.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        amount: { lt: 0 },
        pending: false,
        isFee: false,
        date: { gte: queryStart(new Date(now.getFullYear() - 1, 0, 1)) },
      },
      select: {
        id: true, accountId: true, date: true, amount: true, name: true, merchantName: true,
        pfcDetailed: true, pending: true, isFee: true, benefitDecision: true, benefitId: true,
        linkedToId: true, noAutoPair: true, userCategorySource: true, linkedTo: { select: { date: true } },
      },
    });
    for (const t of txs) {
      if (!isCreditCandidate(t)) continue;
      const { benefitDecision, linkedTo, ...rest } = t;
      rows.set(t.id, {
        ...rest,
        date: localDay(t.date),
        spentOn: linkedTo ? localDay(linkedTo.date) : null,
        decision: benefitDecision === "YES" || benefitDecision === "NO" ? benefitDecision : null,
      });
    }
  }

  const askSince = new Date(now.getTime() - ASK_DAYS * DAY);
  const placement = placeCredits(perks, [...rows.values()], (p, d) => periodWindow(p, d).key, askSince);
  return { placement, rows, perks };
}

/**
 * Writes that forget deleted perks: undo the pairings this feature made for
 * them and clear per-row answers. Owner-made links stay. Returned unrun so the
 * caller batches them with its delete in one $transaction.
 */
export async function perkDeleteCleanup(benefitIds: string[]) {
  if (!benefitIds.length) return [];
  const { placement } = await loadPerkPlacement();
  const ids = new Set(benefitIds);
  const autoPlaced = [...placement.placed]
    .filter(([, pl]) => ids.has(pl.benefitId) && pl.how === "auto")
    .map(([txId]) => txId);
  return [
    prisma.transaction.updateMany({
      where: { perkPaired: true, OR: [{ benefitId: { in: benefitIds } }, { id: { in: autoPlaced } }] },
      data: { linkedToId: null, perkPaired: false, userCategorySource: null },
    }),
    prisma.transaction.updateMany({
      where: { benefitId: { in: benefitIds } },
      data: { benefitId: null, benefitDecision: null },
    }),
  ];
}

/** Adds a merchant to a perk's remembered pairedMerchants (deduped). */
export async function rememberMerchant(benefitId: string, merchant: string): Promise<void> {
  const b = await prisma.userBenefit.findUnique({ where: { id: benefitId }, select: { pairedMerchants: true } });
  if (!b) return;
  const list = parseCategories(b.pairedMerchants);
  const next = appendUnique(list, merchant);
  if (next !== list) {
    await prisma.userBenefit.update({ where: { id: benefitId }, data: { pairedMerchants: JSON.stringify(next) } });
  }
}

/** True when other transactions were pooled into this row (a Venmo cash-out); see validateLink. */
export async function poolsOthers(id: string): Promise<boolean> {
  return (await prisma.transaction.count({ where: { fundsCashoutId: id } })) > 0;
}

/**
 * Links placed credits to the purchase they paid back when exactly one
 * purchase is a strong match. Only rows from the last 90 days (narrowed to
 * `only` when given), never ones the owner unpaired. Returns the number paired.
 */
export async function pairPerkCredits(opts: { only?: string; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const { placement, rows, perks } = await loadPerkPlacement(now);
  const since = new Date(now.getTime() - ASK_DAYS * DAY);
  const todo = [...placement.placed]
    .map(([id, pl]) => ({ row: rows.get(id)!, benefitId: pl.benefitId }))
    .filter(({ row }) =>
      (!opts.only || row.id === opts.only) && row.date >= since && canAutoPair(row)
    );
  if (!todo.length) return 0;

  const earliest = Math.min(...todo.map(({ row }) => row.date.getTime()));
  const purchases = (
    await prisma.transaction.findMany({
      where: {
        accountId: { in: [...new Set(todo.map(({ row }) => row.accountId))] },
        amount: { gt: 0 },
        pending: false,
        isFee: false,
        date: { gte: queryStart(new Date(earliest - (PAIR_WINDOW_DAYS + 1) * DAY)) },
      },
      select: { id: true, accountId: true, date: true, amount: true, name: true, merchantName: true, linkedToId: true },
    })
  ).map((p) => ({ ...p, date: localDay(p.date) }));
  // Purchases some refund already offsets (any row linked to them).
  const refunded = new Set(
    (
      await prisma.transaction.findMany({
        where: { linkedToId: { in: purchases.map((p) => p.id) } },
        select: { linkedToId: true },
      })
    ).map((t) => t.linkedToId!)
  );

  const benefits = await prisma.userBenefit.findMany({
    where: { id: { in: [...new Set(todo.map((t) => t.benefitId))] } },
    select: { id: true, pairedMerchants: true },
  });
  const merchants = new Map(benefits.map((b) => [b.id, parseCategories(b.pairedMerchants)]));
  const keywords = new Map(perks.map((p) => [p.id, p.keywords]));

  let paired = 0;
  for (const { row, benefitId } of todo) {
    const pool = openPurchases(purchases.filter((p) => p.accountId === row.accountId), refunded);
    const ranked = rankPurchases(row, pool, {
      keywords: keywords.get(benefitId) ?? [],
      pairedMerchants: merchants.get(benefitId) ?? [],
    });
    const target = pool.find((p) => p.id === pickAutoPair(ranked));
    if (!target) continue;
    const problem = validateLink(
      { ...row, poolsOthers: await poolsOthers(row.id) },
      { ...target, isFee: false, pending: false, poolsOthers: false }
    );
    if (problem) continue;
    // Guarded: a concurrent answer or owner link may have linked it meanwhile.
    const { count } = await prisma.transaction.updateMany({
      where: {
        id: row.id, linkedToId: null, noAutoPair: false,
        OR: [{ userCategorySource: null }, { userCategorySource: { not: "MANUAL" } }],
      },
      data: { linkedToId: target.id, userCategory: null, userCategorySource: "LINK", perkPaired: true },
    });
    if (count === 0) continue;
    refunded.add(target.id);
    const merchant = target.merchantName ?? target.name;
    merchants.set(benefitId, appendUnique(merchants.get(benefitId) ?? [], merchant));
    await rememberMerchant(benefitId, merchant);
    paired++;
  }
  return paired;
}

/**
 * Credits on a perk's card from the last 365 days that are not already placed
 * to it, newest first, for "Add Transaction". Null when the perk is unknown.
 */
export async function listPerkCandidates(benefitId: string, now: Date = new Date()): Promise<PerkPurchaseDTO[] | null> {
  const benefit = await prisma.userBenefit.findUnique({
    where: { id: benefitId },
    select: { card: { select: { accountId: true } } },
  });
  if (!benefit) return null;
  const accountId = benefit.card.accountId;
  if (!accountId) return [];
  const [{ placement }, txs] = await Promise.all([
    loadPerkPlacement(now),
    prisma.transaction.findMany({
      where: {
        accountId,
        amount: { lt: 0 },
        pending: false,
        isFee: false,
        date: { gte: queryStart(new Date(now.getTime() - 365 * DAY)) },
      },
      orderBy: { date: "desc" },
      select: { id: true, date: true, amount: true, name: true, pfcDetailed: true, pending: true, isFee: true },
    }),
  ]);
  const since = new Date(now.getTime() - 365 * DAY);
  return txs
    .map((t) => ({ ...t, date: localDay(t.date) }))
    .filter((t) => t.date >= since && isCreditCandidate(t) && placement.placed.get(t.id)?.benefitId !== benefitId)
    .slice(0, 50)
    .map((t) => ({ id: t.id, date: ymd(t.date), name: t.name, amount: -t.amount }));
}
