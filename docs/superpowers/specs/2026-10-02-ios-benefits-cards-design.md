# iPhone App — Benefits → Cards Design

**Status:** Written 2026-10-02. Branch `ios-benefits-cards`, cut from `main`.

**Goal:** Bring the web's Benefits → Cards page (`src/app/benefits/cards`, `src/components/benefits/CardsSection.tsx`, `UserCardItem.tsx`) to the phone: every card with its rates, earnings and statement credits, plus the edits people make day to day. The Benefits tab gains a segmented control, **Cards · Best card**, in the web's sidebar order.

**Builds on:** `2026-10-01-ios-benefits-best-design.md` (its Out of scope named Cards and the segmented control), plus the Accounts and Transactions specs. Everything there still holds.

**No server changes.** Every route below exists and the web uses it.

---

## What the web Cards page offers

| Web feature | Where | Phone v1 |
|---|---|---|
| Rates note (amber) | `RatesNote.tsx` | Footer text, as on Best card |
| Add a card: preset (auto-fills rates and credits) or custom (issuer, optional name), last 4, start month (optional), 2-digit start year | `CardsSection.tsx` → `POST /api/user-cards` | Yes, as a sheet |
| Card list in the user's order, each collapsible | `UserCardItem.tsx` | A plain grouped list; a row pushes the card |
| Header: art, issuer, name, ··last4, "Member since <month> <year> · N yrs · u/n credits maxed", Linked · account / Not linked | `UserCardItem` | Row + detail |
| Move up / down | `useUserCards.move` → `POST /api/user-cards/reorder` | Edit → drag handles |
| Remove (confirm) | `DELETE /api/user-cards/:id` | Swipe Remove, and Remove Card in the detail, both confirmed |
| Start month, inline select | `PATCH /api/user-cards/:id { membershipStartMonth }` | Edit sheet |
| Credits vs. annual fee bar; edit fee | `FeeTracker` → `PATCH { annualFee }` | Section + Edit sheet |
| Earning rates: chips, delete, add / override (upsert per category) | `RatesSection` → `POST /api/rewards`, `DELETE /api/rewards/:id` | Yes |
| Points earned table, totals, "vs. next best", point value edit | `EarningsSection` → `PATCH { pointValueCents }` | Yes |
| Statement credits: progress, hint, Perk on/off, "Used $" log, Auto/Clear, delete (confirm) | `BenefitRow` → `PATCH /api/benefits/:id`, `DELETE` | Credit detail screen |
| Year strip: click a window to cycle auto → pinned → auto | `YearStrip` → `PATCH { periodKey, value }` | Rows in the credit detail; tap cycles |
| Add credit: name, amount, period, category or manual | `AddBenefitForm` → `POST /api/benefits` | Sheet |
| Card art upload with crop, remove | `CardArtPicker.tsx` → `PUT/DELETE /api/user-cards/:id/art` | **Out of scope** (display only) |
| Expanded / credits-open state synced through ui-state | `useSyncedFlag` | Not needed: navigation replaces collapsing |

## Decisions

| Question | Decision |
|---|---|
| Segments | `Cards` · `Best card`, the web sidebar's order and names (`SideNav.tsx`). Cards is the default, as `/benefits` redirects to `/benefits/cards`. Kept per scene in `@SceneStorage("benefits.segment")`. |
| Toolbar | The picker is the principal item, as on Activity. Cards has one trailing item, `EditButton` (reorder). Best card has none. Add Card is the last row of the list, like Mail's Add Account, so the picker stays centred. |
| One store | `BenefitsStore` (owned by RootView) serves both segments. Every write reloads it, so Best card is current after any edit. |
| Card detail | Pushed by id (`CardRoute`), so it always shows the store's latest copy. A card that vanishes (removed elsewhere) pops back. |
| Card edits | Detail toolbar **Edit** opens a sheet with Start Month, Annual Fee and (for points cards) Point Value. Save sends only the changed keys in one PATCH; the web sends one key per control, but the route takes any subset. |
| Year input | A year picker (this year back to 1980, the route's floor) instead of the web's 2-digit text field; the body carries the full year, as the web's `toFullYear` produces. |
| Rate edit | Tapping a rate opens Add Rate prefilled; Save upserts (the route keys on card + category). Swipe deletes. |
| Credit actions | One credit = one pushed screen: Perk toggle, Used amount field with Save, Auto/Clear, the windows, Delete Credit. |
| Failures | Sheets and detail writes show an alert ("Couldn't Save") with the server's message and keep their fields. List actions (swipe Remove, reorder) are optimistic; a failure reloads and shows a banner. The web is silent on all of these. |
| Reorder | Optimistic, then `POST /api/user-cards/reorder { ids }` with every id. The web fires and forgets; the phone reloads on failure. |
| Blurbs | Native style: no explanatory paragraphs. Only the rates note footer, and the same hints the web prints on each credit. |
| Money | Every dollar figure goes through `AmountText`, so Hide Amounts covers it. |

## Screens

### `BenefitsView`

`NavigationStack`, title "Card Benefits", inline. Principal `SegmentedSwitcher` (as Transactions) over `Cards` and `Best card`; Cards' Edit shares that item at the bar's trailing edge, so it fades out on Best card instead of popping. A `Group` switches `CardsView` / `BestCardsView`, sized full-screen on `systemGroupedBackground`. `navigationDestination(for: CardRoute.self)` → `CardDetailView`; `navigationDestination(for: CreditRoute.self)` → `CreditDetailView`.

### `CardsView`

Usual states: `ProgressView`, full-screen `ErrorView`, then an inset-grouped list with the `Banner` on top.

- **Cards section**, one row per card in server order:
  - `CardArtView` at 64 pt (cached art, gradient fallback).
  - Title `displayName || name || "Card"` (web header), one line.
  - Secondary: `<Issuer> ··<last4>`, then `u/n credits maxed` (web wording).
  - Swipe **Remove** (destructive), confirmed with the web's text `Remove <Issuer> ··<last4> and its benefits?`.
  - `onMove` reorders in edit mode.
- **Add Card** button row in its own section.
- **Footer:** the rates note.
- **Empty:** `ContentUnavailableView` "No Cards", "Add one to start tracking its benefits." — the Add Card row stays.
- **Pull-to-refresh:** `store.load()` (GET only).

### `AddCardSheet`

- **Card** picker (navigation-link style): "Custom", then presets grouped by issuer (`<Issuer> <name>`).
- Custom only: **Issuer** (segmented: Amex, Chase, Discover) and **Name** (placeholder "Card name (optional, e.g. Platinum)").
- **Last 4** (number pad, digits only, max 4), **Start Month** (None + months), **Start Year** (picker).
- **Add** disabled until last 4 has 4 digits. Body exactly as the web sends:
  - preset `{ presetSlug, last4, membershipStartYear, membershipStartMonth }`
  - custom `{ issuer, name, last4, membershipStartYear, membershipStartMonth }`, `name` and `membershipStartMonth` as `null` when empty.

### `CardDetailView`

Inset-grouped list, title = the row title, trailing **Edit**.

1. **Face:** `CardArtView` at 240 pt, centred, no row background.
2. **Card:** Issuer, Number `··last4`, Member Since (`Feb 2024` or the bare year), Annual Fee, Linked (`linkedAccountName` / "Not linked").
3. **Credits vs. Annual Fee:** a `ProgressView` (green once at or past break-even) and the web's line: `$x captured this year · ✓ paid for itself, $y ahead` / `$y to break even` · `up to $z available`; or `No annual fee · $x in credits captured this year · up to $z available`.
4. **Earning Rates:** `categoryLabel` + `display` (monospaced), `notes` as secondary text. Tap → Add Rate prefilled. Swipe Delete. **Add Rate** row. Empty footer: "No earning rates yet — add one below, or re-add this card from a preset."
5. **Points Earned** (header carries `earningsPeriodLabel`):
   - no earnings: "Link this card to an account to estimate what it earns."
   - no categories: "No spending on this card in this window yet."
   - else one row per category: label (+ " base"), earned on the right; secondary `"$spend · rate · ±$vsBest vs. next best"` (`—` when even). A totals row: `$spent · <earned> ≈ $value` and `±$incremental vs. next best`. Points cards add `Valued at N¢ per point` as the footer.
6. **Statement Credits:** each credit `name`, `$cappedUsed / $amount`, a `ProgressView`, and the hint; pushes the credit. **Add Credit** row. Empty: "No credits yet — add one below."
7. **Remove Card** (destructive, confirmed) → pops.

Label/amount pairs stack at accessibility sizes; amounts never wrap.

### `CardEditSheet`

Start Month (None + months), Annual Fee (decimal), Point Value ¢ (only when `earnings?.unit == "X"`, as the web shows it). Save disabled while nothing changed or a value is invalid (fee ≥ 0, point value > 0). Body: only changed keys of `{ annualFee, membershipStartMonth, pointValueCents }`; clearing the month sends `null`.

### `RateSheet`

Category (`REWARD_CATEGORIES` with labels, default Dining), Rate (decimal, > 0), Unit (`x points` / `% cash`). Body `{ userCardId, category, multiplier, unit }`.

### `CreditDetailView`

1. Progress: `$cappedUsed / $amount`, bar, hint (with "✓ " when complete).
2. **Perk** toggle → `{ perkActive: Bool }`.
3. **Used** field + Save → `{ usedManual: n }`; when the source is manual, **Auto** (if it can fall back) or **Clear** → `{ usedManual: null }`.
4. **This Year** (only when more than one window): header shows `c/e captured · $ytd of $target`. One row per window: `label`, `$used / $target`, a state symbol (captured, partial, upcoming), "Manual" when pinned. Tap cycles exactly as the web: manual → clear (`value: null`), captured → `0`, else → `target`. Body `{ periodKey, value }`.
5. **Delete Credit** (destructive, confirmed with `Delete "<name>" and everything logged against it?`) → pops.

### `AddCreditSheet`

Name (placeholder "Benefit name (e.g. Airline Fee Credit)"), Amount ($, > 0), Period (Monthly, Quarterly, Semi-annual, Annual; default Annual), Tracking ("Track manually (no category)" or `<humanizePfc> spending` over `TRACKABLE_CATEGORIES`). Body `{ userCardId, name, amount, period, category }`, `category` null for manual.

## Ported logic (`Support/CardRules.swift`)

`issuers`, `monthNames`, `benefitPeriods` + `periodLabel`, `trackableCategories`, `rewardCategories`, `presets` (slug, issuer, name; `../src/data/card-presets.ts`), `cardTitle`, `memberSince`, `yearsHeld`, `creditsMaxed`, `removeCardPrompt`, `deleteCreditPrompt`, `feeSummary` (net, break-even, fill), `creditHint`, `canAuto`, `windowCycleValue`, `yearSummary`, `formatEarned`, `formatVsBest`, `formatIncremental`. Each names its web source.

## Project layout

| File | What it holds |
|---|---|
| `Models/UserCardModels.swift` | Full mirrors: `UserCardDTO`, `RewardRateDTO`, `BenefitDTO`, `BenefitPeriodDTO`, `EarningsDTO`, `EarningsCategoryDTO`. |
| `Models/CardRequests.swift` | `NewUserCard`, `UserCardPatch` (uses `PatchValue`), `NewRewardRate`, `NewBenefit`, `BenefitPatch`, `CardOrder`. |
| `Networking/APIClient+Benefits.swift` | `addUserCard`, `updateUserCard`, `deleteUserCard`, `reorderUserCards`, `saveRewardRate`, `deleteRewardRate`, `addBenefit`, `updateBenefit`, `deleteBenefit`. |
| `Support/CardRules.swift` | The ports above. |
| `Benefits/BenefitsStore.swift` | `CardWrite` enum, `perform(_:) throws(APIError)`, `remove(_:)`, `move(from:to:)`, `card(id:)`. |
| `Benefits/BenefitsView.swift` | The segmented control. |
| `Benefits/CardsView.swift`, `CardDetailView.swift`, `CreditDetailView.swift`, `CardSheets.swift` | The screens. |
| `Benefits/BestCardsView.swift` | Empty text now "Add a card under Cards to see which one earns most where." (web). |

## Tests

- **`UserCardModelTests`:** the fixture (invented: "Example Bank Gold ··0001", "Sample Rewards Card ··0002") now carries a credit with windows and earnings; every field decodes.
- **`CardRequestTests`:** every body's JSON — add card (preset, custom with nulls), patch (only changed keys, month cleared as null, empty), rate, credit (category and null), the three benefit patches, reorder.
- **`CardRulesTests`:** title fallbacks, member-since, years, fee summary (fee, no fee, ahead), credit hints (perk, credits, spending, manual, not tracked), `canAuto`, window cycle, year summary, earned / vs-best / incremental formatting, preset list shape.
- **`StubbedNetworkTests` → `CardWritesTests`:** each write's method, path and body; success reloads; failure throws and keeps the data; a stale banner clears before the call; optimistic remove and reorder, and their failure banner and reload; `.cancelled` silent.
- Existing `BenefitsStoreTests` (load failure rules) unchanged.

**Simulator checks:** GET only — list, detail, credit detail, sheets opened and cancelled; light mode, an accessibility size, the picker centred on both segments. Writes are checked by the stubbed tests; on-device writes are left to the owner.

## Out of scope

- Card art upload, crop and removal (`CardArtPicker`): cropping is awkward on a phone and the web does it well. Display uses `CardArtCache`.
- Flights (its own spec).
- Editing a card's issuer, name or last 4 (the web cannot either).
- Showing preset or credit `notes` beyond what the web shows (rate notes only).
