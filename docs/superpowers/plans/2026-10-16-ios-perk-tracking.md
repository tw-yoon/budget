# Perk Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Statement-credit perks fill themselves from real transactions, show the credit and the purchase behind each, ask about credits they can't place, and remind the owner a week before an unused perk lapses.

**Architecture:** Pure placement and pairing rules live in `src/lib/perk-credits.ts` (tested with `node --test`). A new `src/services/perk-credits.service.ts` loads rows, runs placement for `benefits.service.ts` (on read) and writes automatic pairings (after sync and after each answer). New `/api/perk-credits/**` routes take the owner's answers. The iPhone app decodes the new fields, adds a review list, a per-credit transaction list and local reminders.

**Tech Stack:** Next.js route handlers, Prisma (SQLite), `node:test`; SwiftUI (iOS 26, Swift 6), Swift Testing, `UNUserNotificationCenter`.

**Spec:** `docs/superpowers/specs/2026-10-16-ios-perk-tracking-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing route code (AGENTS.md: this Next.js has breaking changes).
- iOS rules in `ios/CLAUDE.md` apply: never edit `project.pbxproj` (new files under `BudgetPhone/` / `BudgetPhoneTests/` join automatically); stubbed suites nest under `StubbedNetworkTests`; `do throws(APIError)` inside `Task {}`; every request body has a test asserting its JSON.
- The live server and `prisma/dev.db` hold real money data. Never run `prisma migrate dev`, never write to `dev.db`, never send the server anything but GET. Fixtures, code, comments and commits use invented names only (Sample Coffee, Example Bank, Sample Rewards Card).
- Migrations ship to friends' installs via `prisma migrate deploy`: every new column has a default or is nullable; no data step.
- Before each commit: `bash scripts/test-scrub.sh`. Work on a branch; merge to main at the end.
- Server tests: `node --import ./scripts/resolve-alias.mjs --test scripts/test-perk-credits.mjs`; full suite `npm test`. iOS tests: from `ios/`, `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`.
- Phone UI follows iOS Settings patterns (no explanatory blurbs beyond the copy below).

## Review Focus

1. **Two perks on one card share a keyword** (e.g. both match "credit"): the row must become a question, never count twice. Test in Task 1.
2. **A merchant refund after the window is already full** (a second +$7.00 in a month): question with `windowFull: true`, not silently added. Test in Task 1.
3. **Old rows** (older than 90 days): never questions, never auto-paired, but still count toward their windows via keywords. Tests in Tasks 1 and 2.
4. **Card payments, pending rows and fees** must never be credit candidates, even when Plaid tags them oddly. Test in Task 1.
5. **Reminders for a perk that is already full, a flat-value perk, or a window already reminded**: none scheduled; inside the last week a reminder fires once, not on every launch. Tests in Task 7.

---

### Task 1: Placement rules (pure)

**Files:**
- Create: `src/lib/perk-credits.ts`
- Create: `scripts/test-perk-credits.mjs`
- Modify: `package.json` (add `scripts/test-perk-credits.mjs` to the `node --test` list in `"test"`)

**Interfaces:**
- Produces (all exported from `src/lib/perk-credits.ts`, no imports so `node --test` loads it directly, like `src/lib/links.ts`):

```ts
export interface CreditRow {
  id: string; accountId: string; date: Date; amount: number; // < 0
  name: string; merchantName: string | null; pfcDetailed: string | null;
  pending: boolean; isFee: boolean;
  decision: "YES" | "NO" | null; // owner's answer
  benefitId: string | null;      // YES: the perk; NO: the perk refused (null = not a perk at all)
}
export interface PerkInput {
  id: string; accountId: string; amount: number; period: string; keywords: string[];
}
export interface Placed { benefitId: string; how: "auto" | "confirmed"; windowKey: string }
export interface PerkQuestion { transactionId: string; suggestedBenefitId: string | null; windowFull: boolean }
export interface Placement { placed: Map<string, Placed>; questions: PerkQuestion[] }

export function isCreditCandidate(r: Pick<CreditRow, "amount" | "pending" | "isFee" | "pfcDetailed">): boolean
export function placeCredits(
  perks: PerkInput[], rows: CreditRow[],
  windowKey: (period: string, date: Date) => string,
  askSince: Date,
): Placement
export function learnKeyword(r: Pick<CreditRow, "name" | "merchantName">): string
```

Rules `placeCredits` implements, rows in date order, keeping a running sum per perk per window:
1. `YES` with a `benefitId` of a known perk → `confirmed`, added to the sum even past the cap.
2. `NO` with `benefitId === null` → skipped entirely.
3. Eligible perks = perks on the row's `accountId`, minus the one this row refused (`NO` + that `benefitId`). Keyword match = a lower-cased keyword contained in lower-cased `name` or `merchantName`.
4. Exactly one keyword match and that perk's window sum `< amount` → `auto`.
5. Otherwise, if `date >= askSince` and the row looks like a credit (name contains "credit", case-insensitive; or `-amount` equals an eligible perk's `amount` within 0.005; or any keyword match) → question. Suggested: the single keyword match; else the first keyword match when several; else the first equal-amount perk; else null. `windowFull` = the suggested perk matched by keyword and its window was full.
6. Anything else: nothing.

`isCreditCandidate`: `amount < 0 && !pending && !isFee && !(pfcDetailed ?? "").endsWith("CREDIT_CARD_PAYMENT") && !(pfcDetailed ?? "").startsWith("LOAN_DISBURSEMENTS")`.

`learnKeyword`: trimmed `merchantName` when non-empty; else `name` with a leading issuer word (`AMEX`, `CHASE`, `DISCOVER`, case-insensitive) removed and trailing tokens containing a digit removed, then trimmed.

- [ ] **Step 1: Write the failing tests** in `scripts/test-perk-credits.mjs` (style of `scripts/test-links.mjs`). Use `const key = (p, d) => \`${d.getFullYear()}-${d.getMonth() + 1}\`` as the window function and invented rows. Tests:
  - `"a keyword match in an open window counts as auto"`: perk `{id:"coffee", accountId:"a1", amount:7, period:"MONTHLY", keywords:["Sample Coffee"]}`, row −7 "Sample Coffee" Oct 3 → `placed.get(id)` deep-equals `{benefitId:"coffee", how:"auto", windowKey:"2026-10"}`; `questions` empty.
  - `"a second match in a full window becomes a question"`: two −7 rows same month → second has no placement; `questions` = `[{transactionId: second, suggestedBenefitId:"coffee", windowFull:true}]`.
  - `"partial credits add up until the window is full"`: perk amount 50 SEMIANNUAL keyword "Sample Dining"; rows −25.99 and −8.69 → both auto.
  - `"two perks matching the same keyword ask instead of counting"`: perks with keywords `["credit"]` and `["Sample Credit"]`, row "AMEX Sample Credit" → no placement, one question, `suggestedBenefitId` = first matching perk.
  - `"an unmatched row named credit is asked about"`: row "AMEX Example Credit" −12, no keywords → question with `suggestedBenefitId: null`.
  - `"an amount equal to a perk suggests that perk"`: row "Sample Coffee Shop" −7, perk amount 7, no keywords → question suggesting it.
  - `"rows older than askSince are never asked about but still count"`: askSince Jul 18, row Jun 1 keyword match → auto; row Jun 1 named "Example Credit" unmatched → no question.
  - `"a yes counts even without a keyword and past the cap"`: decision YES benefitId coffee on a row "Misc" → `how: "confirmed"`.
  - `"not a perk is never placed or asked"`: decision NO benefitId null, keyword-matching name → nothing.
  - `"a refused perk is skipped but another may be suggested"`: decision NO benefitId "coffee", perks coffee (keyword "Sample") and dining (amount equal) → no placement; question suggests "dining".
  - `"rows on another card's account are ignored"`.
  - `"card payments, pending rows and fees are not candidates"`: `isCreditCandidate` false for pfcDetailed `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`, `LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT`, `pending: true`, `isFee: true`, `amount: 5`; true for `TRANSFER_IN_OTHER_TRANSFER_IN`.
  - `"learnKeyword"`: `{merchantName:"Sample Coffee", name:"x"}` → `"Sample Coffee"`; `{merchantName:null, name:"AMEX Sample Credit"}` → `"Sample Credit"`; `{merchantName:null, name:"SAMPLE COFFEE 004512"}` → `"SAMPLE COFFEE"`.

- [ ] **Step 2: Run** `node --import ./scripts/resolve-alias.mjs --test scripts/test-perk-credits.mjs` — expect FAIL (module not found).
- [ ] **Step 3: Implement** the three functions in `src/lib/perk-credits.ts`.
- [ ] **Step 4: Run** the same command — expect all PASS. Add the file to `package.json`'s test list.
- [ ] **Step 5: Commit** `Perks: placement rules for statement credits`.

### Task 2: Pairing rules (pure)

**Files:**
- Modify: `src/lib/perk-credits.ts`
- Modify: `scripts/test-perk-credits.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the file.
- Produces:

```ts
export interface PurchaseRow { id: string; date: Date; amount: number; name: string; merchantName: string | null }
export interface RankedPurchase extends PurchaseRow { strong: boolean }
export const PAIR_WINDOW_DAYS = 45;
export function rankPurchases(
  credit: { date: Date; amount: number },
  purchases: PurchaseRow[],
  perk: { keywords: string[]; pairedMerchants: string[] },
): RankedPurchase[]
export function pickAutoPair(ranked: RankedPurchase[]): string | null
```

`rankPurchases` keeps purchases with `amount >= -credit.amount - 0.005` and date in `[credit.date − 45 days, credit.date]`; orders by (a) `merchantName ?? name` equals a `pairedMerchants` entry case-insensitively, (b) a keyword contained in name/merchant, (c) smaller date gap. `strong` = (a) or (b). `pickAutoPair` returns the id when exactly one row is `strong`, else null.

- [ ] **Step 1: Write failing tests**: `"a single keyword purchase is picked"` (purchase "Sample Coffee" 7.00 two days before a −7 credit → `pickAutoPair` = its id); `"two strong matches pick nothing"`; `"a remembered merchant ranks first"` (pairedMerchants `["Sample Bistro"]`, purchases "Sample Bistro" 40 days back and "Other Place" 1 day back → Sample Bistro first, strong); `"purchases smaller than the credit or older than 45 days are dropped"`; `"weak matches rank by date and are never auto-picked"`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Perks: purchase pairing rules`.

### Task 3: Schema, placement on read, new DTO fields

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261016000000_perk_credits/migration.sql`
- Create: `src/services/perk-credits.service.ts`
- Modify: `src/services/benefits.service.ts`
- Modify: `src/types/index.ts`
- Modify: `src/app/api/user-cards/route.ts` (GET returns `{ cards, perkQuestions }`)

**Interfaces:**
- Consumes: `placeCredits`, `isCreditCandidate` (Task 1); `periodWindow` from `benefits.service.ts`.
- Produces:
  - Schema: `Transaction.benefitId String?` (relation `benefit UserBenefit? @relation(fields:[benefitId], references:[id], onDelete: SetNull)`, `@@index([benefitId])`), `Transaction.benefitDecision String?` (`"YES"|"NO"`), `Transaction.perkPaired Boolean @default(false)` (this feature made the row's `linkedToId`), `Transaction.noAutoPair Boolean @default(false)`; `UserBenefit.pairedMerchants String @default("[]")` and the back-relation `transactions Transaction[]`.
  - `perk-credits.service.ts`: `export async function loadPerkPlacement(now?: Date): Promise<{ placement: Placement; rows: Map<string, CreditRowWithLink>; perks: PerkInput[] }>` where `CreditRowWithLink = CreditRow & { linkedToId: string | null; noAutoPair: boolean }`. Loads perks (benefits with `perkActiveFrom == null` on cards with `accountId`), candidate rows on those accounts since Jan 1 of last year (filter with `isCreditCandidate`), uses `windowKey = (p, d) => periodWindow(p, d).key`, `askSince = now − 90 days`. Dates via `localDay` as `benefits.service.ts` does.
  - `types/index.ts`:

```ts
export interface PerkPurchaseDTO { id: string; date: string; name: string; amount: number }
export interface PerkCreditDTO {
  id: string; date: string; name: string; amount: number; // amount positive
  how: "auto" | "confirmed"; purchase: PerkPurchaseDTO | null;
}
export interface PerkQuestionDTO {
  transactionId: string; date: string; name: string; amount: number; // positive
  cardId: string; cardName: string; suggestedBenefitId: string | null; windowFull: boolean;
}
// BenefitPeriodDTO gains: credits: PerkCreditDTO[]
// BenefitDTO gains: openQuestions: number
```

  Dates are `YYYY-MM-DD`. `cardName` = card `name ?? issuer`.

Behaviour change in `benefits.service.ts`: `autoMode` is `"credits"` when the card is linked and (keywords non-empty or the perk has a confirmed row). In credits mode a window's auto used = sum of `-amount` of rows placed to this perk with that `windowKey` (replaces the raw keyword sum, so a refused or overflow row no longer counts). Manual overrides, perk mode and spending mode are unchanged. Each window's `credits` lists its placed rows (date ascending) with `purchase` = the row's `linkedToId` target when set. `openQuestions` = questions whose `suggestedBenefitId` is this perk.

- [ ] **Step 1: Edit `schema.prisma`**, then write the migration without touching any database: `git show HEAD:prisma/schema.prisma > /tmp/claude-perk-old.prisma` (use the session scratchpad dir) and `npx prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261016000000_perk_credits/migration.sql`. Expected: `ALTER TABLE "Transaction" ADD COLUMN …` / SQLite table-rebuild statements, plus the index. Run `npx prisma generate`.
- [ ] **Step 2: Implement** `loadPerkPlacement` and the `benefits.service.ts` / types / route changes.
- [ ] **Step 3: Verify:** `npx tsc --noEmit -p .` and `npm run lint` clean; `npm test` passes.
- [ ] **Step 4: Verify read-only against a copy:** `cp prisma/dev.db <scratchpad>/perk.db`, `DATABASE_URL=file:<scratchpad>/perk.db npx prisma migrate deploy`, then a scratch `node --import ./scripts/resolve-alias.mjs` script (in the scratchpad, never committed) calling `getUserCardsWithProgress()` with that `DATABASE_URL`. Expected: every benefit has `openQuestions` and each window a `credits` array; nothing throws. Print only counts, never names or amounts, and delete the copy afterwards.
- [ ] **Step 5: Commit** `Perks: place credits on read; credits per window and open questions`.

### Task 4: Answer, detach, pick-purchase routes and automatic pairing

**Files:**
- Create: `src/app/api/perk-credits/[id]/route.ts` (PUT)
- Create: `src/app/api/perk-credits/[id]/purchase/route.ts` (PUT)
- Create: `src/app/api/perk-credits/candidates/route.ts` (GET)
- Modify: `src/services/perk-credits.service.ts`
- Modify: `src/app/api/benefits/[id]/route.ts` (DELETE cleanup)
- Modify: `src/app/api/transactions/[id]/route.ts` (`handleLink` unlink branch)
- Modify: `src/app/api/plaid/sync/route.ts`

**Interfaces:**
- Consumes: `loadPerkPlacement`, `learnKeyword`, `rankPurchases`, `pickAutoPair`, `validateLink` (`src/lib/links.ts`).
- Produces (routes, `[id]` = the credit's transaction id):
  - `PUT /api/perk-credits/:id` body `{ "decision": "yes", "benefitId": "b1" }` | `{ "decision": "no", "benefitId": "b1" }` (detach: "not this perk") | `{ "decision": "no", "benefitId": null }` (not a perk). Writes `benefitDecision`/`benefitId`. On yes: if no keyword of the perk matches the row, append `learnKeyword(row)` to `matchText`; then `pairPerkCredits({ only: id })`. On no: if the row is `perkPaired`, clear `linkedToId`, `perkPaired`, and `userCategorySource` (as `handleLink` does). 400 on a bad body or a money-out row; 404 unknown ids. Returns `{ ok: true }`.
  - `PUT /api/perk-credits/:id/purchase` body `{ "purchaseId": "t9" }` → link via `validateLink`, set `perkPaired: true`, `noAutoPair: false`, append the purchase's `merchantName ?? name` to the perk's `pairedMerchants` (deduped); `{ "purchaseId": null }` → unlink and set `noAutoPair: true`. Requires the row to be placed to a perk (400 otherwise).
  - `GET /api/perk-credits/candidates?benefitId=b1` → `{ candidates: PerkPurchaseDTO[] }`: credit candidates on that perk's card account in the last 365 days not already placed to this perk, newest first, at most 50 (amount positive).
  - `perk-credits.service.ts`: `export async function pairPerkCredits(opts?: { only?: string; now?: Date }): Promise<number>`: for each placed row with date ≥ now − 90 days (or just `only`), `linkedToId == null`, `!noAutoPair`: rank purchases on the same account (money-out, not pending, not fee, not already the target of another credit placed to the same perk), `pickAutoPair`, and if picked and `validateLink` passes, write `linkedToId`, `userCategory: null`, `userCategorySource: "LINK"`, `perkPaired: true`, and remember the merchant. Returns the number paired.
- `DELETE /api/benefits/:id`: in one `prisma.$transaction`, first unlink rows with `benefitId = id AND perkPaired` (clear `linkedToId`, `perkPaired`, `userCategorySource`), clear `benefitId`/`benefitDecision` on rows with `benefitId = id`, then delete. Also unlink `perkPaired` rows that were *auto*-placed to this perk (no `benefitId`): compute with `loadPerkPlacement` before deleting.
- `handleLink` unlink branch: when the row was `perkPaired`, also set `perkPaired: false, noAutoPair: true`.
- Sync route: after `Promise.allSettled`, `await pairPerkCredits().catch((e) => console.error("[sync] perk pairing", e))` — it never fails the sync.

- [ ] **Step 1: Read** `node_modules/next/dist/docs/` on route handlers / dynamic params (params is a Promise here, as in existing routes).
- [ ] **Step 2: Implement** the service function, the routes, and the three modifications.
- [ ] **Step 3: Verify:** `npx tsc --noEmit -p .`, `npm run lint`, `npm test`.
- [ ] **Step 4: Verify on a migrated copy of the database** (as Task 3 Step 4, never `dev.db`): start nothing; in a scratch script call `pairPerkCredits({ now })` and print only the count; call it again and expect `0` (idempotent). Delete the copy.
- [ ] **Step 5: Commit** `Perks: answer, detach and pick-purchase routes; pair credits after sync`.

### Task 5: iPhone models, client and store writes

**Files:**
- Modify: `ios/BudgetPhone/Models/UserCardModels.swift`
- Modify: `ios/BudgetPhone/Models/CardRequests.swift`
- Modify: `ios/BudgetPhone/Networking/APIClient+Benefits.swift`
- Modify: `ios/BudgetPhone/Benefits/BenefitsStore.swift`
- Modify: `ios/BudgetPhoneTests/Fixtures/user-cards.json`, `ios/BudgetPhoneTests/CardWritesTests.swift`, `ios/BudgetPhoneTests/UserCardModelTests.swift`

**Interfaces:**
- Consumes: the JSON from Tasks 3–4.
- Produces:
  - `struct PerkPurchaseDTO`, `struct PerkCreditDTO` (`how: String`, `purchase: PerkPurchaseDTO?`), `struct PerkQuestionDTO` (Identifiable by `transactionId`), all `Decodable, Equatable, Sendable`; `BenefitPeriodDTO.credits: [PerkCreditDTO]`; `BenefitDTO.openQuestions: Int`; `UserCardsResponse.perkQuestions: [PerkQuestionDTO]` decoded with `decodeIfPresent ?? []` (older servers and the `cardJSON` test helper omit it).
  - `enum PerkDecision: Equatable, Sendable { case yes(benefitId: String); case notThisPerk(benefitId: String); case notAPerk }` encoding to the three bodies of Task 4.
  - `CardWrite` gains `.decidePerk(transactionId: String, PerkDecision)` and `.pickPurchase(creditId: String, purchaseId: String?)`.
  - `APIClient`: `decidePerk(transactionId:_:)` → `PUT api/perk-credits/:id`; `pickPerkPurchase(creditId:purchaseId:)` → `PUT api/perk-credits/:id/purchase` (body `{"purchaseId":null}` encodes the null explicitly); `perkCandidates(benefitId:) -> [PerkPurchaseDTO]` → `GET api/perk-credits/candidates?benefitId=`.
  - `BenefitsStore.questions: [PerkQuestionDTO]` set from each load.

- [ ] **Step 1: Write failing tests.** In `CardWritesTests.eachWriteHitsItsRoute` add `(.decidePerk(transactionId: "t1", .yes(benefitId: "b1")), "PUT", "/api/perk-credits/t1")` and `(.pickPurchase(creditId: "t1", purchaseId: nil), "PUT", "/api/perk-credits/t1/purchase")`. New test `perkBodies`: `.yes(b1)` → `["decision":"yes","benefitId":"b1"]`; `.notThisPerk(b1)` → `["decision":"no","benefitId":"b1"]`; `.notAPerk` → `decision == "no"` and `benefitId` is `NSNull`; `pickPurchase(nil)` → `purchaseId` is `NSNull`; `pickPurchase("t9")` → `["purchaseId":"t9"]`. In `UserCardModelTests`: the fixture decodes a window with one credit whose `purchase.name == "Sample Coffee"`, `openQuestions == 1`, and `perkQuestions.first?.windowFull == true`; a response without `perkQuestions` decodes to `[]`.
- [ ] **Step 2: Update the fixture** with invented values (one credit + purchase, one question) and run the iOS tests — expect the new tests to FAIL to compile/decode.
- [ ] **Step 3: Implement** models, client methods, store cases.
- [ ] **Step 4: Run iOS tests** — PASS.
- [ ] **Step 5: Commit** `iPhone: perk credit models and writes`.

### Task 6: iPhone screens

**Files:**
- Create: `ios/BudgetPhone/Benefits/PerkReviewView.swift`
- Create: `ios/BudgetPhone/Benefits/PerkPickers.swift` (purchase picker sheet, add-transaction sheet)
- Modify: `ios/BudgetPhone/Benefits/CardsView.swift`, `CardDetailView.swift`, `CreditDetailView.swift`
- Modify: `ios/BudgetPhone/Support/CardRules.swift` + `ios/BudgetPhoneTests/CardRulesTests.swift` (copy helpers)

**Interfaces:**
- Consumes: Task 5's store, writes and client methods; existing `APIClient.linkCandidates(transactionId:)` for the purchase list.
- Produces: `CardRules.questionNote(_ q: PerkQuestionDTO, perk: BenefitDTO?) -> String?` and `CardRules.creditWindows(_ b: BenefitDTO, now: Date) -> [BenefitPeriodDTO]`.

Screens (copy is exact):
- **CardsView:** when `store.questions` is non-empty, a first section with a `NavigationLink` "To Review" showing the count as trailing secondary text, pushing `PerkReviewView`.
- **PerkReviewView** (title "To Review"): one section per question. Row: name, then "`<date> · <cardName>`" secondary, amount trailing (`AmountText`, "+$7.00" style via existing formatters). Footer from `questionNote`: when `windowFull`, "`<perk name>` is already used for `<periodLabel>`. This may be a refund." Buttons: the suggested perk's name (when non-null), "Other Perk…" (`confirmationDialog` listing that card's perks), "Not a Perk". Each sends `.decidePerk`. Empty state `ContentUnavailableView("Nothing to Review", systemImage: "checkmark.circle")`.
- **CardDetailView** credits rows: when `benefit.openQuestions > 0`, a small `Image(systemName: "questionmark.circle.fill")` before the chevron, accessibility label "Needs review".
- **CreditDetailView:** below the progress section, one section per window from `creditWindows` (current window first, then earlier ones that have credits; future windows never), header = window `label`. Each credit: name + date secondary, amount trailing, secondary "Matched" (auto) or "Confirmed"; beneath, the purchase ("`<name>` · `<date>`", amount) or a "Pick Purchase" button opening the purchase sheet (rows from `linkCandidates`, choose sends `.pickPurchase`). Swipe on a credit: "Detach" → `.decidePerk(id, .notThisPerk(benefit.id))`. Swipe on a purchase line: "Unlink" → `.pickPurchase(id, nil)`. A final row "Add Transaction…" opens the add sheet (rows from `perkCandidates`; choose sends `.decidePerk(id, .yes(benefit.id))`). Existing year strip, perk switch, used field and Delete stay.

- [ ] **Step 1: Write failing tests** in `CardRulesTests`: `questionNote` returns the exact refund sentence when `windowFull`, nil otherwise; `creditWindows` puts the current window first, drops future windows and earlier empty ones.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** helpers and views. **Step 4: Run** iOS tests — PASS.
- [ ] **Step 5: Look at it:** build and launch in the simulator against the live server (GET only — do not tap any answer, detach, pick or add button; those write). Screenshot To Review, a card page and a credit page. Check accessibility size (`.accessibility3`) stacks label/amount pairs.
- [ ] **Step 6: Commit** `iPhone: review perk credits, see their purchases`.

### Task 7: Perk reminders

**Files:**
- Create: `ios/BudgetPhone/Support/PerkReminders.swift` (pure planner)
- Create: `ios/BudgetPhone/Shared/PerkReminderScheduler.swift`
- Create: `ios/BudgetPhoneTests/PerkRemindersTests.swift`
- Modify: `ios/BudgetPhone/Settings/SettingsView.swift`, `ios/BudgetPhone/Benefits/BenefitsView.swift`

**Interfaces:**
- Consumes: `UserCardDTO`, `BenefitDTO` (`period`, `amount`, `cappedUsed`, `autoMode`).
- Produces:

```swift
struct PerkReminder: Equatable, Sendable { let id: String; let fireDate: Date; let title: String; let body: String }
enum PerkReminders {
  static let storageKey = "perkReminders"      // @AppStorage Bool, default false
  static let idPrefix = "perk-"
  static func windowEnd(period: String, now: Date, calendar: Calendar) -> Date   // calendar-aligned like periodWindow
  static func plan(cards: [UserCardDTO], now: Date, calendar: Calendar, fired: Set<String>) -> [PerkReminder]
}
@MainActor enum PerkReminderScheduler { static func reschedule(cards: [UserCardDTO]) async }
```

`plan` skips perks with `autoMode == "perk"`, `amount <= 0`, or `cappedUsed >= amount`. `id = "perk-<benefitId>-<yyyy-MM-dd of windowEnd>"`. Fire at 10:00 local on `windowEnd − 7 days`; if that has passed and `windowEnd > now`, fire at `now + 60s` unless `id ∈ fired` (then skip). Title = perk name. Body exact: "`$<left>` left, ends `<MMM d>`." where left = `amount − cappedUsed` via `Formatters.currency` and the date is `windowEnd − 1 day`.

`reschedule`: if the setting is off, remove pending requests with `idPrefix` and return. Else remove pending `perk-` requests, add one `UNNotificationRequest` per reminder (`UNCalendarNotificationTrigger` for future dates, `UNTimeIntervalNotificationTrigger(60)` for the soon case), and add soon ids to a `fired` set saved in `UserDefaults` under `"perkRemindersFired"`.

- [ ] **Step 1: Write failing tests** (`PerkRemindersTests`, fixed `Calendar(identifier: .gregorian)` with `TimeZone(identifier: "America/Chicago")`): monthly perk $7 with $0 used, now Oct 10 → one reminder at Oct 24 10:00, body "$7.00 left, ends Oct 31."; full perk → none; flat perk → none; now Oct 27 → fire date `now + 60`; now Oct 27 with that id in `fired` → none; quarterly window end for Nov 5 is Jan 1; semiannual for Mar 3 is Jul 1; annual is next Jan 1.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** planner and scheduler. Settings: a `Toggle("Perk Reminders")` bound to `@AppStorage(PerkReminders.storageKey)`; turning it on calls `UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])` and flips back off if not granted. BenefitsView: `.onChange(of: store.cards)` → `Task { await PerkReminderScheduler.reschedule(cards: store.cards ?? []) }`.
- [ ] **Step 4: Run** iOS tests — PASS.
- [ ] **Step 5: Commit** `iPhone: perk reminders a week before a window closes`.

### Task 8: Changelog, merge, rebuild

**Files:**
- Modify: `CHANGELOG.md` (under `## Unreleased`)

- [ ] **Step 1:** Add entries (match the file's voice): perks fill themselves from credits including ones that need a yes; a credit page shows each credit and the purchase it paid back; To Review asks about credits the app can't place; Perk Reminders in Settings. Note that pairing a credit with its purchase nets that purchase in spending.
- [ ] **Step 2:** `npm test`, iOS tests, `bash scripts/test-scrub.sh` all pass.
- [ ] **Step 3:** Commit, dry-run then merge the branch into main (`git merge --no-commit --no-ff` then abort to check; then merge for real), delete the branch.
- [ ] **Step 4:** `bash Budget.command --no-open` (applies the migration to the owner's database via the app's own `migrate deploy` with its snapshot) and confirm `GET /api/user-cards` returns `perkQuestions`.
