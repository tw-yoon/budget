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
