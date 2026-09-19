/**
 * Payment splits: carving one transaction into several categories without
 * turning it into several transactions.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. The same constraint governs `src/lib/links.ts`,
 * `src/lib/labels.ts` and `src/lib/pro-mode.ts`.
 *
 * Plaid sign convention throughout: amount > 0 is money out. A carve-out is a
 * slice of money out, so its amount is always positive.
 */

/**
 * A stored carve-out: an amount of a transaction placed under its own category.
 *
 * No id. Slicing never needs one, and requiring it would force every caller to
 * select a column it does not use — `benefits.service.ts` reads only the amount
 * and the category. The API and DTO layers carry ids of their own.
 */
export interface SplitPart {
  amount: number;
  /** Full category, possibly "Parent > Sub". */
  userCategory: string;
}

/** A transaction being sliced, reduced to what slicing needs. */
export interface SliceRow {
  amount: number;
  /** The row's effective category, already resolved and humanized. */
  effectiveCategory: string;
}

/** A transaction being split, reduced to what validation needs. */
export interface SplitTarget {
  amount: number;
  pending: boolean;
}

/** One (amount, category) pair a transaction reports to a consumer. */
export interface Slice {
  amount: number;
  userCategory: string;
  /** True for the derived leftover, false for a carve-out the user typed. */
  isRemainder: boolean;
}

/** Below this, a remainder is zero rather than float noise. */
const CENT = 0.005;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What is left of a transaction after its carve-outs. Negative when a later
 * amount revision dropped the total below what was already carved out — that
 * is surfaced rather than clamped, because clamping would edit a figure the
 * user typed in response to an event they never saw.
 */
export function remainderOf(amount: number, parts: { amount: number }[]): number {
  return round(parts.reduce((left, p) => left - p.amount, amount));
}

/**
 * A transaction as the list of (amount, category) pairs it really represents.
 *
 * The remainder is derived here rather than stored, which is what lets a Plaid
 * amount revision or a recategorization of the row flow through for free. An
 * unsplit row yields exactly one slice, so every consumer can call this
 * unconditionally instead of branching on whether a row has parts.
 */
export function sliceTransaction(row: SliceRow, parts: SplitPart[]): Slice[] {
  const slices: Slice[] = parts.map((p) => ({
    amount: p.amount,
    userCategory: p.userCategory,
    isRemainder: false,
  }));

  const left = remainderOf(row.amount, parts);
  // An exhausted split reports only its parts. Keeping a zero slice would add
  // a phantom row to the ledger and a zero-amount entry to every chart.
  if (parts.length === 0 || Math.abs(left) >= CENT) {
    slices.push({
      amount: left,
      userCategory: row.effectiveCategory,
      isRemainder: true,
    });
  }
  return slices;
}

/**
 * Why a proposed carve-out cannot be added, or null if it is fine.
 *
 * Over-allocation is refused at write time even though a later revision may
 * push the remainder negative anyway: asking for an impossible split outright
 * is a mistake worth catching, while drift is something that happened to you.
 */
export function validateNewSplit(
  row: SplitTarget,
  existing: { amount: number }[],
  proposed: { amount: number; userCategory: string }
): string | null {
  if (row.amount <= 0) return "Only a purchase (money out) can be split";
  if (row.pending)
    return "Pending transactions cannot be split — they are replaced when they post";
  // Written as a positive test so NaN, which fails every comparison, is caught
  // here rather than reaching the database.
  if (!(proposed.amount > 0)) return "A split amount must be greater than zero";
  if (proposed.userCategory.trim() === "") return "A split needs a category";
  if (proposed.amount > remainderOf(row.amount, existing) + CENT)
    return "That is more than the amount left to split";
  return null;
}
