/**
 * Refund links: connecting a money-in transaction to the purchase it offsets.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. Formatting and database access belong to the callers.
 *
 * Plaid sign convention throughout: amount > 0 is money out (a purchase),
 * amount < 0 is money in (a refund, payback, or income).
 */

export interface LinkSide {
  id: string;
  amount: number;
  linkedToId: string | null;
}

/**
 * Why a proposed refund-to-purchase link is invalid, or null if it is fine.
 * Chains are refused so a category never has to be resolved through more than
 * one hop.
 */
export function validateLink(refund: LinkSide, target: LinkSide): string | null {
  if (refund.id === target.id) return "A transaction cannot be linked to itself";
  if (refund.amount >= 0) return "Only a money-in transaction can be linked to a purchase";
  if (target.amount <= 0) return "A refund can only be linked to a purchase (money out)";
  if (target.linkedToId !== null) return "That transaction is itself linked to another purchase";
  return null;
}

export interface ResolvableRow {
  amount: number;
  userCategory: string | null;
  /** The linked purchase's already-resolved, already-humanized category. */
  linkedToCategory: string | null;
}

export interface ResolvedCategory {
  /** Effective raw category, possibly "Parent > Sub". Null means uncategorized. */
  raw: string | null;
  /**
   * True when this is money-in that should net against its category rather than
   * count as income — a refund, or a payback for something you bought.
   */
  isOffset: boolean;
}

/**
 * A row's effective category. Its own category wins; otherwise it inherits
 * from the purchase it is linked to. Deriving rather than copying means the
 * inherited category cannot go stale, and that linking a refund before
 * categorizing the purchase works exactly as well as the other order.
 */
export function resolveLinkedCategory(row: ResolvableRow): ResolvedCategory {
  const raw = row.userCategory ?? row.linkedToCategory ?? null;
  return { raw, isOffset: row.amount < 0 && raw !== null };
}

export interface RefundRow {
  date: Date;
  amount: number; // negative
  name: string;
  merchantName: string | null;
  counterparty: string | null;
}

export interface CandidateRow {
  id: string;
  label: number | null;
  date: Date;
  name: string;
  merchantName: string | null;
  counterparty: string | null;
  amount: number; // positive
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;
const CENT = 0.005;

// Words too common to mean two descriptions are about the same thing.
const STOPWORDS = new Set([
  "the", "and", "for", "from", "payment", "purchase", "refund", "return",
  "inc", "llc", "com", "online", "store", "card", "pos",
]);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function party(r: { merchantName: string | null; counterparty: string | null }): string {
  return (r.counterparty ?? r.merchantName ?? "").trim().toLowerCase();
}

/**
 * How likely `c` is the purchase behind `refund` — higher is better, negative
 * means "not a candidate at all".
 *
 * Signals, in descending weight: the same merchant or person (+3), a shared
 * distinctive word in the description (+2), a purchase large enough to cover
 * the refund (+2), and recency decaying across the window (0 to 2).
 *
 * On a Venmo or Zelle payback the counterparty is a person, so the party
 * signal rarely fires against a card purchase — recency and amount carry it.
 */
export function scoreCandidate(refund: RefundRow, c: CandidateRow): number {
  const days = (refund.date.getTime() - c.date.getTime()) / DAY_MS;
  if (days < 0 || days > WINDOW_DAYS) return -1;

  let score = ((WINDOW_DAYS - days) / WINDOW_DAYS) * 2;

  const p = party(refund);
  if (p.length > 0 && p === party(c)) score += 3;

  const refundWords = words(refund.name);
  for (const w of words(c.name)) {
    if (refundWords.has(w)) {
      score += 2;
      break;
    }
  }

  if (Math.abs(refund.amount) <= c.amount + CENT) score += 2;

  return score;
}

/** The best candidate purchases for a refund, best first. */
export function rankCandidates(
  refund: RefundRow,
  rows: CandidateRow[],
  limit = 5
): CandidateRow[] {
  return rows
    .map((c) => ({ c, score: scoreCandidate(refund, c) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || b.c.date.getTime() - a.c.date.getTime())
    .slice(0, limit)
    .map((x) => x.c);
}
