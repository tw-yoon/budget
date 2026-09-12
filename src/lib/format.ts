const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCurrency(amount: number): string {
  return usd.format(amount);
}

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// e.g. "$1.2K" — for chart axes where space is tight
export function formatCompactCurrency(amount: number): string {
  return usdCompact.format(amount);
}

/**
 * Plaid convention: a positive `amount` means money LEFT the account (an
 * outflow / debit); a negative `amount` means money came IN (an inflow /
 * credit). For a human-readable ledger we flip the sign so spending shows
 * negative/red and income shows positive/green.
 */
export function formatSignedAmount(amount: number): {
  text: string;
  isOutflow: boolean;
} {
  const isOutflow = amount > 0;
  const display = -amount; // flip to natural ledger sign
  const sign = display > 0 ? "+" : ""; // negatives already carry their own "-"
  return { text: `${sign}${usd.format(display)}`, isOutflow };
}

// Plaid PFC enum → human label, e.g. "FOOD_AND_DRINK" → "Food and Drink"
const LOWERCASE_WORDS = new Set(["and", "or", "of", "the", "to"]);

export function humanizePfc(pfc: string): string {
  return pfc
    .toLowerCase()
    .split("_")
    .map((word, i) =>
      i > 0 && LOWERCASE_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// e.g. "just now", "4m ago", "3h ago", "2d ago"
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// Whole days from now until the given ISO date (negative = in the past).
export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

// Next calendar occurrence (today or later) of a given day-of-month, as ISO.
// Used for manually-entered recurring due dates so they never go stale.
export function nextMonthlyOccurrence(day: number): string {
  const now = new Date();
  const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  let y = now.getFullYear();
  let m = now.getMonth();
  // If this month's occurrence already passed, roll to next month.
  if (now.getDate() > Math.min(day, lastDay(y, m))) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  const d = Math.min(day, lastDay(y, m));
  return new Date(y, m, d, 12, 0, 0).toISOString(); // noon → TZ-safe
}

// Balances older than this are considered stale and flagged in the UI.
export const STALE_THRESHOLD_MIN = 60;

export function isStale(iso: string, thresholdMin = STALE_THRESHOLD_MIN): boolean {
  return Date.now() - new Date(iso).getTime() > thresholdMin * 60_000;
}
