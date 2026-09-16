/**
 * Display serials for transactions. Kept free of imports so `node:test` can
 * load it directly under Node's native type stripping.
 */

/** The serial that follows a given maximum. Pure, for testing without a database. */
export function nextLabelFrom(maxLabel: number | null): number {
  return (maxLabel ?? 0) + 1;
}
