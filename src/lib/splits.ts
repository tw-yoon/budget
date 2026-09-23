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

/** The money-rounding rule every write path applies before storing an amount. */
export function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What is left of a transaction after its carve-outs. Negative when a later
 * amount revision dropped the total below what was already carved out — that
 * is surfaced rather than clamped, because clamping would edit a figure the
 * user typed in response to an event they never saw.
 */
export function remainderOf(amount: number, parts: { amount: number }[]): number {
  return roundToCents(parts.reduce((left, p) => left - p.amount, amount));
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

/** One slice as analytics needs to report it: still-raw category, plus the two
 * flags that determine which bucket it lands in. */
export interface AnalyticsSlice {
  amount: number;
  /** Raw, possibly "Parent > Sub" — the caller rolls this up for display. */
  userCategory: string;
  isOffset: boolean;
  /** True on exactly one surviving slice per row (see `sliceForAnalytics`). */
  countsAsTransaction: boolean;
}

/**
 * A row's slices as analytics reports them: Transfer-tagged parts dropped,
 * a revision-shrunk remainder netted against its category instead of read as
 * income, and exactly one surviving slice per row marked as the one that
 * counts toward the headline transaction total.
 *
 * Kept here, alongside `sliceTransaction`, rather than inline in the caller:
 * this logic once fabricated income when a Plaid amount revision dropped a
 * split row below what was already carved out, and that is exactly the kind
 * of bug a `node:test`-under-plain-Node suite catches only if the code lives
 * somewhere that suite can load — which means no path-aliased imports here,
 * same as the rest of this file. The caller still owns `splitCategory`
 * (parent/sub roll-up) and attaching `date`/`merchant`, since neither belongs
 * in a module that cannot import `@/lib/categories`.
 */
export function sliceForAnalytics(
  row: { amount: number; effectiveCategory: string; isOffset: boolean },
  parts: SplitPart[]
): AnalyticsSlice[] {
  // A part can be tagged Transfer independently of its row, and the caller's
  // WHERE clause (a string match) cannot see parts at all — so the exclusion
  // is applied per slice here, before a count is assigned below, so a row
  // never loses its count just because its first raw slice is a Transfer
  // carve-out.
  const kept = sliceTransaction({ amount: row.amount, effectiveCategory: row.effectiveCategory }, parts)
    .filter(
      (slice) => slice.userCategory !== "Transfer" && !slice.userCategory.startsWith("Transfer > ")
    );

  // Only a row that actually carries carve-outs can produce a negative
  // remainder (a later Plaid amount revision dropping the row below what was
  // already carved out — validateNewSplit refuses splitting a money-in row in
  // the first place, so this can only happen on a money-out row). An UNSPLIT
  // row's sole slice is its whole amount, and for a plain income row that
  // amount is negative too — that slice must stay real income, not be swept
  // into this net-against-category treatment. So the guard checks
  // `parts.length`, not just the slice's sign.
  const hasParts = parts.length > 0;

  return kept.map((slice, i) => ({
    amount: slice.amount,
    userCategory: slice.userCategory,
    // A revision-shrunk remainder nets against its own category instead of
    // reading as fabricated income.
    isOffset: row.isOffset || (hasParts && slice.amount < 0),
    // One slice per row counts toward the headline transaction total,
    // however many categories it was carved into.
    countsAsTransaction: i === 0,
  }));
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
