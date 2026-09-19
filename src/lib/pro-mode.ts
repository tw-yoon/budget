/**
 * How much of the app to show.
 *
 * Normal is the everyday view. Pro adds the dense, interactive extras: the
 * cash-flow diagram and cumulative spending graph on Analytics, and payment
 * splitting in the ledger. It gates controls and views, never data — a split
 * recorded in Pro still counts toward every total in Normal, because a display
 * preference must not be able to move a financial figure.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. The same constraint governs `src/lib/links.ts`, `src/lib/labels.ts`
 * and `src/lib/splits.ts`.
 */

export type ProMode = "normal" | "pro";

/** The key this preference occupies in the shared ui-state store. */
export const PRO_MODE_KEY = "pro-mode";

/**
 * Where it lived while Pro was an Analytics-only setting. Read as a fallback
 * so an existing choice survives the rename, and left in place rather than
 * deleted: it is a few bytes in a JSON file, and removing it would break any
 * older build still pointed at the same store.
 */
export const LEGACY_ANALYTICS_MODE_KEY = "analytics-mode";

/**
 * Turn whatever the store holds into a mode.
 *
 * The store is shared across browsers and app versions and is a plain JSON
 * file a user can edit, so the stored value can be anything at all. Everything
 * that is not exactly "pro" resolves to Normal rather than throwing: a corrupt
 * preference must not take a page down with it.
 */
export function resolveProMode(stored: unknown): ProMode {
  return stored === "pro" ? "pro" : "normal";
}
