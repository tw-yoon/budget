/**
 * The pure half of spending analytics: plain arrays in, chart series out, so
 * node:test can check it without a database. analytics.service.ts loads rows.
 *
 * Plaid sign convention: amount > 0 is an outflow (spending), amount < 0 is an
 * inflow (income). Transfers, fees, and pending rows are excluded upstream.
 */

import { calendarDay } from "@/lib/format";
import type { AnalyticsResult, CashflowMonth } from "@/types";

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
export function startOfWindow(from: Date, monthsBack: number): Date {
  return new Date(from.getFullYear(), from.getMonth() - (monthsBack - 1), 1);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10" for the calendar month a transaction date stands for. */
export function monthKey(d: Date): string {
  const { y, m } = calendarDay(d);
  return `${y}-${pad(m)}`;
}

/**
 * The earliest instant the window's first day can be stored as: a bank date is
 * UTC midnight, which west of UTC comes before local midnight.
 */
export function queryStart(start: Date): Date {
  const utc = new Date(Date.UTC(start.getFullYear(), start.getMonth(), 1));
  return utc < start ? utc : start;
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

  const startKey = monthKey(start);
  for (const t of transactions) {
    if (monthKey(t.date) < startKey) continue;
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

export function dayKey(d: Date): string {
  const { y, m, day } = calendarDay(d);
  return `${y}-${pad(m)}-${pad(day)}`;
}
