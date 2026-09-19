/**
 * Spending analytics. The aggregation is a pure function (`aggregate`) over a
 * plain array so it can be unit-tested without a database; `getAnalytics`
 * handles the Prisma query and hands the rows to it.
 *
 * Plaid sign convention: amount > 0 is an outflow (spending), amount < 0 is an
 * inflow (income). Transfers, fees, and pending rows are excluded upstream.
 */

import { prisma } from "@/lib/prisma";
import { humanizePfc } from "@/lib/format";
import { splitCategory } from "@/lib/categories";
import { isP2p } from "@/lib/zelle";
import { resolveLinkedCategory } from "@/lib/links";
import { sliceTransaction } from "@/lib/splits";
import { loadPlaidCategoryMap } from "@/services/categories.service";
import type {
  AnalyticsResult,
  CashflowMonth,
  CashflowSeries,
  SpendingSeries,
} from "@/types";

export interface TxInput {
  amount: number; // Plaid sign: >0 outflow (spend), <0 inflow
  date: Date;
  category: string; // effective, already-humanized category label
  subcategory: string | null; // user-defined sub from a "Parent > Sub" override
  merchant: string | null; // null => excluded from merchant totals (e.g. Venmo)
  // A negative-amount row that offsets its own category instead of counting as
  // income — used for Venmo reimbursements ("got paid back for the dinner").
  isOffset: boolean;
  // False for every slice of a split row but one, so a transaction sliced into
  // several categories is still one transaction in the headline count.
  // Optional — missing (e.g. from a producer that never splits) means true.
  countsAsTransaction?: boolean;
}

/** First day of the month, `monthsBack` months before `from`. */
function startOfWindow(from: Date, monthsBack: number): Date {
  return new Date(from.getFullYear(), from.getMonth() - (monthsBack - 1), 1);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "short" });
}

export function aggregate(
  transactions: TxInput[],
  months: number,
  now: Date = new Date()
): AnalyticsResult {
  const start = startOfWindow(now, months);

  // Pre-build every month bucket in the window so the trend chart has no gaps.
  const buckets = new Map<string, { spent: number; income: number; label: string }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.set(monthKey(d), { spent: 0, income: 0, label: monthLabel(d) });
  }

  const categoryTotals = new Map<string, { amount: number; count: number }>();
  const merchantTotals = new Map<string, { amount: number; count: number }>();

  let totalSpent = 0;
  let totalIncome = 0;
  let txCount = 0;

  for (const t of transactions) {
    if (t.date < start) continue;
    // A split row is several TxInputs but one transaction; only the slice
    // marked as the counting one bumps the headline count.
    if (t.countsAsTransaction !== false) txCount++;

    const bucket = buckets.get(monthKey(t.date));
    const cat = t.category || "Uncategorized";

    if (t.amount > 0) {
      // Outflow = spending
      totalSpent += t.amount;
      if (bucket) bucket.spent += t.amount;

      const c = categoryTotals.get(cat) ?? { amount: 0, count: 0 };
      c.amount += t.amount;
      c.count += 1;
      categoryTotals.set(cat, c);

      if (t.merchant) {
        const m = merchantTotals.get(t.merchant) ?? { amount: 0, count: 0 };
        m.amount += t.amount;
        m.count += 1;
        merchantTotals.set(t.merchant, m);
      }
    } else if (t.amount < 0) {
      if (t.isOffset) {
        // Reimbursement: nets against its category and overall spend instead of
        // showing up as income.
        totalSpent += t.amount; // amount is negative -> reduces spend
        if (bucket) bucket.spent += t.amount;
        const c = categoryTotals.get(cat) ?? { amount: 0, count: 0 };
        c.amount += t.amount;
        c.count += 1;
        categoryTotals.set(cat, c);
      } else {
        // Inflow = income
        totalIncome += -t.amount;
        if (bucket) bucket.income += -t.amount;
      }
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const clamp = (n: number) => round(Math.max(0, n));

  return {
    summary: {
      totalSpent: round(Math.max(0, totalSpent)),
      totalIncome: round(totalIncome),
      net: round(totalIncome - totalSpent),
      txCount,
    },
    byCategory: [...categoryTotals.entries()]
      .map(([category, v]) => ({ category, amount: clamp(v.amount), count: v.count }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    byMonth: [...buckets.entries()].map(([month, v]) => ({
      month,
      label: v.label,
      spent: clamp(v.spent),
      income: round(v.income),
    })),
    topMerchants: [...merchantTotals.entries()]
      .map(([name, v]) => ({ name, amount: round(v.amount), count: v.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    rangeMonths: months,
  };
}

/**
 * Load the spend/income transactions in `[start, now]` as `TxInput`s. Shared by
 * the category/trend analytics and the cash-flow Sankey so both apply the exact
 * same transfer-exclusion rules and category resolution.
 */
async function fetchTxInputs(start: Date): Promise<TxInput[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      date: { gte: start },
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
        // Drop anything explicitly flagged "Transfer" (null-safe: keep
        // nulls), including subcategorized "Transfer > ..." overrides.
        {
          OR: [
            { userCategory: null },
            {
              AND: [
                { userCategory: { not: "Transfer" } },
                { NOT: { userCategory: { startsWith: "Transfer > " } } },
              ],
            },
          ],
        },
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
  const plaidMap = await loadPlaidCategoryMap();
  const plaidName = (primary: string) => plaidMap.get(primary) ?? humanizePfc(primary);

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

    // A part can be tagged Transfer independently of its row, and the WHERE
    // clause's string match cannot see parts at all — so the exclusion is
    // applied per slice here. Filtered before the count is assigned below, so
    // a row never loses its count just because its first surviving slice
    // isn't index 0 of the raw slice list.
    const kept = sliceTransaction({ amount: r.amount, effectiveCategory: effective }, r.splits)
      .filter(
        (slice) =>
          slice.userCategory !== "Transfer" && !slice.userCategory.startsWith("Transfer > ")
      );

    // Only a row that actually carries carve-outs can produce a negative
    // remainder (a later Plaid amount revision dropping the row below what
    // was already carved out — validateNewSplit refuses splitting a money-in
    // row in the first place, so this can only happen on a money-out row).
    // An UNSPLIT row's sole slice is its whole amount, and for a plain income
    // row that amount is negative too — that slice must stay real income, not
    // be swept into this net-against-category treatment. So the guard checks
    // r.splits.length, not just the slice's sign.
    const hasParts = r.splits.length > 0;

    return kept.map((slice, i) => {
      // Subcategorized values ("Parent > Sub") roll up to their parent; the
      // sub travels alongside for drill-down views (single-month Sankey).
      const { parent, sub } = splitCategory(slice.userCategory);
      return {
        amount: slice.amount,
        date: r.date,
        category: parent,
        subcategory: sub,
        merchant,
        // A revision-shrunk remainder nets against its own category instead
        // of reading as fabricated income.
        isOffset: isOffset || (hasParts && slice.amount < 0),
        // One slice per row counts toward the headline transaction total,
        // however many categories it was carved into.
        countsAsTransaction: i === 0,
      };
    });
  });
}

export async function getAnalytics(months: number): Promise<AnalyticsResult> {
  const start = startOfWindow(new Date(), months);
  return aggregate(await fetchTxInputs(start), months);
}

/**
 * Per-month cash-flow series: for each month in the window, inflows grouped by
 * income source and outflows grouped by spending category. The Sankey client
 * aggregates any sub-range of these months on its own, so the drawdown-vs-income
 * gap is reconciled at render time rather than here.
 */
export function buildCashflow(
  transactions: TxInput[],
  months: number,
  now: Date = new Date()
): CashflowMonth[] {
  const start = startOfWindow(now, months);
  const round = (n: number) => Math.round(n * 100) / 100;

  // Pre-build an ordered bucket per month so gaps render as empty periods.
  // Spend entries also track user-defined subcategory totals so the Sankey can
  // branch a category into its subs when a single month is in view.
  const order: string[] = [];
  type SpendEntry = { total: number; subs: Map<string, number> };
  const buckets = new Map<
    string,
    { label: string; income: Map<string, number>; spend: Map<string, SpendEntry> }
  >();
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = monthKey(d);
    order.push(key);
    buckets.set(key, {
      label: d.toLocaleString("en-US", { month: "short", year: "numeric" }),
      income: new Map(),
      spend: new Map(),
    });
  }

  const addSpend = (
    spend: Map<string, SpendEntry>,
    cat: string,
    sub: string | null,
    amount: number
  ) => {
    let e = spend.get(cat);
    if (!e) spend.set(cat, (e = { total: 0, subs: new Map() }));
    e.total += amount;
    if (sub) e.subs.set(sub, (e.subs.get(sub) ?? 0) + amount);
  };

  for (const t of transactions) {
    if (t.date < start) continue;
    const bucket = buckets.get(monthKey(t.date));
    if (!bucket) continue;
    const cat = t.category || "Uncategorized";

    if (t.amount > 0) {
      addSpend(bucket.spend, cat, t.subcategory, t.amount);
    } else if (t.amount < 0) {
      if (t.isOffset) {
        // Reimbursement nets against its spend category (amount is negative).
        addSpend(bucket.spend, cat, t.subcategory, t.amount);
      } else {
        bucket.income.set(cat, (bucket.income.get(cat) ?? 0) + -t.amount);
      }
    }
  }

  return order.map((key) => {
    const b = buckets.get(key)!;
    return {
      key,
      label: b.label,
      income: [...b.income.entries()]
        .map(([source, amount]) => ({ source, amount: round(amount) }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount),
      spend: [...b.spend.entries()]
        .map(([category, e]) => {
          const subs = [...e.subs.entries()]
            .map(([name, amount]) => ({ name, amount: round(amount) }))
            .filter((s) => s.amount > 0)
            .sort((a, b) => b.amount - a.amount);
          return {
            category,
            amount: round(e.total),
            ...(subs.length ? { subs } : {}),
          };
        })
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount),
    };
  });
}

/** Cash on hand right now: the sum of depository (checking/savings) balances. */
async function getCurrentCash(): Promise<{ currentCash: number; cashAsOf: string | null }> {
  const accts = await prisma.account.findMany({
    where: { type: "DEPOSITORY" },
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

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Daily spend totals over the window, for the cumulative spending graph. Uses
 * the same spend definition as the rest of analytics: outflows count positive,
 * reimbursements (classified inflows) net them down, plain income is ignored.
 */
export async function getDailySpending(months = 24): Promise<SpendingSeries> {
  const start = startOfWindow(new Date(), months);
  const txs = await fetchTxInputs(start);
  const round = (n: number) => Math.round(n * 100) / 100;

  const map = new Map<string, number>();
  for (const t of txs) {
    if (t.date < start) continue;
    let v = 0;
    if (t.amount > 0) v = t.amount; // spending
    else if (t.isOffset) v = t.amount; // reimbursement: negative, reduces spend
    else continue; // plain income inflow — not spending
    const key = dayKey(t.date);
    map.set(key, (map.get(key) ?? 0) + v);
  }

  const days = [...map.entries()]
    .map(([date, amount]) => ({ date, amount: round(amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { days };
}
