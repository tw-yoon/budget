# iPhone App — Accounts (v1) Design

**Status:** Approved in chat 2026-09-26. Branch `ios-accounts`, cut from `main` at `bb091f4`.

**Goal:** A native SwiftUI iPhone app, starting with the Accounts screen, that reads and edits the same data as the web app by calling its existing API. Targets iPhone 16 Pro (402×874 pt).

**Not a goal:** porting any business logic to the phone. The Next.js server stays the one place that computes, stores and talks to Plaid; the app is a client.

---

## Decisions already made

| Question | Decision |
|---|---|
| Native or iOS-styled web | Native SwiftUI |
| Where the data comes from | The Budget server's existing HTTP API |
| v1 screens | Accounts only (plus a Settings tab for the server address) |
| Accounts features | Everything desktop does: net worth, grouped accounts, due status, refresh balances, edit name / due day / credit limit |
| Reaching the server | Local network now; Tailscale later by changing the server address — no app or server change |
| Signing | Free Apple ID "Personal Team". Builds expire after 7 days and are renewed by pressing Run in Xcode |

### Future topology this must not block

Later, an always-on laptop becomes the server. It holds the only database. The development Mac (in a browser) and the phone (this app) are both clients of it, so an edit from either is simply there for the other. There is **no database-to-database sync** — two SQLite files reconciling each other is a far harder problem and buys nothing here. Development then runs a local dev server against a copy or sandbox database.

What the app does to be ready for that:

1. **No hardcoded server.** First launch asks for the server address; Settings changes it. Moving servers is one field.
2. **Reload on return to foreground**, and after every write — another client may have changed things.
3. **Writes send only the fields the user changed.** The web form sends all three fields; if the Mac renames a card while the phone edits its limit, a full-record save from the phone would silently revert the rename. `PATCH /api/accounts/:id` already applies only the keys present in the body (`"displayName" in body`), so no server change is needed.

**Prerequisite recorded for the server move, out of scope here:** the API has no authentication. `next start` binds every interface, so today anything on the home network can read and write the ledger. Once a machine serves it permanently, a token check for non-local requests (a Next proxy/middleware plus a token field in the app's Settings) should land before or with the move. Done: `2026-10-03-server-auth-token-design.md`.

---

## Project layout

```
budget-claude/ios/
  BudgetPhone.xcodeproj/          hand-written; uses Xcode 16+ folder-synchronized groups
  Config/
    Shared.xcconfig               tracked: bundle id prefix, deployment target, Swift settings
    Local.xcconfig                gitignored: DEVELOPMENT_TEAM (the Personal Team id)
    Local.example.xcconfig        tracked: template for the above
    Info.plist                    outside the synced folder, so it is not also copied as a resource
  BudgetPhone/
    App/                          BudgetPhoneApp, RootTabView
    Networking/                   APIClient, APIError, ServerSettings
    Models/                       AccountDTO, AccountGroup, AccountsSummary, AccountsResponse,
                                  RefreshResult, AccountPatch
    Accounts/                     AccountsStore, AccountsView, AccountRow, NetWorthHeader,
                                  AccountEditView, PaymentStatus
    Settings/                     SettingsView, ServerSetupView, ServerForm
    Support/                      Formatters (currency, date, relative time)
    Assets.xcassets               placeholder app icon and accent colour
  BudgetPhoneTests/               Swift Testing
    Fixtures/accounts.json        invented data only
```

- **Folder-synchronized groups** (`PBXFileSystemSynchronizedRootGroup`) mean adding a Swift file never touches `project.pbxproj`. That keeps the project file small enough to hand-write and review, and avoids adding XcodeGen/Tuist as a dependency.
- iOS 26 deployment target, iPhone only, portrait and landscape.
- No third-party packages.
- **Public-repo hygiene:** `budget-claude` is published publicly. The team id, the Mac's hostname and any real balances stay out of tracked files. `Local.xcconfig` is gitignored; fixtures are invented; the server address is entered at runtime, never committed. `scripts/test-scrub.sh` must still pass.

---

## Networking

### `ServerSettings`

- One value: the base URL, e.g. `http://<mac-name>.local:3000`. Stored in `UserDefaults` (`@AppStorage`).
- Validated on entry: must parse as an `http`/`https` URL with a host. A trailing slash is trimmed.
- The Bonjour `.local` name is suggested in the setup screen's help text because it survives the router reassigning IPs. Away from home, use the Mac's Tailscale IP (`100.x.y.z`) in the same field; a MagicDNS name ending in `.ts.net` needs `https`, since ATS blocks plain `http` to it.

### `APIClient`

A small struct over `URLSession`, decoding JSON with `Codable` (dates stay strings — see Models). Three calls:

| Call | Endpoint | Notes |
|---|---|---|
| `accounts()` | `GET /api/accounts` | Decodes `{ groups, summary }`; `banks` and `debitCards` are ignored (not decoded) |
| `refreshBalances()` | `POST /api/plaid/refresh-balances`, body `{}` | Returns `{ updated, liabilities, errors }`; 404 `{ error: "No linked items found" }` when nothing is linked |
| `updateAccount(id, patch)` | `PATCH /api/accounts/:id` | Body contains only changed keys; `null` clears a field |

- Timeout 15 s for reads and writes, 60 s for refresh (it calls Plaid once per linked bank).
- **`APIError`** distinguishes: `.unreachable` (connection refused / host not found / timed out / offline), `.server(status, message)` (non-2xx, `message` taken from the `{ error }` body when present), `.decoding` (shape mismatch), `.notConfigured` (no server set), `.cancelled` (the request was cancelled — a silent no-op, never shown to the user).

### Info.plist

- `NSAppTransportSecurity` → `NSAllowsLocalNetworking = YES`. Allows plain `http` to `.local` names and IP addresses — covers the home network and a Tailscale IP (`100.x.y.z`), but not a `*.ts.net` MagicDNS name, which needs `https`. No blanket `NSAllowsArbitraryLoads`.
- `NSLocalNetworkUsageDescription`: "Budget connects to the Budget server on your Mac over your network." iOS shows this the first time the app reaches a LAN address.

---

## Models

Swift mirrors of `src/types/index.ts`. Field names match the JSON exactly so `Codable` needs no key mapping.

```swift
struct AccountDTO: Codable, Identifiable, Equatable {
  let id: String
  let name: String
  let officialName: String?
  let mask: String?
  let type: String          // DEPOSITORY | CREDIT | INVESTMENT | LOAN | OTHER
  let subtype: String?
  let currentBalance: Double
  let availableBalance: Double?
  let balanceFetchedAt: String
  let institution: String
  let isLiability: Bool
  let nextPaymentDueDate: String?
  let lastStatementBalance: Double?
  let minimumPaymentAmount: Double?
  let paymentIsOverdue: Bool?
  let displayName: String?
  let manualDueDay: Int?
  let manualCreditLimit: Double?
}
// AccountGroup { type, label, subtotal, isLiability, accounts }
// AccountsSummary { totalAssets, totalLiabilities, netWorth, accountCount, lastRefreshed: String? }
// RefreshResult { errors: [{ itemId, institution, error }] }  — other keys ignored
```

- Dates stay `String` in the model and are parsed by the formatters, matching the web code, which passes ISO strings around. This keeps decoding from failing on a date format the server changes.
- **`AccountPatch`** uses a three-state wrapper so "unchanged" (key omitted) differs from "cleared" (`null`):

```swift
enum PatchValue<T: Encodable> { case unchanged, set(T), clear }
struct AccountPatch: Encodable {
  var displayName: PatchValue<String> = .unchanged
  var manualDueDay: PatchValue<Int> = .unchanged
  var manualCreditLimit: PatchValue<Double> = .unchanged
  // custom encode(to:) — skips .unchanged keys, writes nil for .clear
  var isEmpty: Bool { ... }
}
```

---

## Screens

Standard iOS components throughout; no custom chrome. Dark mode and Dynamic Type come from the system.

### Root

`TabView` with two tabs, SF Symbols icons:

- **Accounts** — `building.columns`
- **Settings** — `gear`

If no server is configured, the app shows `ServerSetupView` full-screen instead of the tabs.

### Accounts (`NavigationStack`, large title "Accounts")

- **Net worth header** (first section of the list, no header text): net worth as the large figure; assets and liabilities beneath it, side by side, in secondary style.
- **One `List` section per `AccountGroup`**, `.insetGrouped`. Section header: group label on the left, subtotal on the right — shown negative for liability groups, as on the web (`isLiability ? -subtotal : subtotal`).
- **`AccountRow`**:
  - Title: `displayName ?? name`, one line, truncated.
  - Subtitle: `··mask · subtype · institution` (mask omitted when null; `subtype ?? type.lowercased()`).
  - Trailing: current balance, monospaced digits, shown negative for liabilities (`isLiability ? -currentBalance : currentBalance`), as on the web.
  - Third line when `PaymentStatus` returns one, coloured by tone: `.soon` → orange, `.overdue` → red, `.normal` → secondary.
  - Under the balance: "Available $X" ("Available credit $X" for liabilities), **only when it differs from the current balance** — for most cash accounts it just repeats the balance and squeezes the name at 402 pt. (A deliberate difference from the web, which always shows it.) The amount is `manualCreditLimit − currentBalance` when a manual limit is set, else `availableBalance` — the web's rule.
  - Tapping pushes `AccountEditView`.
- **Footer:** "Updated 5m ago" from `summary.lastRefreshed` (same wording as the web's `formatRelativeTime`).
- **Pull to refresh** (`.refreshable`): `refreshBalances()`, then `accounts()`. If the refresh returns per-bank `errors`, the reload still happens and a non-blocking banner lists the institutions that failed with their error code (e.g. "Chase — ITEM_LOGIN_REQUIRED"). Re-authenticating a bank stays on the Mac.
- **Reload triggers:** first appearance; `scenePhase` becoming `.active`; after a successful save in the edit view.
- **States:**
  - Loading with no data yet → `ProgressView`.
  - `.unreachable` / `.notConfigured` → `ContentUnavailableView` "Can't reach Budget", naming the server address, with **Retry**. The Settings tab stays visible beneath it, so no separate settings button.
  - `.server` / `.decoding` → `ContentUnavailableView` with the message and Retry.
  - Zero accounts → `ContentUnavailableView` "No accounts" — "Connect a bank from Budget on your Mac." (Plaid Link is not in the app.)
  - A failed reload **while data is showing** keeps the data and shows the banner rather than blanking the screen.

### Account edit (`Form`, pushed)

- **Name** — `TextField`, placeholder is the Plaid `name`. Empty clears the custom name.
- Credit accounts only:
  - **Due day** — `Picker` with "None" plus 1–31.
  - **Credit limit** — `TextField` with `.decimalPad`; empty clears it; must be ≥ 0.
- **Save** (toolbar, disabled until something changed and inputs are valid) builds an `AccountPatch` from the fields that differ from the loaded account, sends it, pops back, and triggers a reload. **Cancel** is the back button.
- Save failure shows an alert with the server's message; the form keeps the user's input.

### Settings

- **Server** — the URL field, with a **Save and Test Connection** button that calls `accounts()`, reports "Connected — N accounts" or the error, and saves the address only on success. Pressing Return in the field saves without testing.
- **About** — app version.

`ServerSetupView` is the same field and test button, presented on first launch with a short explanation and the `.local` hint.

---

## `PaymentStatus` — port of the web logic

A pure function, `paymentStatus(for: AccountDTO, now: Date, calendar: Calendar) -> PaymentStatus?`, returning `text` and `tone` (`.normal`, `.soon`, `.overdue`). `now` and `calendar` are parameters so tests are deterministic. It ports `paymentStatus`, `daysUntil` and `nextMonthlyOccurrence` from `src/components/AccountCard.tsx` and `src/lib/format.ts` exactly:

1. Not `CREDIT` → `nil`.
2. `manualDueDay` set → next occurrence of that day (clamped to month length, rolling to next month once today is past it), `"Payment due <date> · <rel> · manual"`; `.soon` when ≤ 7 days.
3. No `nextPaymentDueDate` → `nil`.
4. `paymentIsOverdue == true` → `"Payment overdue — was due <date><min>"`, `.overdue`. The date is not used to infer overdue.
5. Due date today or later → `"Payment due <date> · <rel><min>"`; `.soon` when ≤ 7 days.
6. Due date in the past, not overdue → project the due date's UTC day-of-month forward, `"Payment due <date> · <rel> · est."`.

**Known quirk, kept for parity:** `daysUntil` rounds up, so a payment due later *today* reads "in 1d"; one whose due time has already passed today reads "today". The web does the same. Fix both sides together if it is ever fixed.

Where `<rel>` is `today` or `in Nd`, `<min>` is `" · min $X"` when the minimum payment is > 0, and `<date>` is `Sep 26, 2026` (en_US, medium). `daysUntil` is `ceil((date − now) / 86 400 s)`, as on the web.

---

## Testing

**Unit (Swift Testing, `BudgetPhoneTests`):**

- `PaymentStatus`: every branch above, plus month-length clamping (day 31 in a 30-day month), December → January rollover, the 7-day boundary for `.soon`, and a zero minimum payment omitting the `min` suffix.
- Decoding: `Fixtures/accounts.json` (invented institutions and amounts, shaped like a real response, including `banks` and `debitCards` so their being ignored is tested) decodes into the models; a missing optional field decodes as `nil`.
- `AccountPatch` encoding: unchanged keys absent, cleared keys `null`, set keys present; an unchanged form is `isEmpty`.
- `ServerSettings` validation: accepts `http://host.local:3000` and `http://100.64.0.1:3000`, trims a trailing slash, rejects empty and scheme-less input.

**In the simulator:** iPhone 17 Pro (same 402×874 pt screen as the 16 Pro; no 16 Pro simulator is installed), against a running Budget server:

- Accounts loads and matches the web page's groups and totals.
- Pull to refresh completes and updates "Updated …".
- Editing a card's name, due day and limit round-trips, and the web page shows the change.
- Changing a field on the web while the app is backgrounded shows up on return to foreground.
- Stopping the server gives "Can't reach Budget"; Retry recovers once it is back.
- Light and dark mode, and the largest accessibility text size, screenshotted.

`npm test` (which includes the scrub check) and `xcodebuild test` both pass before merging.

**On the phone (user step):** documented in `ios/README.md` — open the project, choose the Personal Team under Signing, enable Developer Mode on the iPhone, press Run; re-run every 7 days.

---

## Out of scope for v1

Transactions and every other screen; authentication; Tailscale setup; connecting or re-authenticating banks (Plaid Link); a designed app icon; widgets, notifications, offline cache.
