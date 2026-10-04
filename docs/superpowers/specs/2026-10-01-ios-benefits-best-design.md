# iPhone App — Benefits → Best Card Design

**Status:** Approved in chat 2026-10-01. Branch `ios-benefits-best`, cut from `main`.

**Goal:** Add a **Benefits** tab to the phone. Its first page is the web's Best card (`src/components/benefits/BestCardsSection.tsx`, `BestCards.tsx`): for each bonus category, which of your cards earns the most, plus the next two.

**Builds on:** the Accounts, Transactions, Settings → Mode, Analytics and Subscriptions specs. Everything there still holds.

**No server changes.** Only `GET /api/user-cards` and `GET /api/card-art/{file}` are used, and the web uses both today.

---

## Decisions already made

| Question | Decision |
|---|---|
| Placement | A fifth tab, **Benefits** (`creditcard`), between Analytics and Settings. |
| Structure | The tab shows Best card directly. When Cards and Flights come to the phone, they join as a segmented control (Cards · Best card · Flights), using the same pattern as Transactions. This spec has no segmented control. |
| Writes | None. Best card is read-only on the web too. |
| Refresh | Pull-to-refresh reloads `/api/user-cards`. It never calls Plaid. |
| Ties | The web sorts by `multiplier` only, so 3% and 3x tie. The phone keeps the web's stable order for ties: card order from the server. |
| Rates note | The web's amber note becomes plain footer text, following the phone's native style. |
| Empty state | Cards aren't on the phone yet, so the empty text points to the web. It changes when the phone has Cards. |

## Project layout

New files. These are folder-synchronized groups, so the project file is not edited.

| File | What it holds |
|---|---|
| `Models/UserCardModels.swift` | `UserCardsResponse`, `UserCardDTO` (only the fields Best card reads: `id`, `issuer`, `name`, `last4`, `displayName`, `artUrl`, `rewardRates`), and `RewardRateDTO` (`category`, `multiplier`, `unit`). Unknown keys are ignored. Cards and Flights will add fields later. |
| `Networking/APIClient+Benefits.swift` | `userCards()`, and `cardArtURL(_ path: String) -> URL` (resolves the server's relative `artUrl` against `baseURL`). |
| `Support/Rewards.swift` | Ports of `../src/lib/rewards.ts`: `bonusCategories`, `categoryLabels`, `effectiveRate`, `formatRate`. Also `ISSUER_LABELS` from `../src/lib/categories.ts`, `shortLabel` from `BestCards.tsx`, and `bestByCategory(_ cards:) -> [CategoryRanking]` (the ranking). |
| `Support/CardArtColors.swift` | Port of `cardArtColors` and its palettes (`../src/lib/colors.ts`). |
| `Benefits/BenefitsStore.swift` | `@MainActor @Observable` store for the card list. |
| `Benefits/BenefitsView.swift` | The tab root: a `NavigationStack` with the large title "Card Benefits", showing `BestCardsView`. |
| `Benefits/BestCardsView.swift` | The list. |
| `Benefits/CardArtView.swift` | The card face, from an image or a gradient. |

Changed: `App/RootView.swift` adds `Tab("Benefits", systemImage: "creditcard") { BenefitsView() }` between Analytics and Settings.

## Ranking (`Support/Rewards.swift`)

- **`bonusCategories`**, in order: `DINING`, `GROCERIES`, `TRAVEL`, `GAS`, `TRANSIT`, `ENTERTAINMENT`, `ONLINE_SHOPPING`, `DRUGSTORES`, `ROTATING`.
- **Labels**, in the same order: "Dining", "Groceries", "Travel", "Gas", "Transit", "Streaming", "Online Shopping", "Drugstores", "Rotating (quarterly)".
- **`effectiveRate(rates, category)`**: the card's rate for that category if it has one (`isBonus` true). Otherwise its `OTHER` rate (`isBonus` false). Otherwise `1`, `"X"`, `isBonus` false.
- **`formatRate(multiplier, unit)`**: `"\(n)%"` for `PERCENT`, otherwise `"\(n)x"`. Numbers print as JavaScript does: `3` → "3", `1.5` → "1.5", `2.25` → "2.25".
- **`shortLabel(card)`**: `displayName` if present. Otherwise the issuer label (`AMEX` → "Amex", `CHASE` → "Chase", `DISCOVER` → "Discover", any other value as is), followed by `" " + name` when `name` is present.
- **`bestByCategory(cards)`**: for each bonus category, every card with its effective rate, sorted by multiplier descending. The sort is stable, so ties keep server order. The view shows the first card and the next two.
- **The table shows** only when there is at least one card and at least one card has any reward rates. That matches the web's `hasRates` check.

## Card face (`CardArtView`)

- The shape is a rounded rectangle at the ID-1 aspect ratio, 1.586:1, with a corner radius of about 6% of the width.
- **With `artUrl`:** `AsyncImage` from `cardArtURL(artUrl)`, `.scaledToFill`, clipped. While the image loads or if it fails, the gradient face shows.
- **Gradient face:** a diagonal (135°) gradient from `cardArtColors(issuer, "\(issuer)-\(name ?? "")-\(last4)")`, with a soft white band across it, as on the web.
  - At 60 pt wide and above it shows the issuer label (top-left, small caps, white at 80%) and `··last4` (bottom-left, monospaced, white at 70%).
  - Below 60 pt it shows no text.
- **Accessibility label:** `shortLabel`.

## Best card list (`BestCardsView`)

An inset-grouped `List`.

- **Section header:** "Best card by category".
- **Rows**, one per bonus category:
  - The category label (caption, uppercase, secondary).
  - Below it, the winner's face at 80 pt wide.
  - Beside the face, on the first line: `shortLabel(best)` (medium weight, one line) and, on the right, the rate in monospaced digits, followed by " base" in secondary text when it is not a bonus.
  - On the next line: up to two runners-up, each a 28 pt face followed by its rate (caption, secondary, monospaced).
  - At accessibility sizes, the name and rate stack vertically, and the runners-up wrap under them. Rates never wrap mid-value.
- **Section footer:** "Ranked by raw rate · points and cashback aren't directly comparable."
- **Final footer text** (the web's RatesNote): "Earning rates are pre-filled from a ~2025 snapshot and statement credits are whatever you enter. Always verify current terms with your issuer."
- **No cards, or no rates:** a `ContentUnavailableView` titled "No Cards" with the text "Add a card under Benefits → Cards in Budget on the web to see which one earns most where."
- **Pull-to-refresh:** `store.load()`.
- **Full-screen error** (nothing loaded): the shared `ErrorView` with a Retry button.
- **Banner:** shows over the data when a reload fails.

## State — `BenefitsStore`

- Holds `cards: [UserCardDTO]?`, `error`, `banner`, `isLoading`, and a generation counter.
- `load()` follows the usual rules:
  - full-screen error when nothing is loaded;
  - a banner when data is showing;
  - a successful load clears the banner;
  - `.cancelled` is silent;
  - a stale generation is dropped.
- It loads on `.task`, when the scene becomes active, and when the server address changes, the same as `AccountsView`.

## Tests

Pure suites:
- **`RewardsTests`:**
  - The effective-rate fallbacks (bonus, base, 1x).
  - `formatRate`: "4x", "3%", "1.5x", "2.25%".
  - Category order and labels.
  - `shortLabel`: display name, issuer plus name, issuer only, unknown issuer.
  - `bestByCategory`:
    - The winner and runners-up for invented cards.
    - A tie keeps server order.
    - A card with no rates gets 1x base everywhere.
    - `hasRates` is false when no card has rates.
- **`CardArtColorsTests`:**
  - The palette pick for invented seeds. The expected hex values are computed with the web's `cardArtColors`.
  - The fallback palette for an unknown issuer.
- **`UserCardModelTests`:**
  - Decoding an invented fixture (`Fixtures/user-cards.json`: "Example Bank Gold ··0001" as `AMEX` with a 4x dining rate, and "Sample Rewards Card ··0002" as `CHASE` with a 3% base). The full DTO's other fields are present and get ignored.
  - `cardArtURL` resolving "/api/card-art/x.png" against a base URL.

Stubbed suite (`StubbedNetworkTests` → `BenefitsStoreTests`): the GET path, plus the load failure rules (full-screen, banner, clears, cancelled, stale generation).

Fixtures use invented names, last fours and rates only.

**Simulator checks:** GET only. Open the Benefits tab and check light mode, dark mode, AX sizes, and both card faces (image and gradient).

## Out of scope

- Benefits → Cards (editing cards, credits, rates, art) and Flights. Each gets its own spec.
- The segmented control (it arrives with the second page).
- Earnings figures.
