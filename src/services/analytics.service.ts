/**
 * Spending analytics: loads rows and hands them to the pure aggregation in
 * src/lib/analytics.ts.
 *
 * Plaid sign convention: amount > 0 is an outflow (spending), amount < 0 is an
 * inflow (income). Transfers, fees, and pending rows are excluded upstream.
 */

import { prisma } from "@/lib/prisma";
import {
  aggregate,
  buildCashflow,
  dayKey,
  monthKey,
  queryStart,
  startOfWindow,
  type TxInput,
} from "@/lib/analytics";
import { NOT_TAGGED_TRANSFER, splitCategory } from "@/lib/categories";
import { isP2p } from "@/lib/zelle";
import { resolveLinkedCategory } from "@/lib/links";
import { sliceForAnalytics } from "@/lib/splits";
import { loadPlaidNamer } from "@/services/categories.service";
import type {
  AnalyticsResult,
  CashflowSeries,
  SpendingSeries,
} from "@/types";

/**
 * Load the spend/income transactions in `[start, now]` as `TxInput`s. Shared by
 * the category/trend analytics and the cash-flow Sankey so both apply the exact
 * same transfer-exclusion rules and category resolution.
 */
async function fetchTxInputs(start: Date): Promise<TxInput[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      date: { gte: queryStart(start) },
      isFee: false,
      pending: false,
      AND: [
        // Normal spend (not a transfer), OR any P2P transfer the user has
        // classified — a userCategory promotes a Venmo/Zelle transfer in — OR
        // any row linked to a purchase. Without that last clause a linked Zelle
        // payback (isTransfer, and holding no category of its own) is filtered
        // out before it can offset anything.
        {
          OR: [
            { isTransfer: false },
            { userCategory: { not: null } },
            { linkedToId: { not: null } },
          ],
        },
        NOT_TAGGED_TRANSFER,
      ],
    },
    select: {
      amount: true,
      date: true,
      pfcPrimary: true,
      merchantName: true,
      name: true,
      source: true,
      userCategory: true,
      linkedTo: { select: { userCategory: true, pfcPrimary: true } },
      splits: { select: { amount: true, userCategory: true } },
    },
  });

  // Plaid's primaries resolve through the user's own mapping, so an
  // uncategorized row reports the category they chose rather than Plaid's
  // wording. Loaded once per query, not per row.
  const plaidName = await loadPlaidNamer();

  return rows.flatMap((r) => {
    // The linked purchase's own effective category, humanized the same way a
    // top-level row's would be.
    const linkedToCategory = r.linkedTo
      ? r.linkedTo.userCategory ?? plaidName(r.linkedTo.pfcPrimary)
      : null;
    const { raw, isOffset } = resolveLinkedCategory({
      amount: r.amount,
      userCategory: r.userCategory,
      linkedToCategory,
    });

    // The WHERE clause excludes rows tagged "Transfer" with a string match,
    // which cannot reach through a relation — so a row that inherits
    // "Transfer" has to be dropped here instead.
    if (raw === "Transfer" || raw?.startsWith("Transfer > ")) return [];

    // A user category (Venmo/Zelle/manual/inherited) wins over Plaid's PFC
    // primary, and is what the remainder wears.
    const effective = raw ?? plaidName(r.pfcPrimary);
    // P2P rows use a person as the "merchant" — keep them out of merchant totals.
    const merchant = isP2p(r.source, r.name) ? null : r.merchantName ?? r.name;

    // The Transfer-slice filter, the revision-shrunk-remainder offset guard,
    // and the one-slice-per-row counting rule are pure logic and live in
    // src/lib/splits.ts (sliceForAnalytics) so they can be unit-tested
    // directly under node:test. What's left here is contextual: rolling a
    // raw "Parent > Sub" category up for display, and attaching this row's
    // date and merchant to every surviving slice.
    return sliceForAnalytics({ amount: r.amount, effectiveCategory: effective, isOffset }, r.splits)
      .map((slice) => {
        // Subcategorized values ("Parent > Sub") roll up to their parent; the
        // sub travels alongside for drill-down views (single-month Sankey).
        const { parent, sub } = splitCategory(slice.userCategory);
        return {
          amount: slice.amount,
          date: r.date,
          category: parent,
          subcategory: sub,
          merchant,
          isOffset: slice.isOffset,
          countsAsTransaction: slice.countsAsTransaction,
        };
      });
  });
}

export async function getAnalytics(months: number): Promise<AnalyticsResult> {
  const start = startOfWindow(new Date(), months);
  return aggregate(await fetchTxInputs(start), months);
}

/**
 * Cash on hand right now: the sum of depository (checking/savings) balances.
 * A disconnected bank's balances are frozen, so like every other total this
 * leaves them out.
 */
async function getCurrentCash(): Promise<{ currentCash: number; cashAsOf: string | null }> {
  const accts = await prisma.account.findMany({
    where: { type: "DEPOSITORY", item: { disconnectedAt: null } },
    select: { currentBalance: true, balanceFetchedAt: true },
  });
  const currentCash = accts.reduce((s, a) => s + a.currentBalance, 0);
  const latest = accts.reduce<Date | null>(
    (max, a) => (!max || a.balanceFetchedAt > max ? a.balanceFetchedAt : max),
    null
  );
  return {
    currentCash: Math.round(currentCash * 100) / 100,
    cashAsOf: latest?.toISOString() ?? null,
  };
}

export async function getCashflow(months = 24): Promise<CashflowSeries> {
  const start = startOfWindow(new Date(), months);
  const [monthsData, cash] = await Promise.all([
    fetchTxInputs(start).then((txs) => buildCashflow(txs, months)),
    getCurrentCash(),
  ]);
  return { months: monthsData, ...cash };
}

/**
 * Daily spend totals over the window, for the cumulative spending graph. Uses
 * the same spend definition as the rest of analytics: outflows count positive,
 * reimbursements (classified inflows) net them down, plain income is ignored.
 */
/** The effective category label of Plaid's RENT_AND_UTILITIES. */
const RENT_AND_UTILITIES = "Rent and Utilities";

export async function getDailySpending(months = 24): Promise<SpendingSeries> {
  const start = startOfWindow(new Date(), months);
  const txs = await fetchTxInputs(start);
  const round = (n: number) => Math.round(n * 100) / 100;

  // Per day: total spend, and the part of it in Rent and Utilities (the
  // phone's graph can leave that out).
  const map = new Map<string, { amount: number; rent: number }>();
  const startKey = monthKey(start);
  for (const t of txs) {
    if (monthKey(t.date) < startKey) continue;
    let v = 0;
    if (t.amount > 0) v = t.amount; // spending
    else if (t.isOffset) v = t.amount; // reimbursement: negative, reduces spend
    else continue; // plain income inflow — not spending
    const key = dayKey(t.date);
    const entry = map.get(key) ?? { amount: 0, rent: 0 };
    entry.amount += v;
    if (t.category === RENT_AND_UTILITIES) entry.rent += v;
    map.set(key, entry);
  }

  const days = [...map.entries()]
    .map(([date, e]) => ({
      date,
      amount: round(e.amount),
      rentAndUtilities: round(e.rent),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { days };
}
