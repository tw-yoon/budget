/**
 * How much of the Analytics page to show.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. The same constraint governs `src/lib/links.ts`,
 * `src/lib/plaid-errors.ts` and `src/lib/category-rename.ts`.
 */

export type AnalyticsMode = "normal" | "pro";

/** The key this preference occupies in the shared ui-state store. */
export const ANALYTICS_MODE_KEY = "analytics-mode";

/**
 * Turn whatever the store holds into a mode.
 *
 * The store is shared across browsers and app versions and is a plain JSON
 * file a user can edit, so the stored value can be anything at all. Everything
 * that is not exactly "pro" resolves to Normal rather than throwing: a corrupt
 * preference must not take the Analytics page down with it.
 */
export function resolveAnalyticsMode(stored: unknown): AnalyticsMode {
  return stored === "pro" ? "pro" : "normal";
}
