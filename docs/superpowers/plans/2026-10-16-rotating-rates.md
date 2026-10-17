# Rotating Rates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner enters each calendar quarter's rotating bonus on the phone; earnings and Best Card count it only in its quarter up to its cap; the app prompts in-app to set up quarters and shows perks ending soon.

**Architecture:** Pure quarter/bonus math in `src/lib/rotating.ts`, wired into `computeEarnings` and both Best Card rankings. New `RotatingBonus` table with upsert/delete routes under `/api/user-cards/[id]/rotating/[year]/[quarter]`. iPhone gets models, a quarter form, card-page rows and a top-of-Cards prompt section.

**Tech Stack:** Next.js route handlers, Prisma (SQLite), `node:test`; SwiftUI (iOS 26, Swift 6), Swift Testing.

**Spec:** `docs/superpowers/specs/2026-10-16-rotating-rates-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing route code (AGENTS.md).
- iOS rules in `ios/CLAUDE.md`: never edit `project.pbxproj`; stubbed suites nest under `StubbedNetworkTests`; `do throws(APIError)` inside `Task {}`; every request body has a test asserting its JSON; native iOS Settings style, no blurbs.
- Never write to `the owner's prisma/dev.db (main checkout)`, never `prisma migrate dev`, never send the live server anything but GET. Verification against real data uses a scratch copy, prints counts only, and deletes the copy.
- Invented names only in code, fixtures, docs, commits (Sample Coffee, Example Bank).
- Migration additive only (ships via `migrate deploy`).
- Work only in the worktree `a dedicated worktree` (branch `rotating-rates`).
- Server: `npx tsc --noEmit -p .`, `npm run lint`, `npm test`. iOS (from `ios/`): `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`. Before commits: `bash scripts/test-scrub.sh`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A purchase matching both a category and a merchant** earns the bonus once, not twice. Test in Task 1.
2. **A purchase straddling the cap** splits: the fitting part at the bonus, the rest at its normal rate. Test in Task 1.
3. **Purchases just outside the quarter** (Sep 30 / Oct 1 local) never earn that quarter's bonus. Test in Task 1.
4. **A bonus lower than the card's normal category rate** never lowers earnings or Best Card. Tests in Tasks 1 and 3.
5. **The Set Up prompt** disappears once the current quarter is entered and activated, and never shows for cards without a rotating rate. Test in Task 5.

---

### Task 1: Quarter math and earnings (pure)

**Files:**
- Create: `src/lib/rotating.ts`
- Modify: `src/lib/earnings.ts`, `src/lib/rewards.ts`, `src/types/index.ts` (`EarningsCategoryDTO.key`)
- Create: `scripts/test-rotating.mjs`; Modify: `scripts/test-rewards.mjs` (fixtures gain `name`/`merchantName`), `package.json` (test list)

**Interfaces:**
- Produces (`src/lib/rotating.ts`):

```ts
export interface RotatingBonusInput {
  year: number; quarter: number; multiplier: number; unit: string;
  categories: string[]; merchants: string[]; cap: number | null; activated: boolean;
}
export function quarterOf(d: Date): { year: number; quarter: number }       // local time
export function quarterKey(year: number, quarter: number): string            // "2026-Q4"
export function quarterLabel(year: number, quarter: number): string          // "Q4 2026"
export function bonusMatches(b: RotatingBonusInput, rewardCategory: string, name: string, merchantName: string | null): boolean
export function bonusFor(bonuses: RotatingBonusInput[], d: Date): RotatingBonusInput | null
```
- `src/lib/rewards.ts`: `export function effectiveRateWithBonus(rates: SimpleRate[], category: string, bonus: RotatingBonusInput | null): { multiplier; unit; isBonus }` — returns the bonus rate when `bonus` covers `category` (categories only) and its dollar value per dollar is higher than the normal effective rate's; else `effectiveRate`. Compare in the same unit when units match; when units differ, compare `multiplier/100` for PERCENT vs `multiplier * 0.01` for X (1¢/point default, builder may pass pointValueCents if available).
- `computeEarnings(card, others, txns, start, end, bonuses: RotatingBonusInput[] = [])`: txn rows gain `name: string; merchantName: string | null`. Rows processed in date order; for each slice, if `bonusFor(date)` matches (`bonusMatches(slice reward category, row name, row merchant)`), up to the quarter's remaining cap (per quarter, null = unlimited) goes to a bonus bucket keyed `quarterKey`; the rest to the slice's normal category. Bonus bucket rate = higher of bonus and the normal category rate (the bucket earns per slice: `max`). Each bucket becomes a `byCategory` row: `category: "ROTATING"`, `key: "ROTATING-<quarterKey>"`, `categoryLabel: "<quarterLabel> bonus"`, `rate` the bonus rate, `isBonus: true`, `vsBest` vs others' effective rate on each slice's own category. All other rows gain `key = category`.

- [ ] **Step 1: Write failing tests** in `scripts/test-rotating.mjs`:
  - `quarterOf`: Mar 31 23:00 local → Q1; Apr 1 00:00 → Q2; Dec 31 → Q4.
  - `bonusMatches`: category match; merchant match case-insensitive on name; merchant match on merchantName; neither → false; empty merchant strings ignored.
  - earnings: card base 1% PERCENT, bonus Q4 2026 5% categories `["GAS"]` merchants `["Sample Mart"]` cap 1500: a $40 gas purchase Oct 3 → bonus row spend 40, earned 2.00; a $60 "SAMPLE MART #12" purchase (GROCERIES) Oct 4 → bonus; a $50 gas purchase Sep 30 → normal GAS row (no bonus).
  - `"a purchase matching category and merchant earns the bonus once"`: gas purchase at "Sample Mart" → bonus spend counted once.
  - `"the cap splits a purchase"`: prior bonus spend 1480, then $50 gas → 20 bonus + 30 normal GAS.
  - `"a lower bonus never lowers earnings"`: card has GAS 6%, bonus 5% on GAS → that slice earns 6%.
  - `"no cap means unlimited"`.
  - `effectiveRateWithBonus`: returns bonus for covered category when higher; normal when bonus lower; normal for uncovered category; merchants don't affect it.
  - Existing `test-rewards.mjs` still passes after fixtures gain name fields; existing rows have `key === category`.
- [ ] **Step 2: Run** `node --import ./scripts/resolve-alias.mjs --test scripts/test-rotating.mjs scripts/test-rewards.mjs` — FAIL.
- [ ] **Step 3: Implement.** Update the web earnings table (`src/components/benefits/UserCardItem.tsx` ~773) to key rows by `r.key`.
- [ ] **Step 4: Run** the tests, then `npm test`, `npx tsc --noEmit -p .` (the benefits.service call site may need `name`/`merchantName` passed; it already selects them) — PASS.
- [ ] **Step 5: Commit** `Rotating: quarter bonus math in earnings`.

### Task 2: Storage, API, web Best Card

**Files:**
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/20261016120000_rotating_bonus/migration.sql`
- Modify: `src/services/benefits.service.ts`, `src/types/index.ts`
- Create: `src/app/api/user-cards/[id]/rotating/[year]/[quarter]/route.ts` (PUT, DELETE)
- Create: `src/lib/rotating-body.ts` + tests in `scripts/test-rotating.mjs` (body validation, pure)
- Modify: `src/components/benefits/BestCards.tsx`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Schema `RotatingBonus` exactly as the spec's Data section, relation on `UserCard` (`rotatingBonuses RotatingBonus[]`, cascade), `@@unique([userCardId, year, quarter])`, `@@index([userCardId])`.
  - `RotatingBonusDTO { year: number; quarter: number; key: string; label: string; multiplier: number; unit: string; display: string /* "5%" */; categories: string[]; categoryLabels: string[]; merchants: string[]; cap: number | null; activated: boolean; current: boolean }`.
  - `UserCardDTO` gains `hasRotating: boolean` (has a `ROTATING` reward rate) and `rotating: RotatingBonusDTO[]` (last 8 quarters, newest first).
  - `benefits.service.ts` loads bonuses for all cards in one query, passes those overlapping the earnings window to `computeEarnings`.
  - `parseRotatingBody(body: unknown): { ok: true; value: {multiplier; unit; categories; merchants; cap; activated} } | { ok: false; error: string }` — rules from the spec's API section; allowed categories = `REWARD_CATEGORIES` minus `OTHER`, `ROTATING`.
  - Route: `PUT` body `{ multiplier, unit, categories, merchants, cap, activated }` (cap may be null) → upsert, `{ ok: true }`; 400 bad body or quarter outside 1–4 or year outside 2000–2100; 404 unknown card. `DELETE` → `{ ok: true }` (404 if none).
  - Web Best Card: ranks with `effectiveRateWithBonus(c.rewardRates, category, currentBonus(c))`, where the current bonus is the card's `rotating` entry with `current: true`.

- [ ] **Step 1: Failing tests** for `parseRotatingBody`: valid body passes and trims/dedupes merchants; `cap: null` ok; cap 0 → error; multiplier 0 → error; unit "Y" → error; category "OTHER" → error; missing `activated` → error.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** schema (migration via `prisma migrate diff --from-schema-datamodel <git show HEAD:prisma/schema.prisma in scratchpad> --to-schema-datamodel prisma/schema.prisma --script`; then `npx prisma generate`), service, types, route, Best Card.
- [ ] **Step 4: Verify:** tsc, lint, `npm test`. Then on a scratch copy of the owner's DB (`cp the owner's prisma/dev.db (main checkout) <scratchpad>`, `DATABASE_URL=file:<copy> npx prisma migrate deploy`), a scratch script calls `getUserCardsWithProgress()` and prints only: number of cards with `hasRotating`, and that every card has a `rotating` array. Delete the copy.
- [ ] **Step 5: Commit** `Rotating: store quarters, upsert route, Best Card counts the quarter`.

### Task 3: iPhone models, writes, Best Card

**Files:**
- Modify: `ios/BudgetPhone/Models/UserCardModels.swift`, `ios/BudgetPhone/Models/CardRequests.swift`, `ios/BudgetPhone/Networking/APIClient+Benefits.swift`, `ios/BudgetPhone/Benefits/BenefitsStore.swift`, `ios/BudgetPhone/Support/Rewards.swift`
- Modify tests: `ios/BudgetPhoneTests/Fixtures/user-cards.json`, `UserCardModelTests.swift`, `CardWritesTests.swift`, `RewardsTests.swift`

**Interfaces:**
- Consumes: Task 2 JSON.
- Produces:
  - `struct RotatingBonusDTO: Decodable, Equatable, Identifiable, Sendable` (fields as Task 2; `id` = `key`); `UserCardDTO.hasRotating` and `.rotating` decoded with `decodeIfPresent ?? false / []`; `EarningsCategoryDTO.key` decoded `decodeIfPresent ?? category`, and `id` = `key`.
  - `struct RotatingBonusBody: Encodable, Equatable, Sendable { multiplier: Double; unit: String; categories: [String]; merchants: [String]; excludeMerchants: [String]; cap: Double?; activated: Bool }` encoding `cap` as explicit `null` when nil.
  - `CardWrite` gains `.saveRotating(cardId: String, year: Int, quarter: Int, RotatingBonusBody)` and `.deleteRotating(cardId: String, year: Int, quarter: Int)`; `APIClient.saveRotating(...)` → `PUT api/user-cards/:id/rotating/:year/:quarter`, `deleteRotating(...)` → `DELETE` same path.
  - `Rewards.effectiveRate(_ card: UserCardDTO, _ category: String)` that applies the card's `rotating` entry with `current == true` (categories only, higher-of rule as Task 1); `bestByCategory` uses it.

- [ ] **Step 1: Failing tests:** route/method for both writes; body JSON with cap nil → `NSNull`, with cap 1500 → 1500, keys exactly the seven; fixture decodes a card with `hasRotating: true` and one current bonus; a response without those keys decodes; earnings row `id` uses `key`; Best Card: a card with base 1% and a current 5% GAS bonus ranks first for Gas over a 3% Gas card, and a 5% bonus doesn't beat a card's own 6%.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** iOS tests — PASS.
- [ ] **Step 5: Commit** `iPhone: rotating quarter models, writes and Best Card`.

### Task 4: iPhone quarter form and card-page rows

**Files:**
- Create: `ios/BudgetPhone/Benefits/RotatingSheets.swift` (quarter form, past quarters list)
- Modify: `ios/BudgetPhone/Benefits/CardDetailView.swift`, `ios/BudgetPhone/Support/CardRules.swift`, `ios/BudgetPhoneTests/CardRulesTests.swift`

**Interfaces:**
- Consumes: Task 3.
- Produces: `CardRules.rotatingSummary(_ b: RotatingBonusDTO?, year: Int, quarter: Int) -> String` (exact: `"Q4 2026 · 5% on Gas, Groceries, Sample Mart"`; nil → `"Q4 2026 · Not set up"`; joins category labels then merchants with ", "; when excludeMerchants is non-empty, append `" (not Sample Mart, Example Store)"`); `CardRules.currentQuarter(now: Date, calendar: Calendar) -> (year: Int, quarter: Int)`; `CardRules.newRotatingDefaults(_ card: UserCardDTO) -> RotatingBonusBody` (card's `ROTATING` rate multiplier/unit, else 5/PERCENT; cap 1500; activated false; empty lists).

Screens (copy exact):
- Card page Earning Rates section: when `card.hasRotating`, after the rates and before "Add Rate", a row with `rotatingSummary` for the current quarter (secondary "Not activated" suffix line when entered but not activated) opening the form; when any non-current entries exist, a "Past Quarters" row pushing a list of them (each row its summary; tap opens the form).
- Quarter form (sheet, title `"Q4 2026"`): Section rows "Rate" (decimal), "Unit" picker ("x points"/"% cash"), "Cap" (decimal, placeholder "No cap"); Section "Categories" — reward categories excluding Everything else and Rotating, each a row with a checkmark toggle; Section "Merchants" — text rows with delete swipe, plus "Add Merchant"; Section "Excluded Merchants" — same pattern, "Add Excluded Merchant"; Toggle "Activated"; toolbar Cancel/Save; "Delete Quarter" (destructive, only when it exists). Save disabled until rate > 0 and at least one category or merchant. Sends `.saveRotating` / `.deleteRotating`.

- [ ] **Step 1: Failing tests** for the three CardRules helpers (Q boundaries: Sep 30 → Q3, Oct 1 → Q4 in a fixed calendar; summary strings; defaults from a card with ROTATING 5% and from one without).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** iOS tests — PASS.
- [ ] **Step 5: Look at it** in the simulator against a worktree dev server on port 3100 backed by a migrated scratch copy (as in the previous feature's Task 6: copy DB, `migrate deploy`, `npx next dev -p 3100`, point the app at it, copy `data/` token files as needed; delete everything afterwards). Screenshots of the card page and the quarter form, saved in the scratchpad, never committed. Skip with a note if setup fights you.
- [ ] **Step 6: Commit** `iPhone: enter rotating quarters on the card page`.

### Task 5: In-app prompts on Benefits → Cards

**Files:**
- Modify: `ios/BudgetPhone/Benefits/CardsView.swift`, `ios/BudgetPhone/Support/CardRules.swift`, `ios/BudgetPhoneTests/CardRulesTests.swift`

**Interfaces:**
- Consumes: Task 3/4 helpers; `PerkReminders.windowEnd(period:now:calendar:)`.
- Produces:
  - `struct SetupPrompt: Equatable, Identifiable { let cardId: String; let title: String; let detail: String?; var id: String { cardId } }`; `CardRules.setupPrompts(_ cards: [UserCardDTO], now: Date, calendar: Calendar) -> [SetupPrompt]` — one per card with `hasRotating` whose current quarter is missing (`title "Set Up Q4 Categories"`, detail = card short label) or entered but not activated (`title "Activate Q4 Categories"`, detail = card short label).
  - `struct EndingSoon: Equatable, Identifiable { let cardId: String; let benefitId: String; let text: String; var id: String { benefitId } }`; `CardRules.endingSoon(_ cards: [UserCardDTO], now: Date, calendar: Calendar) -> [EndingSoon]` — perks with `autoMode != "perk"`, `amount > 0`, `cappedUsed < amount`, and window end within 7 days (end − now ≤ 7 days, end > now); text exact `"<name> · <$left> left · ends <MMM d>"` (end date = windowEnd − 1 day), sorted by end date then name.
- CardsView: a first section (above "To Review") listing setup prompts (tap → presents the quarter form for that card's current quarter) and ending-soon rows (tap → pushes `CreditRoute`); header none; shown only when non-empty.

- [ ] **Step 1: Failing tests:** card without rotating → no prompt; with rotating and no current entry → "Set Up Q4 Categories"; entered not activated → "Activate Q4 Categories"; entered and activated → none; ending soon: monthly $7 perk unused on Oct 26 → one row `"Coffee Credit · $7.00 left · ends Oct 31"`; same on Oct 20 → none; full perk → none; flat perk → none.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** iOS tests — PASS.
- [ ] **Step 5: Commit** `iPhone: in-app prompts for quarters and perks ending soon`.

### Task 6: Changelog, merge, migrate, rebuild

- [ ] **Step 1:** Add Unreleased entries: rotating quarters entered on the phone count in earnings and Best Card only in their quarter up to the cap; Benefits → Cards shows Set Up/Activate prompts and perks ending soon.
- [ ] **Step 2:** Full server and iOS suites, scrub.
- [ ] **Step 3:** Dry-run merge into main in `the main checkout` (must be on main and clean), then merge, delete branch and worktree.
- [ ] **Step 4:** Back up `prisma/dev.db` to `prisma/backups/pre-update-<timestamp>.db` with `sqlite3 .backup`, `npx prisma migrate deploy`, `npx prisma generate`, `bash Budget.command --no-open`; confirm `GET /api/user-cards` returns `rotating` on every card.
