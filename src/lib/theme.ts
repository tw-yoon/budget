/**
 * Light, dark, or whatever the operating system says.
 *
 * The choice rides on the shared ui-state store like every other preference,
 * so it follows you between browsers. "system" is the absence of a choice: it
 * stores nothing to override, and the CSS falls through to
 * prefers-color-scheme.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. The same constraint governs `src/lib/pro-mode.ts`.
 */

export type Theme = "light" | "dark" | "system";

/** The key this preference occupies in the shared ui-state store. */
export const THEME_KEY = "theme";

/**
 * Turn whatever the store holds into a theme. The store is a plain JSON file a
 * user can edit and is shared across app versions, so anything that is not a
 * recognized choice resolves to "system" rather than throwing.
 */
export function resolveTheme(stored: unknown): Theme {
  return stored === "light" || stored === "dark" ? stored : "system";
}

/**
 * What `<html data-theme>` should be, or null to leave it off and let the OS
 * decide. globals.css keys its palettes off exactly this attribute.
 */
export function themeAttribute(theme: Theme): "light" | "dark" | null {
  return theme === "system" ? null : theme;
}
