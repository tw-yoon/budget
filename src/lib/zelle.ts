/**
 * Zelle helpers. Unlike Venmo, Zelle isn't a separate account with a CSV — it
 * rides on the bank's own feed, so Zelle payments already arrive through Plaid
 * as individual transactions (source=PLAID, flagged isTransfer). The counterparty
 * is embedded in the description, which each bank words its own way:
 *   U.S. Bank  "Zelle Instant Pmt To Jane Doe Usb…", "Ref Zelle Standard Pmt From …"
 *   Chase      "Zelle payment to Jane Doe JPM99…"
 *
 * We don't import anything; we just parse + categorize the rows already present.
 */

// Categories a Zelle row can be tagged with. "Uncategorized" maps to null
// (stays ignored, like an untouched transfer); "Transfer" is an explicit ignore.
export const ZELLE_CATEGORIES = [
  "Uncategorized",
  "Dining",
  "Groceries",
  "Travel",
  "Entertainment",
  "Housing",
  "Shopping",
  "Reimbursement",
  "Transfer",
] as const;

// Matches real Zelle payment descriptions from the banks above ("…Pmt To …",
// "Zelle payment to …") but not incidental mentions like a memo that happens
// to say "zelle".
const ZELLE_NAME = /^(ref\s+)?zelle\b.*\b(pmt|payment)\b/i;

export function isZelleName(name: string): boolean {
  return ZELLE_NAME.test(name);
}

/** True for transactions that are P2P (Venmo import or native Zelle). */
export function isP2p(source: string, name: string): boolean {
  return source === "VENMO" || isZelleName(name);
}

/**
 * Pull the counterparty out of a Zelle description. Drops the trailing bank
 * reference token (e.g. "Usb0wbt…", "JPM99…" or a date code) so we keep just
 * the name.
 */
export function parseZelleCounterparty(name: string): string {
  const m = name.match(/\b(?:pmt|payment)\s+(?:to|from)\s+(.+)$/i);
  if (!m) return "Zelle";
  const words = m[1].trim().split(/\s+/);
  // Trim trailing reference tokens: anything containing a digit, or the
  // "Usb…" bank ref suffix.
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (/\d/.test(last) || /^usb/i.test(last)) words.pop();
    else break;
  }
  return words.join(" ") || "Zelle";
}
