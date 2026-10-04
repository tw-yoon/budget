# iPhone app opens instantly — plan

Spec: `docs/superpowers/specs/2026-10-04-ios-instant-launch-design.md` (read it first).

Branch `ios-instant-launch`, in its own worktree.
iOS code is under `ios/BudgetPhone`, tests under `ios/BudgetPhoneTests`.

## Global Constraints

- Read `ios/CLAUDE.md` first and follow it. Never edit
  `ios/BudgetPhone.xcodeproj/project.pbxproj` (new files join targets
  automatically by folder).
- Swift 6, iOS 26, Swift Testing. Stores are `@MainActor @Observable`.
  Inside `Task {}` use `do throws(APIError)`.
- Any test suite using `StubURLProtocol` nests under `StubbedNetworkTests`:
  `extension StubbedNetworkTests { @Suite(.serialized) struct X { … } }`.
- Tests that touch the cache use a fresh temporary directory per test
  (`FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)`),
  never the shared cache.
- Store failure rules (ios/CLAUDE.md) stay exactly as they are; saved data
  counts as "data showing".
- Never contact the live server at localhost:3000 from tests.
- Public repo: invented values only (`Sample Mart`, `Example Bank`).
- Test command, from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
  (a single suite: add `-only-testing:BudgetPhoneTests/<SuiteName>`).
- Before each commit: `bash scripts/test-scrub.sh` from the budget-claude
  folder. Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Match surrounding style: short doc comments explaining why, 2-space indent.

## Task 1: ResponseCache and APIClient plumbing

Create `ios/BudgetPhone/Networking/ResponseCache.swift`:

```swift
/// Last successful answers for the main screens' first loads, so a launch
/// shows them at once. docs/superpowers/specs/2026-10-04-ios-instant-launch-design.md
struct ResponseCache: Sendable {
  let root: URL
  static let shared = ResponseCache(root: <Caches>/Responses)
  /// Money data: unreadable while the phone is locked.
  static let writeOptions: Data.WritingOptions = [.atomic, .completeFileProtection]

  func read(_ name: String, request: String, owner: String) -> Data?
  func write(_ data: Data, name: String, request: String, owner: String)
  func clear()   // removes root entirely
}
```

- `owner` is an identity string built by `APIClient` from
  `baseURL.absoluteString + "\n" + (token ?? "")`. The folder is
  `root/<sha256 hex of owner>`. The token itself is never written to disk.
- `request` is the request's path plus query string (e.g.
  `api/transactions?page=1&...`). File name:
  `<name>-<first 16 hex of sha256(request)>.json`.
- `write` creates the folder, writes with `writeOptions`, then deletes every
  other `<name>-*.json` in that folder and every other owner folder under
  root. All errors are ignored (`try?`).
- `read` returns the bytes of exactly that file, or nil. It also removes
  other owner folders under root.
- Use CryptoKit SHA256 (see `CardArtCache.file(_:)` for the hex idiom).

In `APIClient.swift`:

- Add `var cache: ResponseCache? = nil` (after `token`).
- `APIClient.saved()` passes `cache: .shared`.
- Factor the URL-building in `sendRaw` (path + query + "+" → "%2B") into
  `func url(_ path: String, query: [URLQueryItem] = []) -> URL`, reused by
  `sendRaw`, so the cache key matches what was sent.
- Add:

```swift
/// A GET that decodes, then — only once it decoded — saves the bytes under
/// `saveAs` for `saved(_:_:query:)` to show at the next launch.
func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], timeout: TimeInterval,
                       saveAs name: String? = nil) async throws(APIError) -> T

/// The answer last saved for exactly this request, or nil. Bytes that no
/// longer decode count as nothing saved.
func saved<T: Decodable>(_ name: String, _ path: String, query: [URLQueryItem] = []) -> T?
```

  The request string used for both is the built URL's `path` + `?` +
  `percentEncodedQuery` (or relative path without host), so different
  servers never matter (owner handles that).

Tests: new `ios/BudgetPhoneTests/ResponseCacheTests.swift`.
- Plain suite (no network): write/read round trip; a different `request`
  under the same name reads nil and the newer write removes the older file;
  a different `owner` reads nil, and a write for owner B removes owner A's
  folder; `clear()` removes everything; `writeOptions` contains
  `.completeFileProtection`; the token string does not appear in any path
  under root.
- Under `StubbedNetworkTests`: `get(...saveAs:)` saves after a 200 and
  `saved` returns it; a 500 or undecodable 200 saves nothing; `saveAs: nil`
  saves nothing; a client with a different token reads nil.

Commit: "iOS: ResponseCache keeps the last answer for a request".

## Task 2: Save the main screens' first-load answers

Switch these endpoints to `get(..., saveAs:)` and add a matching
`saved…` reader next to each (same file):

| Function (file) | name | Reader |
|---|---|---|
| `accounts()` (APIClient.swift) | `accounts` | `savedAccounts() -> AccountsResponse?` |
| `transactions(_:page:)` (APIClient+Transactions.swift) | `ledger` only when `page == 1` and the query's search is empty; otherwise no save | `savedTransactions(_ query:) -> TransactionsResponse?` (page 1; nil when search is not empty) |
| `analytics(months:)` (APIClient+Analytics.swift) | `analytics` | `savedAnalytics(months:)` |
| `cashflow()` | `cashflow` | `savedCashflow()` |
| `spending()` | `spending` | `savedSpending()` |
| `subscriptions()` (APIClient+Subscriptions.swift) | `subscriptions` | `savedSubscriptions()` |
| `userCards()` (APIClient+Benefits.swift) | `cards` | `savedUserCards()` |
| `uiState(_:)` (APIClient+Transactions.swift) | `ui-state-<key>` only for `ProMode.key` and `ProMode.legacyKey` | `savedUIState(_ key:) -> UIStateValue?` |

Leave `APIClient+Connections.swift`'s accounts call unsaved. Check the search
field name in `TransactionQuery`.

Tests: new `ios/BudgetPhoneTests/SavedResponsesTests.swift` under
`StubbedNetworkTests`: for each row, a stubbed 200 then the reader returns
the same value; ledger page 2 and a non-empty search save nothing; a ledger
saved for one filter set reads nil for another; `uiState` for another key
(e.g. the spending limit key) saves nothing.

Commit: "iOS: save the answers each main screen opens with".

## Task 3: Stores show saved data first

In each store's first-load path, when nothing is showing, read the saved
answer synchronously before the network call and show it:

- `AccountsStore.load()`: after the `guard let client`, `if data == nil, let saved = client.savedAccounts() { data = saved }`.
- `TransactionsStore.reload()`: if `pages.isEmpty`, use
  `client.savedTransactions(query)` to set `pages`, `total`, `totalPages`.
- `AnalyticsStore.load(isPro:)`: if `summary == nil`, saved analytics for
  `range` (summary + topMerchants); if `cashflow == nil`, saved cashflow;
  if `isPro && spending == nil`, saved spending.
- `SubscriptionsStore.load()`, `BenefitsStore.load()` the same way
  (Benefits also calls `art.load` for the saved cards' art URLs).
- `ProMode.load()`: if `!hasLoaded`, resolve from saved ui-state (stored
  `pro-mode`, else legacy, exactly like the network path) and set `isPro`
  and `hasLoaded`.

The reads happen before any `await`, so the generation guards are
untouched. Everything else (banners, errors) stays as is: with saved data
showing, a failure is a banner.

Tests, each under `StubbedNetworkTests` with a temp-dir cache, added to the
existing store test files (`AccountsStoreTests`-style files exist for each
store; Accounts tests live in `NetworkTests.swift`): for Accounts,
Transactions, Analytics, Subscriptions, Benefits and ProMode —
1. saved data + network failing (`.unreachable` via a thrown URLError) →
   saved data shows, `error == nil`, banner set;
2. saved data + network held by a `Gate` → saved data is visible while the
   request is in flight, then replaced by the server's answer and the banner
   is nil;
3. nothing saved + failure → full-screen `error` as before;
4. a saved answer from a different token is not shown.

Commit: "iOS: show saved data at launch, refresh behind it".

## Task 4: Clear on server change, changelog

- `Settings/ServerForm.swift` `save()`: when the normalized address or the
  token differs from what was saved, call `ResponseCache.shared.clear()`
  before saving. (Reading already never crosses owners; this removes the old
  files from disk straight away.) Put the "did it change" decision in a
  small static func (e.g. `ServerForm.changed(oldServer:oldToken:newServer:newToken:) -> Bool`)
  with a plain unit test in `ServerAddressTests.swift` or a new file.
- `CHANGELOG.md` (budget-claude root): under `## Unreleased` at the top
  (create the heading above the newest version if missing), add a line in the
  file's existing style, e.g. "iPhone: opens instantly with the data from
  last time, then refreshes in the background. Saved data is cleared when the
  server or access token changes." Don't bump any version.

Run the full iOS test command and `npm test` from budget-claude; both pass.

Commit: "iOS: clear saved data when the server changes; changelog".
