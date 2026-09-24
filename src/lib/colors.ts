// Semantic cash-flow colors, shared across every analytics chart so the same
// concept reads the same everywhere.
export const INCOME_COLOR = "#22c55e"; // green  — money in
export const DRAW_COLOR = "#ef4444"; // red    — drawn from savings
export const SAVED_COLOR = "#3b82f6"; // blue   — saved (surplus)
export const HUB_COLOR = "#475569"; // slate  — monthly total / spent

// Spend-category hues: distinct colors that deliberately avoid the reserved
// green / red / blue so a category slice never reads as income or savings.
const SPEND_PALETTE = [
  "#6366f1", "#a855f7", "#ec4899", "#f97316", "#14b8a6",
  "#8b5cf6", "#eab308", "#06b6d4", "#db2777", "#0d9488",
  "#7c3aed", "#ca8a04", "#c084fc", "#64748b",
];
const OTHER_COLOR = "#94a3b8";

// Stable colors for the common humanized Plaid categories so the heavy hitters
// never collide within a single chart.
const FIXED: Record<string, string> = {
  "Food and Drink": "#6366f1",
  "General Merchandise": "#a855f7",
  Travel: "#ec4899",
  Transportation: "#f97316",
  "General Services": "#14b8a6",
  Entertainment: "#8b5cf6",
  "Government and Non Profit": "#eab308",
  Groceries: "#06b6d4",
  "Personal Care": "#db2777",
  Medical: "#0d9488",
  "Rent and Utilities": "#7c3aed",
  "Loan Payments": "#ca8a04",
  Dining: "#c084fc",
  "Home Improvement": "#0d9488",
};

/**
 * Deterministic category → color: the same category is always the same color
 * across the spending-by-category pie and the cash-flow Sankey. Known
 * categories use a fixed map; anything else is hashed into the palette.
 */
export function categoryColor(name: string): string {
  if (name === "Other" || name === "Other income") return OTHER_COLOR;
  if (FIXED[name]) return FIXED[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPEND_PALETTE[h % SPEND_PALETTE.length];
}

/**
 * Placeholder artwork for a credit card, until a real image is supplied.
 *
 * Pairs rather than single colours so the swatch reads as a card face with
 * some depth instead of a flat block. Issuers get their own family — the three
 * here are recognizable enough that a wrong-looking colour is worse than a
 * neutral one — and cards from the same issuer vary within it, so two Amex
 * cards are still told apart at a glance.
 */
const CARD_PALETTES: Record<string, [string, string][]> = {
  AMEX: [
    ["#4b6cb7", "#25355f"],
    ["#5b7fa6", "#2b3f52"],
    ["#8d99ae", "#434a55"],
  ],
  CHASE: [
    ["#1e4f8a", "#0f2747"],
    ["#2563eb", "#132f66"],
    ["#0f766e", "#0a3b37"],
  ],
  DISCOVER: [
    ["#e08a3c", "#7a451a"],
    ["#c2703a", "#5f3417"],
  ],
};
const CARD_FALLBACK: [string, string][] = [
  ["#3f3f46", "#18181b"],
  ["#475569", "#1e293b"],
  ["#57534e", "#1c1917"],
];

/**
 * Deterministic card → placeholder colours: the same card always looks the
 * same, across reloads and browsers, without storing anything.
 */
export function cardArtColors(issuer: string, seed: string): { from: string; to: string } {
  const family = CARD_PALETTES[issuer] ?? CARD_FALLBACK;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const [from, to] = family[h % family.length];
  return { from, to };
}
