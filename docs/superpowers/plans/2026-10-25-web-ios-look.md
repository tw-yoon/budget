# Web iPhone Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web app's terminal theme with the iPhone app's look, restyling every page in place.

**Architecture:** Task 1 swaps the design tokens and global CSS and adds a handful of shared utility classes; every later task restyles one area's components with only `className` edits that use those classes and tokens. A source-scan test guards against terminal leftovers.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching framework APIs), React 19, Tailwind v4, recharts, node:test.

**Spec:** `docs/superpowers/specs/2026-10-25-web-ios-look-design.md` (mockup: `docs/superpowers/specs/assets/2026-10-25-web-ios-look-mockup.html`, option A)

## Global Constraints

- Restyle in place: no moved sections, no copy changes, no added/removed features or controls. Only `className`/`style`/CSS and SVG icon markup change.
- No new dependencies. No iOS changes.
- Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`, base 14px; money uses `tabular-nums`.
- Tokens exactly as the spec's table (light / dark).
- Headings normal case, no letter-spacing, no `▪`.
- Never run `npm run build` in this checkout (the owner's app serves from `.next`). Per-task checks: `npx tsc --noEmit` and `npm run lint`.
- Never run `scripts/release.sh scan|publish`; never trigger syncs or edits against the real data.
- Commit each task on branch `web-ios-look`, ending messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Explicit theme choice disagreeing with the OS (user picked Light on a dark Mac): every `dark:` class must follow `data-theme`, not the OS — pinned in Task 1's test.
- Long merchant/category names and large amounts in the restyled ledger table must truncate or wrap, not overflow the rounded panel — checked in Task 4's screenshot step.
- Collapsed sidebar must still identify each section (icon + `title` tooltip) — Task 2.
- Focus rings: removing hard borders must not remove visible keyboard focus on inputs/buttons — `.field`/`.btn` define `focus-visible` rings (Task 1).
- Error/overdue/destructive states keep a red signal after chips lose their colored boxes — each area task maps `red-*` to `text-neg`, never to muted.

---

### Task 1: Tokens, global CSS, shared classes, leftover guard

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/lib/colors.ts:3-6` (semantic colors only)
- Create: `scripts/test-look.mjs`; add it to the `test` script in `package.json`

**Interfaces — Produces** (later tasks use only these):
- Tailwind colors: `bg-background`, `bg-panel`, `bg-panel2`, `border-line`, `text-foreground`, `text-muted2`, `text-dim2`, `bg-accent`/`text-accent`, `text-accent-contrast`, plus new `text-pos`/`bg-pos` (green), `text-neg`/`bg-neg` (red), `text-warn`/`bg-warn` (orange).
- `dark:` variant that follows `data-theme` first, the OS otherwise.
- Utility classes (Tailwind v4 `@utility`):
  - `group-panel` — `bg-panel`, radius 12px, overflow hidden, no border.
  - `group-row` — padding 10px 14px; hairline top separator (`--border`) between consecutive rows, inset 14px from the left.
  - `btn` — radius 8px, padding 6px 12px, 14px medium, `bg-panel2` fill, `text-accent`; `btn-primary` — `bg-accent text-accent-contrast`; both with a 2px accent `focus-visible` ring and 50% opacity when disabled.
  - `field` — radius 8px, `bg-panel2`, no border, padding 6px 10px, accent `focus-visible` ring (inputs/selects/textareas).
  - `chip` — 11px, `text-muted2`, `bg-panel2`, radius 6px, padding 1px 6px, normal case.
  - `section-caption` — 13px `text-muted2`, normal case (for small labels that were uppercase).

- [ ] **Step 1: Write `scripts/test-look.mjs`** (node:test, reads files with `readFileSync`)
  - `globals.css has no terminal rules`: CSS does not match `/border-radius:\s*0\s*!important/`, `/monospace/` in the `html, body` block, `/text-transform:\s*uppercase/`, `/content:\s*"▪/`, `/@keyframes blink/`.
  - `dark variant follows the explicit choice`: CSS matches `/@custom-variant dark/` and contains `[data-theme="dark"]` and `:not([data-theme="light"])` inside that block.
  - `tokens match the spec`: light `:root` has `--accent: #007aff`, `--bg: #f2f2f7`, `--panel: #ffffff`; the `[data-theme="dark"]` block has `--accent: #0a84ff`, `--bg: #000000`, `--panel: #1c1c1e`.
  - `no terminal leftovers in components` — **marked `{ todo: true }` until Task 9**: no `.tsx` under `src/` (excluding `src/app/api`) contains the class tokens `uppercase`, `tracking-wide`, `tracking-wider`, `tracking-widest`, `tracking-[`, `font-mono`, the glyph `▪`, or `className="blink"`.
- [ ] **Step 2:** Run `node --import ./scripts/resolve-alias.mjs --test scripts/test-look.mjs` — expect the first three FAIL.
- [ ] **Step 3: Rewrite `globals.css`** to the spec's tokens (keep the two identical dark blocks so `test-theme.mjs` passes, keep the `@theme inline` mapping and add `--color-pos/neg/warn`), system font stack, heading sizes from the spec, the `@custom-variant dark`, and the utilities above. Delete the forced-radius/shadow rule, uppercase headings, `▪`, and `blink`. Keep `::selection` (accent) and the calendar-picker rule.
- [ ] **Step 4: `colors.ts`:** `INCOME_COLOR = "#34c759"`, `DRAW_COLOR = "#ff3b30"`, `SAVED_COLOR = "#5856d6"` (system indigo, so it doesn't read as the accent), `HUB_COLOR = "#8e8e93"`. Remove `#6366f1`/`#7c3aed` indigo-ish entries from `SPEND_PALETTE`/`FIXED` only if they collide with indigo — replace with system teal `#30b0c7` / pink `#ff2d55`. Card art palettes untouched.
- [ ] **Step 5:** Run the test file — first three PASS, the todo stays todo. Run `node --import ./scripts/resolve-alias.mjs --test scripts/test-theme.mjs`, `npx tsc --noEmit`, `npm run lint` — all pass.
- [ ] **Step 6:** Commit `Look: iPhone tokens, system font, shared classes`.

### Task 2: Sidebar

**Files:** Modify `src/components/SideNav.tsx`
**Consumes:** Task 1 classes/tokens.

- [ ] **Step 1:** Replace each item's `code` with an inline SVG line icon (16px, `stroke="currentColor"`, 1.5 stroke; house-bank, list, pie, card, repeat-arrows, dollar, gear — builder's drawing). Keep the `code` field removed from the type; collapsed mode renders the icon with `title={label}` and `aria-label`.
- [ ] **Step 2:** Restyle: sidebar `bg-panel2` with a right hairline `border-line`; header "Budget" 15px semibold (drop the `_` blink span — same word, no cursor); rows 6px 8px padding, radius 7px, icon + label; active row `bg-accent text-accent-contrast`; children indented as now, same active treatment; version footer 11px `text-dim2`.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` pass. Commit `Look: Mac-style sidebar`.

### Tasks 3–8: Restyle each area in place

Same recipe for every task; the files differ.

**Recipe (each component in the task):**
1. Outer bordered boxes (`border border-black/10 dark:border-white/10` panels) → `group-panel`; repeated row markup inside → `group-row`; drop now-redundant borders.
2. Buttons → `btn` / `btn-primary` (primary = the one main action per panel, e.g. Save, Sync, Add); destructive buttons → `btn text-neg`.
3. Inputs/selects/textareas → `field`.
4. Colored tag boxes (PENDING, VENMO, CUSTOM, Pro, status labels…) → `chip`, same text; keep red meaning as `text-neg`, positive money as `text-pos`, warnings as `text-warn`.
5. Remove `uppercase`, `tracking-*`, `font-mono`; small uppercase labels → `section-caption`; numbers keep/receive `tabular-nums`.
6. Hardcoded palette colors (`green-*`, `red-*`, `amber-*`, `emerald-*`, `bg-black`/`bg-white` panels) → the matching token. `text-black/50 dark:text-white/50`-style muted text may stay or become `text-muted2`.
7. Tables: inside `group-panel`; header row `section-caption` normal case with bottom hairline; body rows hairline separators, no vertical rules.

**Each task's steps:**
- [ ] Apply the recipe to the listed files.
- [ ] `npx tsc --noEmit && npm run lint` pass; `grep -nE "uppercase|tracking-|font-mono|▪" <files>` prints nothing.
- [ ] Commit `Look: <area>`.

**Task 3 — Accounts:** `src/app/accounts/page.tsx`, `AccountsDashboard.tsx`, `AccountCard.tsx`, `NetWorthCard.tsx`, `SummaryCards.tsx`, `RefreshBalancesButton.tsx`, `SyncButton.tsx`, `PlaidLink.tsx`, `src/app/page.tsx`.

**Task 4 — Transactions:** `TransactionLedger.tsx`, `TransactionTable.tsx` (keep it a table; `#`/date/description/account/amount columns stay; description cell truncates with `truncate` + `title`), `TransactionLinkPicker.tsx`, `P2pCategorizer.tsx`, `src/app/transactions/**`, `src/app/venmo/page.tsx`, `src/app/zelle/page.tsx`.

**Task 5 — Analytics:** `AnalyticsDashboard.tsx`, `CategoryMap.tsx`, `ProOnly.tsx`, `src/components/charts/*` (recharts: grid stroke `var(--grid)`, axis tick fill `var(--muted)`, tooltip `group-panel`-styled with system font; series colors from `colors.ts`), `src/app/analytics/page.tsx`, `src/app/settings/analytics/page.tsx`.

**Task 6 — Benefits:** everything in `src/components/benefits/`, `src/app/benefits/**`. Card art (`CardArt.tsx`) keeps its gradients; its frame gets radius 10px.

**Task 7 — Subscriptions & Income:** `SubscriptionsDashboard.tsx`, `src/app/subscriptions/page.tsx`, `src/app/income/page.tsx` (largest file; restyle only).

**Task 8 — Settings & sign-in:** `SettingsCategories.tsx`, `RulesDashboard.tsx`, `src/app/rules/page.tsx`, `SettingsConnections.tsx`, `ConnectedBanks.tsx`, `MergeReview.tsx`, `DebitCards.tsx`, `SettingsAccess.tsx`, `SettingsMode.tsx`, `SettingsUpdates.tsx`, `SignInForm.tsx`, `src/app/settings/**`, `src/app/signin/page.tsx`.

### Task 9: Turn on the leftover guard

**Files:** Modify `scripts/test-look.mjs`

- [ ] **Step 1:** Remove `{ todo: true }` from `no terminal leftovers in components`.
- [ ] **Step 2:** Run it; fix any file it names with the Task 3–8 recipe until it passes.
- [ ] **Step 3:** `npm test` passes (full suite incl. lint).
- [ ] **Step 4:** Commit `Look: guard against terminal leftovers`.

### Task 10 (controller): Visual check

- [ ] Start `budget-dev` (port 3001) via preview_start; for every route in the spec's "Done looks like", screenshot light and dark (`resize_window colorScheme`) and with the explicit theme toggle set opposite to the OS once. Fix leftovers, overflow, lost focus rings or lost red states found. Read-only: click no sync/save/delete.
