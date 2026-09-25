/**
 * Where the numbers come from. Shown on the pages that present earning rates —
 * the card list, which is where they are edited, and the ranking built from
 * them — so neither is read as something the issuer told us.
 */
export function RatesNote() {
  return (
    <div className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      Earning rates are pre-filled from a <strong>~2025 snapshot</strong> and
      statement credits are whatever you enter — always verify current terms
      with your issuer. Credit progress is <strong>estimated</strong> from
      matched transactions on linked cards.
    </div>
  );
}
