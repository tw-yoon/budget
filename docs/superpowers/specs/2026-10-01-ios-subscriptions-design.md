# iPhone App — Subscriptions Design

**Status:** Approved in chat 2026-10-01. Branch `ios-subscriptions`, cut from `main`.

**Goal:** Bring the web's Subscriptions page (`src/components/SubscriptionsDashboard.tsx`) to the phone. It is not a tab. A card on Analytics shows the monthly total and opens the list. On the list you can detect from banks, add and delete, as on the web.

**Builds on:** the Accounts, Transactions, Settings → Mode and Analytics specs (`2026-09-26-*`, `2026-09-27-*`, `2026-09-30-*`). Everything there still holds.

**No server changes.** `GET` / `POST /api/subscriptions`, `DELETE /api/subscriptions/{id}` and `POST /api/subscriptions/detect` exist, and the web uses each of them today.

---

## Decisions already made

| Question | Decision |
|---|---|
| Where it lives | A **Subscriptions** card on Analytics that pushes the list. Not a tab, and not under Settings: it is money data, not app configuration. |
| Detect from banks | **Pull-to-refresh on the list** runs Detect, matching Accounts (balances) and the Ledger (Sync). **Long-pressing the Analytics card** also offers **Detect from Banks** in a context menu. A custom swipe on the card was rejected, because swipe actions are a list-row gesture and nothing on a card would hint at it. |
| Add | **+** in the list's toolbar opens a sheet. |
| Delete | Swipe a row to delete it. Like the web, there is no extra confirmation; the swipe is the confirmation. |
| Edit | None. The web has none either. |
| Mode | Shown in Normal and Pro alike. The web has no Pro gate on Subscriptions. |
| Next-date display | Deliberate difference from the web. The phone shows the stored calendar date (read in UTC), as `PaymentStatus` does for due dates. The web formats the UTC-midnight timestamp in local time, so west of UTC it shows the day before. |

---

## Project layout

New files (folder-synchronized groups; no project file edits):

| File | What it holds |
|---|---|
| `Models/SubscriptionModels.swift` | `SubscriptionDTO`, `SubscriptionsResponse`, `DetectResult`, `NewSubscription` (the POST body), `Cadence` (the six values and their labels, ported from `../src/lib/subscriptions.ts`). |
| `Networking/APIClient+Subscriptions.swift` | `subscriptions()`, `addSubscription(_:)`, `deleteSubscription(id:)`, `detectSubscriptions()`. |
| `Subscriptions/SubscriptionsStore.swift` | `@MainActor @Observable` store shared by the card and the list. |
| `Subscriptions/SubscriptionsCard.swift` | The Analytics card, with its context menu. |
| `Subscriptions/SubscriptionsView.swift` | The pushed list. |
| `Subscriptions/SubscriptionRow.swift` | One row. |
| `Subscriptions/AddSubscriptionSheet.swift` | The add form. |

Changed: `Analytics/AnalyticsView.swift` owns a `SubscriptionsStore`. It loads the store alongside its own loads, shows the card below the summary grid, and adds the `navigationDestination` for the list.

## Networking

| Call | Route | Notes |
|---|---|---|
| `subscriptions()` | `GET /api/subscriptions` | `{ subscriptions, monthlyTotal }`. The server sorts active first, then by name. |
| `addSubscription(_ s: NewSubscription)` | `POST /api/subscriptions` | Body `{"name":…,"amount":…,"cadence":"MONTHLY","nextDate":"2026-10-05"}`. `nextDate` is `null` when not set. `amount` is a JSON number. A 400's `{ error }` becomes `APIError.server(400, message)`. |
| `deleteSubscription(id:)` | `DELETE /api/subscriptions/{id}` | |
| `detectSubscriptions()` | `POST /api/subscriptions/detect` | Body `{}`, timeout 60 s (it calls Plaid per bank). Returns `{ found, errors: [{institution, error}] }`. |

## Models

`SubscriptionDTO` mirrors `src/types/index.ts`: `id`, `name`, `amount`, `cadence`, `cadenceLabel`, `monthlyCost`, `nextDate: String?`, `merchantName: String?`, `accountName: String?`, `source` (`"MANUAL"` | `"AUTO"`), `isActive`. The phone shows the server's `cadenceLabel` and `monthlyCost` as given and does not recompute them.

`Cadence` lists `WEEKLY`, `BIWEEKLY`, `SEMI_MONTHLY`, `MONTHLY`, `QUARTERLY`, `YEARLY` with the labels from `CADENCE_LABELS`: "Weekly", "Every 2 weeks", "Twice a month", "Monthly", "Quarterly", "Yearly". It is used only by the Add sheet's picker.

## State — `SubscriptionsStore`

Holds `data: SubscriptionsResponse?`, `error: APIError?` (full-screen, only while nothing is loaded), `banner: String?`, `notice: String?` (the Detect result), `isDetecting`, and a generation counter.

- **`load()`**: GET. The usual rules apply. With nothing loaded, an error is full-screen. With data showing, it becomes a banner and the data stays. A success clears the banner. `.cancelled` is silent. A stale generation is dropped.
- **`detect()`**: Detect from banks. It runs one at a time (`isDetecting` guards it). It clears a stale banner and notice before the call. On success it sets `notice` to the web's text, then reloads:
  - `Found 1 recurring charge.`
  - `Found N recurring charges.`
  - Bank errors are appended as ` (Example Bank: message; Other Bank: message)`, built from `errors[].institution` and `errors[].error`.
  - A failed call sets `banner` to its message. `.cancelled` is silent.
- **`add(_:) async throws(APIError)`**: POST, then reload. It throws so the sheet keeps its fields and shows the message.
- **`delete(_:)`**: removes the row from `data` at once and sends the DELETE. On failure it reloads (bringing the row back) and shows the banner "Couldn't delete {name}." On success it reloads, so `monthlyTotal` is the server's figure.

## Analytics card

`SubscriptionsCard` sits under the summary grid on Analytics, in both modes. It uses the same panel style as `SummaryGrid` tiles: full width, `secondarySystemGroupedBackground`, corner radius 16.

- The title is **Subscriptions** with a chevron. The line below reads `$X/mo across N active` (the web header; N counts `isActive`). Before the first load it shows a spinner. If a load fails with nothing to show, it reads "Couldn't load subscriptions."
- While Detect runs, a small spinner appears. A `notice`, when set, shows under the line in green with a dismiss button.
- The card also shows the store's banner with a dismiss button, so a failed Detect started from the card's menu has somewhere to report; Analytics has no other place for it.
- Tapping the card pushes `SubscriptionsView` (`NavigationLink(value:)` to a `SubscriptionsRoute`).
- The context menu (long press) has one item: **Detect from Banks** (`systemImage: "arrow.triangle.2.circlepath"`). It is disabled while a detect is running.
- Analytics' own load and pull-to-refresh also call `subscriptions.load()`, a GET only. Analytics' pull never runs Detect.

## The list — `SubscriptionsView`

An inset-grouped `List` with the large title "Subscriptions" and the grouped background.

- **Header section:** `$X/mo across N active`, the same string as the card.
- **Rows:** in the server's order. Each `SubscriptionRow` shows:
  - The name. Then a small capsule tag: **detected** for `AUTO`, **manual** otherwise. Then **inactive** in secondary text when `!isActive`.
  - A second line: `cadenceLabel`, then ` · accountName` when present, then ` · next Oct 5, 2026` when `nextDate` is present. The date comes from `Formatters.date` with a UTC calendar.
  - On the trailing side: `amount` in currency, and `$X/mo` under it in secondary text. Monospaced digits.
  - Inactive rows are dimmed (opacity 0.6), as on the web.
  - At accessibility sizes the trailing amounts move under the text, and amounts never wrap mid-number.
- **Section footer** (the web's notice, as plain footer text): "Detection finds recurring charges from your transactions. It tries to skip rent, loans, and transfers, but isn't perfect. Delete anything that isn't a subscription."
- **Empty state:** `ContentUnavailableView` with the title "No Subscriptions" and the text "Pull down to detect from your banks, or tap + to add one." This is the web's "Hit Detect from banks or + Add." adapted to the phone's controls.
- **Pull-to-refresh** runs `store.detect()`. The `notice` shows at the top of the list as a `Notice`, and the `banner` as a `Banner`.
- **Toolbar:** a trailing **+** (`Add Subscription`) that presents `AddSubscriptionSheet`.
- **Swipe to delete** on each row, using `.swipeActions` with a destructive **Delete** button.
- A full-screen error (nothing loaded) uses the shared `ErrorView` with Retry.

## Add sheet — `AddSubscriptionSheet`

A `Form` in a `NavigationStack`, titled "Add Subscription" (inline), with Cancel and **Add**:

- **Name:** a `TextField` with the placeholder "Name (e.g. Netflix)", as on the web.
- **Amount:** a decimal-pad `TextField` with a currency prefix.
- **Cadence:** a `Picker` over `Cadence.allCases`, default **Monthly**.
- **Next date:** a `Toggle` ("Next Date"). When it is on, a `DatePicker` (date only) appears. Off sends `nextDate: null`. On sends `"YYYY-MM-DD"` built from the picker's calendar components (the format the web's date input sends).
- **Add** is disabled until the name is non-blank and the amount parses as a positive finite number. The server also checks, and its 400 message shows in a footer row in red. The sheet stays open with its fields.
- While saving, **Add** shows a progress indicator and both buttons are disabled.
- On success the sheet closes and the store has already reloaded.

## Tests

Pure suite (`SubscriptionModelTests`):
- Decoding an invented `/api/subscriptions` fixture (`Fixtures/subscriptions.json`: `Sample Stream` manual, `Example Music` detected and inactive, with and without `nextDate` and `accountName`).
- Decoding a detect result.
- `Cadence` raw values and labels.
- The next-date line uses the UTC calendar date ("2026-10-05T00:00:00.000Z" → "Oct 5, 2026" in any time zone).

Stubbed suites, nested under `StubbedNetworkTests` with `@Suite(.serialized)`:
- **Requests:**
  - The add body is exactly `{"name","amount","cadence","nextDate"}`, with `nextDate` as a string or `null`, and `amount` a number.
  - DELETE path; detect is a POST to `/api/subscriptions/detect` with body `{}`.
- **Store, load:** full-screen error with nothing loaded; a banner over data; success clearing the banner; `.cancelled` silent; a stale generation dropped.
- **Store, detect:**
  - Notice wording for 1, for N, and with errors.
  - A stale banner cleared before the call.
  - A failed detect becomes a banner.
  - A second detect while one runs sends nothing.
- **Store, add:** throws the server's 400 message and does not reload.
- **Store, delete:**
  - The row disappears at once.
  - A failure brings it back and shows "Couldn't delete {name}."

Fixtures use invented names and amounts only.

**Simulator checks:** GET only against the live server. Open the card and the list. Never pull to refresh on the list, never use the context menu's Detect, and never add or delete there. The owner does the write checks.

## Out of scope

- Editing a subscription, or toggling active/inactive (the web has neither).
- Notifications before a charge.
- A Subscriptions tab or a Settings entry.
