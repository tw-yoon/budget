/**
 * Rewriting a stored category string when its parent category is renamed.
 *
 * A category is stored as text — either a bare name or `"Parent > Sub"` —
 * across Transaction.userCategory, CategoryRule.category, and
 * TransactionSplit.userCategory. Renaming has to rewrite the parent while
 * leaving the subcategory intact.
 *
 * Deliberately free of imports so `node:test` can load it directly under
 * Node's native type stripping.
 */

/** The separator between a category and its subcategory. */
const SEPARATOR = " > ";

/**
 * The value `value` should become when category `from` is renamed to `to`, or
 * null when it does not reference `from` at all.
 *
 * The separator is required for the prefix case, so renaming "Home" never
 * captures "Home Improvement".
 */
export function renameCategoryIn(
  value: string,
  from: string,
  to: string
): string | null {
  if (value === from) return to;
  const prefix = from + SEPARATOR;
  if (value.startsWith(prefix)) return to + SEPARATOR + value.slice(prefix.length);
  return null;
}
