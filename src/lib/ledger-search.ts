import type { Prisma } from "@prisma/client";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The ledger search box as a Prisma filter: the text against every written
 * field, plus — when it reads as one — an amount, a date or a row number.
 */
export function ledgerSearchWhere(search: string, now = new Date()): Prisma.TransactionWhereInput {
  const or: Prisma.TransactionWhereInput[] = [
    { name: { contains: search } },
    { merchantName: { contains: search } },
    { counterparty: { contains: search } },
    { personalNote: { contains: search } },
    { userCategory: { contains: search } },
    { account: { name: { contains: search } } },
    { account: { displayName: { contains: search } } },
  ];

  const amount = parseAmount(search);
  if (amount) {
    const { lo, hi } = amount;
    // Either sign: a refund of $12 is stored as -12.
    or.push({ amount: { gte: lo, lt: hi } }, { amount: { gt: -hi, lte: -lo } });
  }

  const label = search.match(/^#?(\d+)$/);
  if (label) or.push({ label: Number(label[1]) });

  const day = parseDateRange(search, now);
  if (day) {
    const [y, m, d, unit] = day;
    const end = unit === "day" ? [y, m, d + 1] : unit === "month" ? [y, m + 1, 1] : [y + 1, 0, 1];
    // Bank dates are UTC midnight, Venmo times real instants (see calendarDay).
    // shortcut: a real instant within the UTC offset of the edge can match the neighbouring day; fine for search.
    or.push(
      { date: { gte: new Date(Date.UTC(y, m, d)), lt: new Date(Date.UTC(end[0], end[1], end[2])) } },
      { date: { gte: new Date(y, m, d), lt: new Date(end[0], end[1], end[2]) } },
    );
  }

  return { OR: or };
}

/** "$1,234.5" → |amount| in [1234.50, 1234.51); "12" → [12, 13). */
export function parseAmount(s: string): { lo: number; hi: number } | null {
  const m = s.replace(/[$,\s]/g, "").match(/^[-+]?(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  if (m[2] === undefined) return { lo: whole, hi: whole + 1 };
  const cents = Math.round(Number(`${m[1]}.${m[2]}`) * 100);
  const step = m[2].length === 1 ? 10 : 1; // "12.3" → 12.30–12.39
  // Half a cent of slack either side for float storage.
  return { lo: (cents - 0.5) / 100, hi: (cents + step - 0.5) / 100 };
}

type DateRange = [year: number, month0: number, day: number, unit: "day" | "month" | "year"];

/**
 * "2026-10-05", "10/5", "10/5/26", "Oct 5", "Oct 5, 2026", "October",
 * "Oct 2026", "2026". A date without a year is the latest one not in the future.
 */
export function parseDateRange(s: string, now = new Date()): DateRange | null {
  const t = s.trim().toLowerCase().replace(/,/g, "");
  let y: number | undefined, m: number, d: number | undefined;
  let r: RegExpMatchArray | null;
  if ((r = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) {
    [y, m, d] = [Number(r[1]), Number(r[2]) - 1, r[3] ? Number(r[3]) : undefined];
  } else if ((r = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    [m, d] = [Number(r[1]) - 1, Number(r[2])];
    if (r[3]) y = r[3].length === 2 ? 2000 + Number(r[3]) : Number(r[3]);
  } else if ((r = t.match(/^([a-z]{3,9})(?: (\d{1,2}))?(?: (\d{4}))?$/))) {
    const word = r[1];
    // "oct", "octo", "october"; at least three letters, so "ma" is nothing.
    const idx = MONTHS.findIndex((mo) => mo.startsWith(word));
    if (idx === -1) return null;
    [m, d, y] = [idx, r[2] ? Number(r[2]) : undefined, r[3] ? Number(r[3]) : undefined];
  } else if ((r = t.match(/^(20\d{2})$/))) {
    return [Number(r[1]), 0, 1, "year"];
  } else return null;

  if (m < 0 || m > 11 || (d !== undefined && (d < 1 || d > 31))) return null;
  if (y === undefined) {
    y = now.getFullYear();
    if (new Date(y, m, d ?? 1) > now) y -= 1;
  }
  return d === undefined ? [y, m, 1, "month"] : [y, m, d, "day"];
}
