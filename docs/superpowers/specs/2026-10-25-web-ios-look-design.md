# Web app: iPhone look — design

## Why

The web app wears a "terminal" theme: one monospace face, uppercase
`▪ HEADERS` with letter-spacing, square corners forced by
`border-radius: 0 !important`, neon green on near-black, a blinking `_`
cursor, three-letter nav codes, and colored tag chips on most rows. The
owner says every page "feels too much vibe coded". The iPhone app — now the
main client — looks like a native iOS app and is the look they want here.

## Goal

Restyle every web page to the iPhone app's visual language, **in place**:
same pages, same content, same copy, same controls, same order. Only how
things look changes.

## Decided by the owner

- The terminal theme goes entirely.
- App frame: a Mac-style sidebar on the left, like Mail or System Settings
  (option A from the mockups), not tabs across the top.
- Restyle in place — do not rearrange pages to match their iPhone screens.

## Non-goals

- No layout restructuring, no moving sections, no new or removed features.
- No copy changes (blurbs, labels and nav names stay; the nav keeps
  "Transactions", not the phone's "Activity").
- No iOS app changes. No new dependencies.

## Anti-goals (a failure even if it "works")

- Any terminal leftover visible anywhere: monospace UI text, uppercase
  letter-spaced headings, `▪`, blinking cursor, three-letter codes, square
  hard-bordered boxes, neon green.
- Dark mode or the light/dark/system toggle breaking on any page.
- The Transactions ledger losing density — it's a desktop ledger and stays
  a table.

## Visual language

Use Apple's system colors as CSS tokens in `src/app/globals.css`, keeping
the existing token mechanism (`:root`, the two dark blocks that
`scripts/test-theme.mjs` requires to match, `@theme inline`):

| token | light | dark |
|---|---|---|
| bg (grouped background) | `#f2f2f7` | `#000000` |
| panel (grouped cell) | `#ffffff` | `#1c1c1e` |
| panel2 (secondary fill, inputs, sidebar) | `#e9e9ee` | `#2c2c2e` |
| border (separator) | `#c6c6c8` | `#38383a` |
| grid (chart grid / hairlines) | `#e5e5ea` | `#2c2c2e` |
| text | `#000000` | `#ffffff` |
| muted (secondary label) | `#6c6c70` | `#98989f` |
| dim (tertiary) | `#aeaeb2` | `#636366` |
| accent (system blue) | `#007aff` | `#0a84ff` |
| accent-contrast | `#ffffff` | `#ffffff` |
| green | `#34c759` | `#30d158` |
| red | `#ff3b30` | `#ff453a` |
| amber (system orange) | `#ff9500` | `#ff9f0a` |

Builder may nudge values for contrast; keep them Apple's.

- **Font:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui,
  sans-serif`, base 14px. Money and other numbers use
  `font-variant-numeric: tabular-nums`. Monospace only where a value is
  truly code-like (none expected).
- **Headings:** normal case, no letter-spacing, no `▪`. h1 = large page
  title (~26–28px bold). h2 = section title (~17px semibold). h3 = small
  gray caption (~13px, muted).
- **Surfaces:** content groups are rounded (10–12px) `panel` cells on the
  `bg` background, no outer border, inset hairline separators between rows.
  Remove the global `border-radius: 0 / box-shadow: none !important` rule.
- **Tag chips** (PENDING, VENMO, CUSTOM, …): keep the words, drop the
  colored boxes — render as small muted text (or a quiet gray pill). Status
  colors only where meaning needs it (red for errors/overdue, green for
  money in).
- **Buttons:** rounded. Primary = filled accent; secondary = gray fill or
  plain accent-colored text, like iOS.
- **Inputs/selects:** rounded, `panel2` fill, no hard border; checkboxes may
  stay native.
- **Charts:** recolor to the system palette (blue, green, orange, red,
  purple, teal, …), soft gridlines, system font labels.
- **Tables** (Transactions, etc.): inside a rounded panel, hairline row
  separators, no vertical rules, muted small column headers in normal case.

## The sidebar (`src/components/SideNav.tsx`)

Mac source-list look: `panel2`-ish background, app name "Budget" at top in
the system font (no `_` cursor), rows with a simple line icon + label,
selected row = filled accent with white text (rounded), children indented
under their parent the same way they are now. Collapsed mode shows the
icons instead of three-letter codes. Same entries, order, Pro filtering,
collapse behaviour and version footer (small, muted). Icons: inline SVG or
plain glyphs, no new dependency — builder's choice.

## Constraints

- Next.js in this repo differs from common knowledge: read
  `node_modules/next/dist/docs/` before touching framework APIs (this work
  should be almost entirely CSS/className).
- Tailwind v4. Components lean on `text-black/50 dark:text-white/50` pairs
  and `border-black/10 dark:border-white/10`. Today `dark:` only follows the
  OS, so an explicit theme choice that disagrees with the OS mismatches.
  Add a `@custom-variant dark` that matches the explicit `data-theme="dark"`
  and the OS-dark-without-`data-theme="light"` case, so every page follows
  the toggle.
- Work on a branch, merge back to main after a dry-run merge (other sessions
  land on main). Keep `scripts/test-theme.mjs` and the rest of the test
  suite green and `npm run build` passing.
- After merge, the owner's Mac app is rebuilt with
  `bash Budget.command --no-open`.

## Calls made by the designer (not the owner)

- **Mockup:** `docs/superpowers/specs/assets/2026-10-25-web-ios-look-mockup.html`
  (option A is the reference for the sidebar and row look; its "Activity"
  label and day-grouped rows are illustration only — content stays as is).
- **Chart colors (`src/lib/colors.ts`):** keep every meaning and the
  category→color mapping; swap each hex for the nearest Apple system color.
  Income stays green, drawn-from-savings red; saved moves from blue to
  system teal/indigo so it doesn't read as the accent. Category palette keeps
  avoiding those hues.
- **Verification data:** screenshot against the owner's existing local data
  through the dev server, read-only — no syncs, no edits, never
  `release.sh scan/publish`. Pro-only pages are checked as they render in the
  current mode (don't flip the shared Pro setting).
- **Release:** merge to main + Mac rebuild only. A public release is a
  separate step when the owner asks.
- Hardcoded Tailwind colors (`text-green-400`, `bg-amber-500`, …) are in
  scope: map each to the matching token.

## Left to the builder

- Order of pages, exact spacing/sizes, icon glyphs, chart color order.
- Whether to swap repeated class strings for a few shared utility classes
  in `globals.css`.

## Done looks like

Every route (accounts, transactions + venmo/zelle, analytics, benefits
cards/best/flights, subscriptions, income, settings/* , signin) screenshotted
in light and dark with none of the anti-goal leftovers, the theme toggle
working on each, tests and build passing.
