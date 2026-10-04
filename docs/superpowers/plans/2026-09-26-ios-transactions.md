# iPhone App — Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web app's Transactions area — ledger, row detail, Venmo and Zelle — as native SwiftUI screens in the iPhone app, over the existing API.

**Architecture:** Builds on the Accounts app in `budget-claude/ios/`. Pure, unit-tested pieces first (ports of the web's ledger rules, models, query and request bodies, stores for the ledger, categories, Normal/Pro mode and the P2P feeds), then thin SwiftUI views. `APIClient` grows per-screen extensions over its shared `send`/`encode`/`decode`. No server changes.

**Tech Stack:** Swift 6, SwiftUI, Observation, Swift Testing, URLSession. iOS 26, Xcode 26.3.

**Spec:** `docs/superpowers/specs/2026-09-26-ios-transactions-design.md` (and `2026-09-26-ios-accounts-design.md`, which still binds).

**Provenance:** every file below was compiled and its tests run (108 test cases passing, three consecutive runs) on the iPhone 17 Pro simulator on 2026-09-26, and the finished screens were run against a live Budget server (ledger count and rows matched the web; detail and Venmo screens checked by hand). The code is meant to be used as written.

## Global Constraints

- Work in the `ios-transactions` worktree; never on `main` or `ios-accounts`. Paths are relative to `budget-claude/`; run `xcodebuild` from `budget-claude/ios/`.
- iOS 26.0, iPhone only, Swift 6 language mode, default actor isolation nonisolated (stores are `@MainActor` explicitly).
- No third-party packages; no `project.pbxproj` edits (folder-synchronized groups pick up new files).
- Public repo: no Team ID, hostname, home path, real names, institutions or amounts in tracked files. Fixtures are invented. `bash scripts/test-scrub.sh` must pass.
- No server changes. Every endpoint used exists today.
- Wording, order and rules match the web (named web sources are cited in each file's comments). Where the phone deliberately differs, the spec says so.
- Writes send exactly the web's bodies: `{category, subcategory}` / `{category: null}`, `{linkedToLabel}`, `{amount, category, subcategory}`, `{userCategory}`.
- Every test suite that uses `StubURLProtocol` nests under `StubbedNetworkTests` (a `.serialized` parent).
- Commit trailers name the model that actually wrote the commit.
- Test command (from `ios/`): `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`

## File map

| File | Responsibility |
|---|---|
| `Networking/APIClient.swift` (modify) | `send` (now with `query`), `decode`, new `encode` become internal for extensions |
| `Networking/APIClient+Transactions.swift` | Ledger, sync, category/link/split writes, link candidates, categories, ui-state |
| `Networking/APIClient+P2P.swift` | Venmo/Zelle list, category, import |
| `Shared/Banner.swift` | The warning banner, moved out of AccountsView for reuse |
| `Shared/ProMode.swift` | Normal/Pro, read from ui-state with the legacy fallback |
| `Support/LedgerRules.swift` | Ports: formatSignedAmount, isZelleName, isSplittable, categoryOptionsFor, split/joinCategory |
| `Models/TransactionModels.swift` | Transaction DTOs + row rules (label, badges, detail line) |
| `Models/P2PModels.swift` | P2P DTOs, totals, import notice, sources |
| `Transactions/TransactionQuery.swift` | Search/filters/sort and the query string |
| `Transactions/TransactionRequests.swift` | Write bodies |
| `Transactions/CategoryCatalog.swift` | Category names + known subcategories |
| `Transactions/TransactionsStore.swift` | Pages, stale responses, sync, writes, per-page reload |
| `Transactions/P2PStore.swift` | One P2P feed with optimistic category changes |
| `Transactions/TransactionRow.swift` | Row, category line, badge, `FlowLayout` |
| `Transactions/CategoryFields.swift`, `LinkPurchaseView.swift`, `AddSplitSheet.swift`, `TransactionDetailView.swift` | Row detail |
| `Transactions/P2PCategorizerView.swift`, `LedgerView.swift`, `TransactionsView.swift`, `App/RootView.swift` (modify) | Screens and the tab |
| `Accounts/AccountsView.swift` (modify) | Drops its private Banner |
| `BudgetPhoneTests/*` | New suites + fixtures; `TestSupport.swift` and `NetworkTests.swift` modified |
| `README.md` (modify) | Screens list |

---

### Task 1: Shared plumbing and the web's ledger rules

**Files:**
- Modify: `ios/BudgetPhone/Networking/APIClient.swift` (full replacement below)
- Modify: `ios/BudgetPhone/Accounts/AccountsView.swift` (remove its `private struct Banner`; full replacement below)
- Create: `ios/BudgetPhone/Shared/Banner.swift`, `ios/BudgetPhone/Support/LedgerRules.swift`
- Test: `ios/BudgetPhoneTests/LedgerRulesTests.swift`

**Interfaces:**
- Produces: `APIClient.send(_ method:, _ path:, query: [URLQueryItem] = [], body: Data? = nil, timeout:) async throws(APIError) -> Data`, `decode<T>(_:) throws(APIError) -> T`, `encode<T>(_:) throws(APIError) -> Data` (all internal); `struct Banner: View { init(text: String, dismiss: () -> Void) }`; `enum Ledger { signedAmount(_:) -> (text: String, isOutflow: Bool); isZelleName(_:) -> Bool; isSplittable(amount:pending:) -> Bool; categoryOptions(_:current:plaid:) -> [String] }`; `enum CategoryPath { separator; split(_:) -> (parent: String, sub: String?); join(_:_:) -> String }`.

Web sources to read first: `src/lib/format.ts` `formatSignedAmount`, `src/lib/zelle.ts` `isZelleName`, `src/lib/categories.ts` `splitCategory`/`joinCategory`, `src/components/TransactionTable.tsx` `isSplittable`/`categoryOptionsFor`, `scripts/test-zelle.mjs`.

- [ ] **Step 1: Write the failing tests**


`ios/BudgetPhoneTests/LedgerRulesTests.swift`:

```swift
import Testing
@testable import BudgetPhone

struct LedgerRulesTests {
  @Test func signedAmountFlipsPlaidsSign() {
    #expect(Ledger.signedAmount(84.12) == ("-$84.12", true))
    #expect(Ledger.signedAmount(-1500) == ("+$1,500.00", false))
    #expect(Ledger.signedAmount(0) == ("-$0.00", false))
  }

  // The same cases scripts/test-zelle.mjs uses.
  @Test(arguments: [
    "Zelle Instant Pmt To Jane Doe Usb0wbt3kq9",
    "Ref Zelle Standard Pmt From John Roe 0923",
    "ZELLE INSTANT PMT TO JANE DOE",
    "Zelle payment to Jane Doe JPM99bxk42q7",
    "Zelle payment from John Roe JPM99cmf3ab1",
  ])
  func zelleNames(_ name: String) {
    #expect(Ledger.isZelleName(name))
  }

  @Test(arguments: [
    "Paid back via zelle pmt",
    "Zelle",
    "Zellers Pmt To Store",
    "Zelle was down so paying here",
  ])
  func notZelleNames(_ name: String) {
    #expect(!Ledger.isZelleName(name))
  }

  @Test func onlyAPostedPurchaseIsSplittable() {
    #expect(Ledger.isSplittable(amount: 20, pending: false))
    #expect(!Ledger.isSplittable(amount: 20, pending: true))
    #expect(!Ledger.isSplittable(amount: -20, pending: false))
    #expect(!Ledger.isSplittable(amount: 0, pending: false))
  }

  @Test func categoryOptionsAddTheRowsOwnAndSort() {
    #expect(
      Ledger.categoryOptions(["Groceries", "Dining"], current: "Travel", plaid: "Dining")
        == ["Dining", "Groceries", "Travel"])
  }

  @Test func categoryPathSplitsAndJoins() {
    #expect(CategoryPath.split("Groceries") == ("Groceries", nil))
    #expect(CategoryPath.split("Groceries > Organic") == ("Groceries", "Organic"))
    #expect(CategoryPath.split("Groceries > ") == ("Groceries", nil))
    #expect(CategoryPath.join("Groceries", nil) == "Groceries")
    #expect(CategoryPath.join("Groceries", "  ") == "Groceries")
    #expect(CategoryPath.join("Groceries", " Organic ") == "Groceries > Organic")
  }
}
```


- [ ] **Step 2: Run to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `cannot find 'Ledger' in scope`, `cannot find 'CategoryPath' in scope`.

- [ ] **Step 3: Implement**

`send`/`decode` lose `private`, `send` gains `query`, and `encode` joins them so `APIClient+<Screen>.swift` extensions can use them; `updateAccount` now uses `encode`. The Banner moves verbatim from `AccountsView.swift` into `Shared/` (no longer `private`).


`ios/BudgetPhone/Networking/APIClient.swift` — full replacement:

```swift
import Foundation

enum APIError: Error, Equatable, Sendable {
  /// No server address saved yet.
  case notConfigured
  /// The request never got an HTTP answer: wrong address, Mac asleep, off
  /// the home network.
  case unreachable(String)
  /// A non-2xx answer. `message` is the route's `{ error }` when it sent one.
  case server(status: Int, message: String)
  /// A 2xx answer whose body didn't match the models.
  case decoding(String)
  /// The request was cancelled (the view disappeared, or a newer request
  /// superseded it) rather than actually failing. Never shown to the user:
  /// callers are expected to treat it as a silent no-op.
  case cancelled

  var message: String {
    switch self {
    case .notConfigured: "No server is set."
    case .unreachable(let m): m
    case .server(_, let m): m
    case .decoding(let m): "Unexpected response from the server. \(m)"
    case .cancelled: "Cancelled."
    }
  }
}

/// Calls against the web app's own API. The Accounts calls live here; each
/// other screen adds its own in an `APIClient+<Screen>.swift` extension,
/// all going through `send`, `encode` and `decode` below.
struct APIClient: Sendable {
  let baseURL: URL
  var session: URLSession = .shared

  func accounts() async throws(APIError) -> AccountsResponse {
    try decode(await send("GET", "api/accounts", timeout: 15))
  }

  /// Calls Plaid once per linked bank, hence the long timeout. A bank that
  /// fails comes back in `errors`; the call itself still succeeds.
  func refreshBalances() async throws(APIError) -> RefreshResult {
    try decode(await send("POST", "api/plaid/refresh-balances", body: Data("{}".utf8), timeout: 60))
  }

  func updateAccount(id: String, patch: AccountPatch) async throws(APIError) {
    _ = try await send("PATCH", "api/accounts/\(id)", body: encode(patch), timeout: 15)
  }

  private struct ErrorBody: Decodable { let error: String }

  /// `CancellationError` doesn't always survive the trip through
  /// `URLProtocolClient`'s Objective-C bridging with its native type intact
  /// — it can come back as a plain `NSError` in `Swift.CancellationError`'s
  /// domain instead. Check both forms, plus the `URLError` iOS itself uses
  /// when it cancels the underlying task.
  private static func isCancellation(_ error: Error) -> Bool {
    if error is CancellationError { return true }
    if let urlError = error as? URLError, urlError.code == .cancelled { return true }
    let nsError = error as NSError
    return nsError.domain == "Swift.CancellationError"
  }

  func send(
    _ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
    timeout: TimeInterval
  ) async throws(APIError) -> Data {
    var url = baseURL.appending(path: path)
    if !query.isEmpty { url.append(queryItems: query) }
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      if Self.isCancellation(error) { throw .cancelled }
      throw .unreachable(error.localizedDescription)
    }

    guard let http = response as? HTTPURLResponse else {
      throw .unreachable("No HTTP response.")
    }
    guard (200..<300).contains(http.statusCode) else {
      let message =
        (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
        ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
      throw .server(status: http.statusCode, message: message)
    }
    return data
  }

  func decode<T: Decodable>(_ data: Data) throws(APIError) -> T {
    do { return try JSONDecoder().decode(T.self, from: data) } catch {
      throw .decoding(String(describing: error))
    }
  }

  func encode<T: Encodable>(_ value: T) throws(APIError) -> Data {
    do { return try JSONEncoder().encode(value) } catch {
      throw .decoding(error.localizedDescription)
    }
  }
}
```


`ios/BudgetPhone/Accounts/AccountsView.swift` — full replacement:

```swift
import SwiftUI

struct AccountsView: View {
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var store = AccountsStore {
    ServerAddress.saved().map { APIClient(baseURL: $0) }
  }

  var body: some View {
    NavigationStack {
      content
        .navigationTitle("Accounts")
        .toolbar {
          // The web page's Refresh balances button. Pull-to-refresh does the
          // same, but a gesture nobody can see is not a substitute for it.
          ToolbarItem(placement: .topBarTrailing) {
            if store.isRefreshing {
              ProgressView()
            } else {
              Button("Refresh Balances", systemImage: "arrow.clockwise") {
                Task { await store.refresh() }
              }
              .disabled(store.data == nil)
            }
          }
        }
        .navigationDestination(for: AccountDTO.self) { account in
          AccountEditView(account: account, store: store)
        }
    }
    .task { await store.load() }
    // Another device may have changed something while this one was away.
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await store.load() } }
    }
    .onChange(of: server) { Task { await store.load() } }
  }

  @ViewBuilder private var content: some View {
    if let data = store.data {
      if data.summary.accountCount == 0 {
        ContentUnavailableView(
          "No Accounts", systemImage: "building.columns",
          description: Text("Connect a bank from Budget on your Mac."))
      } else {
        list(data)
      }
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView()
    }
  }

  private func list(_ data: AccountsResponse) -> some View {
    List {
      Section {
        NetWorthHeader(summary: data.summary)
      }
      ForEach(data.groups) { group in
        Section {
          ForEach(group.accounts) { account in
            NavigationLink(value: account) {
              AccountRow(account: account)
            }
          }
        } header: {
          GroupHeader(group: group)
        }
      }
    }
    .listStyle(.insetGrouped)
    .refreshable { await store.refresh() }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner {
        Banner(text: banner) { store.banner = nil }
      }
    }
  }
}

extension AccountDTO: Hashable {
  func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// A group's label and subtotal. Stacked at accessibility sizes so the
/// amount never wraps digit by digit inside the header's narrow width.
private struct GroupHeader: View {
  let group: AccountGroup
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let amount = Text(Formatters.currency(group.signedSubtotal))
      .monospacedDigit()
      .lineLimit(1)
      .minimumScaleFactor(0.6)
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) {
        Text(group.label)
        amount
      }
    } else {
      HStack {
        Text(group.label)
        Spacer()
        amount
      }
    }
  }
}

struct ErrorView: View {
  let error: APIError
  let server: String
  let retry: () -> Void

  var body: some View {
    switch error {
    case .notConfigured, .unreachable:
      ContentUnavailableView {
        Label("Can't Reach Budget", systemImage: "wifi.exclamationmark")
      } description: {
        Text("Make sure the Mac is awake, Budget is running, and this iPhone is on the same network.\n\n\(server)")
      } actions: {
        Button("Retry", action: retry).buttonStyle(.borderedProminent)
      }
    case .server, .decoding, .cancelled:
      ContentUnavailableView {
        Label("Something Went Wrong", systemImage: "exclamationmark.triangle")
      } description: {
        Text(error.message)
      } actions: {
        Button("Retry", action: retry).buttonStyle(.borderedProminent)
      }
    }
  }
}
```


`ios/BudgetPhone/Shared/Banner.swift`:

```swift
import SwiftUI

/// A dismissible warning over data that is still valid. Shared by every
/// screen that keeps showing what it has when a reload or write fails.
struct Banner: View {
  let text: String
  let dismiss: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
      Text(text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly)
        .foregroundStyle(.secondary)
    }
    .padding(12)
    .background(.regularMaterial, in: .rect(cornerRadius: 12))
    .padding(.horizontal)
  }
}
```


`ios/BudgetPhone/Support/LedgerRules.swift`:

```swift
import Foundation

// Ports of the web helpers the ledger's display rules depend on. Each keeps
// its web name in a comment so the two can be compared side by side.

enum Ledger {
  /// format.ts formatSignedAmount. Plaid's amount is positive for money out;
  /// the ledger flips it to the natural sign, and money in gets a "+".
  static func signedAmount(_ amount: Double) -> (text: String, isOutflow: Bool) {
    let display = -amount
    let sign = display > 0 ? "+" : ""
    return (sign + Formatters.currency(display), amount > 0)
  }

  /// zelle.ts isZelleName: `/^(ref\s+)?zelle\b.*\b(pmt|payment)\b/i`.
  static func isZelleName(_ name: String) -> Bool {
    name.range(of: #"^(ref\s+)?zelle\b.*\b(pmt|payment)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
  }

  /// TransactionTable.tsx isSplittable — `validateNewSplit`'s first two
  /// refusals: only a posted purchase can be split.
  static func isSplittable(amount: Double, pending: Bool) -> Bool {
    amount > 0 && !pending
  }

  /// TransactionTable.tsx categoryOptionsFor: the user's list plus whatever
  /// the row already shows, so nothing gets orphaned. Sorted.
  static func categoryOptions(_ categories: [String], current: String, plaid: String) -> [String] {
    Set(categories).union([current, plaid]).sorted { $0.localizedCompare($1) == .orderedAscending }
  }
}

/// categories.ts: a category value is "Parent" or "Parent > Sub".
enum CategoryPath {
  static let separator = " > "

  /// splitCategory.
  static func split(_ value: String) -> (parent: String, sub: String?) {
    guard let range = value.range(of: separator) else { return (value, nil) }
    let parent = value[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
    let sub = value[range.upperBound...].trimmingCharacters(in: .whitespaces)
    return (parent, sub.isEmpty ? nil : sub)
  }

  /// joinCategory.
  static func join(_ parent: String, _ sub: String?) -> String {
    let s = sub?.trimmingCharacters(in: .whitespaces) ?? ""
    return s.isEmpty ? parent : parent + separator + s
  }
}
```


- [ ] **Step 4: Run to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0; every suite passes, including the existing Accounts suites.

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Port the web ledger rules and open APIClient to extensions

Co-Authored-By: <your model's attribution line>"
```

---

### Task 2: Transaction models and row rules

**Files:**
- Create: `ios/BudgetPhone/Models/TransactionModels.swift`
- Test: `ios/BudgetPhoneTests/TransactionModelTests.swift`, `ios/BudgetPhoneTests/Fixtures/transactions.json`, `ios/BudgetPhoneTests/Fixtures/categories.json`
- Modify: `ios/BudgetPhoneTests/TestSupport.swift` (full replacement), `ios/BudgetPhoneTests/NetworkTests.swift` (full replacement — the same tests, now nested in `extension StubbedNetworkTests { … }`)

**Interfaces:**
- Consumes: `Ledger`, `CategoryPath`, `Formatters`, `Calendar.gregorianCurrent`.
- Produces: `TransactionDTO` (+ `LinkedTargetDTO`, `RefundDTO`, `SplitPartDTO`, `CashoutBreakdown`), `TransactionsResponse`, `SyncResult`, `LinkCandidate`, `LinkCandidatesResponse`, `CategoriesResponse`; on `TransactionDTO`: `title`, `isSplittable`, `isMoneyIn`, `categoryLabel`, `editableCategory`, `editableSubcategory`, `splitWays`, `splitIsShrunk`, `detailLine(calendar:)`, `badges: [Badge]` with `Badge { text; tone: BadgeTone }`, `BadgeTone { violet, green, amber, slate }`.
- Test helpers produced: `TestData.fixture(_:)`, `.transactions()`, `.transaction(_ id:)`, `.ledgerPage(_ ids:page:totalPages:total:)`, `.page(of:)`, `.query(of:_:)`, and the parent suite `@Suite(.serialized) enum StubbedNetworkTests {}`.

Fixtures are invented; keep them that way.

- [ ] **Step 1: Write the fixtures, the test helpers and the failing tests**


`ios/BudgetPhoneTests/Fixtures/transactions.json`:

```json
{
  "transactions": [
    {
      "id": "tx-split",
      "externalId": "ext-1",
      "accountId": "acc-card",
      "accountName": "Sample Rewards Card",
      "accountMask": "0002",
      "amount": 120.0,
      "date": "2026-09-20T12:00:00.000Z",
      "name": "SAMPLE MART #12",
      "merchantName": "Sample Mart",
      "category": "Groceries",
      "categoryDetailed": "Groceries",
      "userCategory": null,
      "plaidCategory": "Groceries",
      "plaidCategoryDetailed": null,
      "logoUrl": null,
      "pending": false,
      "isTransfer": false,
      "isFee": false,
      "personalNote": null,
      "source": "PLAID",
      "label": 726,
      "linkedTo": null,
      "refunds": [],
      "netAmount": 120.0,
      "splits": [
        {
          "id": "sp-1",
          "amount": 80,
          "category": "Household",
          "subcategory": null,
          "userCategory": "Household"
        },
        {
          "id": "sp-2",
          "amount": 50,
          "category": "Groceries",
          "subcategory": "Organic",
          "userCategory": "Groceries > Organic"
        }
      ],
      "splitRemainder": -10.0,
      "breakdown": null
    },
    {
      "id": "tx-refund",
      "externalId": "ext-2",
      "accountId": "acc-card",
      "accountName": "Sample Rewards Card",
      "accountMask": "0002",
      "amount": -25.5,
      "date": "2026-09-20T12:00:00.000Z",
      "name": "REFUND SAMPLE STORE",
      "merchantName": null,
      "category": "Shopping",
      "categoryDetailed": null,
      "userCategory": null,
      "plaidCategory": "Shopping",
      "plaidCategoryDetailed": null,
      "logoUrl": null,
      "pending": false,
      "isTransfer": false,
      "isFee": false,
      "personalNote": null,
      "source": "PLAID",
      "label": 725,
      "linkedTo": {
        "id": "tx-purchase",
        "label": 700,
        "name": "Sample Store",
        "category": "Shopping"
      },
      "refunds": [],
      "netAmount": -25.5,
      "splits": [],
      "splitRemainder": null,
      "breakdown": null
    },
    {
      "id": "tx-purchase",
      "externalId": "ext-3",
      "accountId": "acc-card",
      "accountName": "Sample Rewards Card",
      "accountMask": "0002",
      "amount": 60.0,
      "date": "2026-09-20T12:00:00.000Z",
      "name": "SAMPLE STORE",
      "merchantName": "Sample Store",
      "category": "Shopping",
      "categoryDetailed": "Clothing",
      "userCategory": "Shopping > Clothes",
      "plaidCategory": "Shopping",
      "plaidCategoryDetailed": null,
      "logoUrl": null,
      "pending": false,
      "isTransfer": false,
      "isFee": false,
      "personalNote": null,
      "source": "PLAID",
      "label": 700,
      "linkedTo": null,
      "refunds": [
        {
          "id": "tx-refund",
          "label": 725,
          "date": "2026-09-21T12:00:00.000Z",
          "amount": -25.5,
          "name": "REFUND SAMPLE STORE"
        }
      ],
      "netAmount": 34.5,
      "splits": [],
      "splitRemainder": null,
      "breakdown": null
    },
    {
      "id": "tx-cashout",
      "externalId": "ext-4",
      "accountId": "acc-checking",
      "accountName": "Everyday Checking",
      "accountMask": "0001",
      "amount": -300.0,
      "date": "2026-09-20T12:00:00.000Z",
      "name": "VENMO CASHOUT",
      "merchantName": null,
      "category": "Transfer",
      "categoryDetailed": null,
      "userCategory": null,
      "plaidCategory": "Transfer In",
      "plaidCategoryDetailed": null,
      "logoUrl": null,
      "pending": false,
      "isTransfer": true,
      "isFee": false,
      "personalNote": null,
      "source": "PLAID",
      "label": 690,
      "linkedTo": null,
      "refunds": [],
      "netAmount": -300.0,
      "splits": [],
      "splitRemainder": null,
      "breakdown": {
        "slices": [
          {
            "category": "Dining",
            "amount": 180.0
          },
          {
            "category": "Travel",
            "amount": 100.0
          }
        ],
        "priorBalance": 20.0
      }
    },
    {
      "id": "tx-pending",
      "externalId": "ext-5",
      "accountId": "acc-checking",
      "accountName": "Everyday Checking",
      "accountMask": "0001",
      "amount": 45.0,
      "date": "2026-09-20T12:00:00.000Z",
      "name": "Zelle payment to Sample Person JPM99abc",
      "merchantName": null,
      "category": "Transfer",
      "categoryDetailed": null,
      "userCategory": null,
      "plaidCategory": "Shopping",
      "plaidCategoryDetailed": null,
      "logoUrl": null,
      "pending": true,
      "isTransfer": true,
      "isFee": false,
      "personalNote": null,
      "source": "PLAID",
      "label": null,
      "linkedTo": null,
      "refunds": [],
      "netAmount": 45.0,
      "splits": [],
      "splitRemainder": null,
      "breakdown": null
    }
  ],
  "page": 1,
  "limit": 50,
  "total": 5,
  "totalPages": 1
}
```


`ios/BudgetPhoneTests/Fixtures/categories.json`:

```json
{
  "categories": [
    {
      "id": "c1",
      "name": "Groceries",
      "plaidPrimaries": [
        "FOOD_AND_DRINK"
      ],
      "transactionCount": 3,
      "ruleCount": 0,
      "resolvedTransactionCount": 3,
      "subcategories": [
        {
          "name": "Organic",
          "transactionCount": 1
        }
      ],
      "splitCount": 1
    },
    {
      "id": "c2",
      "name": "Dining",
      "plaidPrimaries": [],
      "transactionCount": 0,
      "ruleCount": 0,
      "resolvedTransactionCount": 0,
      "subcategories": [],
      "splitCount": 0
    }
  ],
  "primaries": [
    "FOOD_AND_DRINK"
  ],
  "unmappedPrimaries": []
}
```


`ios/BudgetPhoneTests/TestSupport.swift` — full replacement:

```swift
import Foundation
import Testing
@testable import BudgetPhone

enum TestData {
  /// The invented response in Fixtures/accounts.json.
  static func accountsJSON() throws -> Data {
    let url = try #require(Bundle(for: BundleToken.self).url(forResource: "accounts", withExtension: "json"))
    return try Data(contentsOf: url)
  }

  static func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle(for: BundleToken.self).url(forResource: name, withExtension: "json"))
    return try Data(contentsOf: url)
  }

  /// The invented ledger page in Fixtures/transactions.json: a split with a
  /// shrunk remainder, a linked refund, the purchase it refunds, a Venmo
  /// cash-out with a breakdown, and a pending Zelle payment.
  static func transactions() throws -> TransactionsResponse {
    try JSONDecoder().decode(TransactionsResponse.self, from: fixture("transactions"))
  }

  static func transaction(_ id: String) throws -> TransactionDTO {
    try #require(transactions().transactions.first { $0.id == id })
  }

  /// A ledger page of copies of the fixture's first row, one per id, as the
  /// JSON the server would send.
  static func ledgerPage(_ ids: [String], page: Int, totalPages: Int, total: Int? = nil) throws -> Data {
    let root = try #require(
      JSONSerialization.jsonObject(with: fixture("transactions")) as? [String: Any])
    let template = try #require((root["transactions"] as? [[String: Any]])?.first)
    let rows = ids.map { id -> [String: Any] in
      var row = template
      row["id"] = id
      return row
    }
    return try JSONSerialization.data(withJSONObject: [
      "transactions": rows, "page": page, "limit": 50,
      "total": total ?? ids.count, "totalPages": totalPages,
    ])
  }

  /// The `page` query item of a stubbed request, for handlers that answer
  /// per page.
  static func page(of request: URLRequest) -> Int {
    let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
    return items.first { $0.name == "page" }.flatMap { $0.value.flatMap(Int.init) } ?? 0
  }

  static func query(of request: URLRequest, _ name: String) -> String? {
    URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
      .queryItems?.first { $0.name == name }?.value
  }

  static func accounts() throws -> AccountsResponse {
    try JSONDecoder().decode(AccountsResponse.self, from: accountsJSON())
  }

  /// A credit account with every due-date field at a neutral default.
  static func card(
    manualDueDay: Int? = nil,
    nextPaymentDueDate: String? = nil,
    minimumPaymentAmount: Double? = nil,
    paymentIsOverdue: Bool? = nil,
    displayName: String? = nil,
    manualCreditLimit: Double? = nil,
    type: String = "CREDIT"
  ) -> AccountDTO {
    AccountDTO(
      id: "card", name: "Sample Card", officialName: nil, mask: "0002", type: type,
      subtype: "credit card", currentBalance: 100, availableBalance: 900,
      balanceFetchedAt: "2026-09-26T15:00:00.000Z", institution: "Sample Card Co",
      isLiability: type == "CREDIT", nextPaymentDueDate: nextPaymentDueDate,
      lastStatementBalance: nil, minimumPaymentAmount: minimumPaymentAmount,
      paymentIsOverdue: paymentIsOverdue, displayName: displayName,
      manualDueDay: manualDueDay, manualCreditLimit: manualCreditLimit)
  }
}

private final class BundleToken {}

/// Every suite that uses StubURLProtocol nests in here. `.serialized` on a
/// parent runs its child suites one at a time as well; without it, two
/// stubbed suites run side by side and answer each other's requests through
/// the one shared handler.
@Suite(.serialized) enum StubbedNetworkTests {}

/// Answers URLSession requests from a handler instead of the network, and
/// records what was sent. Tests that use it are `.serialized`, since the
/// handler is shared.
final class StubURLProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
  nonisolated(unsafe) static var requests: [URLRequest] = []

  static func session(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> URLSession {
    self.handler = handler
    requests = []
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubURLProtocol.self]
    return URLSession(configuration: config)
  }

  /// URLSession moves the body into a stream before it reaches a protocol.
  static func body(of request: URLRequest) -> Data? {
    if let data = request.httpBody { return data }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let n = stream.read(&buffer, maxLength: buffer.count)
      if n <= 0 { break }
      data.append(buffer, count: n)
    }
    return data
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.requests.append(request)
    do {
      let (status, data) = try Self.handler!(request)
      let response = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}
```


`ios/BudgetPhoneTests/NetworkTests.swift` — full replacement:

```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// APIClient and AccountsStore against StubURLProtocol. Serialized because
  /// the stub's handler is shared state.
  @Suite(.serialized)
  @MainActor
  struct NetworkTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    @Test func accountsHitsTheRightURLAndDecodes() async throws {
      let json = try TestData.accountsJSON()
      let response = try await client { _ in (200, json) }.accounts()
      #expect(response.summary.accountCount == 2)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "GET")
      #expect(request.url?.absoluteString == "http://budget-mac.local:3000/api/accounts")
    }

    @Test func updateSendsOnlyThePatchKeys() async throws {
      try await client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
        .updateAccount(id: "acc-card", patch: AccountPatch(manualCreditLimit: .set(6000)))
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "PATCH")
      #expect(request.url?.path() == "/api/accounts/acc-card")
      let body = try #require(StubURLProtocol.body(of: request))
      #expect(String(decoding: body, as: UTF8.self) == #"{"manualCreditLimit":6000}"#)
    }

    @Test func serverErrorCarriesTheRoutesMessage() async {
      let c = client { _ in (400, Data(#"{"error":"manualDueDay must be a whole number from 1 to 31"}"#.utf8)) }
      await #expect(throws: APIError.server(status: 400, message: "manualDueDay must be a whole number from 1 to 31")) {
        try await c.updateAccount(id: "x", patch: AccountPatch(manualDueDay: .set(40)))
      }
    }

    @Test func connectionFailureIsUnreachable() async {
      let c = client { _ in throw URLError(.cannotConnectToHost) }
      do {
        _ = try await c.accounts()
        Issue.record("expected a throw")
      } catch {
        guard case .unreachable = error else {
          Issue.record("expected .unreachable, got \(error)")
          return
        }
      }
    }

    @Test func wrongShapeIsDecoding() async {
      let c = client { _ in (200, Data(#"{"nope":1}"#.utf8)) }
      do {
        _ = try await c.accounts()
        Issue.record("expected a throw")
      } catch {
        guard case .decoding = error else {
          Issue.record("expected .decoding, got \(error)")
          return
        }
      }
    }

    @Test func storeWithoutAServerIsNotConfigured() async {
      let store = AccountsStore { nil }
      await store.load()
      #expect(store.error == .notConfigured)
      #expect(store.data == nil)
    }

    @Test func firstLoadFailureIsFullScreenLaterFailureIsABanner() async throws {
      let json = try TestData.accountsJSON()
      var fail = true
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        return (200, json)
      }
      let store = AccountsStore { c }

      await store.load()
      #expect(store.data == nil)
      #expect(store.error != nil)

      fail = false
      await store.load()
      #expect(store.data != nil)
      #expect(store.error == nil)

      fail = true
      await store.load()
      #expect(store.data != nil, "a failed reload keeps what is on screen")
      #expect(store.error == nil)
      #expect(store.banner != nil)
    }

    @Test func refreshNamesFailedBanksAndStillReloads() async throws {
      let json = try TestData.accountsJSON()
      let refresh = #"{"updated":[],"liabilities":[],"errors":[{"itemId":"i1","institution":"Example Bank","error":"ITEM_LOGIN_REQUIRED"}]}"#
      let c = client { request in
        request.httpMethod == "POST" ? (200, Data(refresh.utf8)) : (200, json)
      }
      let store = AccountsStore { c }
      await store.refresh()
      #expect(store.banner == "Couldn't refresh Example Bank (ITEM_LOGIN_REQUIRED)")
      #expect(store.data?.summary.accountCount == 2)
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["POST", "GET"])
    }

    @Test func saveSkipsAnEmptyPatchAndReloadsAfterARealOne() async throws {
      let json = try TestData.accountsJSON()
      let c = client { request in
        request.httpMethod == "PATCH" ? (200, Data(#"{"ok":true}"#.utf8)) : (200, json)
      }
      let store = AccountsStore { c }
      let card = try TestData.accounts().groups[1].accounts[0]

      try await store.save(AccountPatch(), to: card)
      #expect(StubURLProtocol.requests.isEmpty)

      try await store.save(AccountPatch(displayName: .set("Travel")), to: card)
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["PATCH", "GET"])
    }

    // MARK: - F2a: progress instead of a stale error while a load is in flight

    @Test func aNewLoadWithNoDataClearsThePriorErrorWhileInFlight() async throws {
      let json = try TestData.accountsJSON()
      var fail = true
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        Thread.sleep(forTimeInterval: 0.05)
        return (200, json)
      }
      let store = AccountsStore { c }

      await store.load()
      #expect(store.error != nil)

      fail = false
      let task = Task { await store.load() }
      try await Task.sleep(for: .milliseconds(10))
      #expect(store.error == nil, "a new load with no data on screen should clear the old error, not leave it showing")
      #expect(store.isLoading)
      await task.value
      #expect(store.data != nil)
    }

    // MARK: - Visible refresh button

    @Test func refreshIsFlaggedWhileInFlightAndASecondTapIsIgnored() async throws {
      let json = try TestData.accountsJSON()
      let refresh = #"{"updated":[],"liabilities":[],"errors":[]}"#
      let c = client { request in
        if request.httpMethod == "POST" {
          Thread.sleep(forTimeInterval: 0.05)
          return (200, Data(refresh.utf8))
        }
        return (200, json)
      }
      let store = AccountsStore { c }
      #expect(store.isRefreshing == false)

      let first = Task { await store.refresh() }
      try await Task.sleep(for: .milliseconds(10))
      #expect(store.isRefreshing, "the toolbar shows progress while Plaid is being asked")
      await store.refresh()  // a second tap while the first is running
      await first.value

      #expect(store.isRefreshing == false)
      #expect(StubURLProtocol.requests.filter { $0.httpMethod == "POST" }.count == 1)
      #expect(store.data != nil)
    }

    // MARK: - F2b: a stale banner doesn't survive a later successful load

    @Test func aSuccessfulLoadClearsABannerLeftByAnEarlierFailedReload() async throws {
      let json = try TestData.accountsJSON()
      var fail = false
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        return (200, json)
      }
      let store = AccountsStore { c }

      await store.load()
      #expect(store.data != nil)

      fail = true
      await store.load()
      #expect(store.banner != nil, "a failed reload over existing data should set the banner")

      fail = false
      await store.load()
      #expect(store.banner == nil, "a later successful load must clear the stale banner")
    }

    @Test func refreshClearsAnExistingBannerBeforeRunningButItsOwnBannerSurvivesTheReload() async throws {
      let json = try TestData.accountsJSON()
      let refresh = #"{"updated":[],"liabilities":[],"errors":[{"itemId":"i1","institution":"Example Bank","error":"ITEM_LOGIN_REQUIRED"}]}"#
      let c = client { request in
        request.httpMethod == "POST" ? (200, Data(refresh.utf8)) : (200, json)
      }
      let store = AccountsStore { c }
      store.banner = "a stale banner from earlier"

      await store.refresh()
      #expect(store.banner == "Couldn't refresh Example Bank (ITEM_LOGIN_REQUIRED)",
        "refresh's own banner must survive the reload it triggers, not just the stale one it cleared")
    }

    // MARK: - F2c: cancellation is a silent no-op, not a failure

    @Test func cancelledRequestSurfacesAsAPIErrorCancelled() async {
      let c = client { _ in throw URLError(.cancelled) }
      await #expect(throws: APIError.cancelled) {
        _ = try await c.accounts()
      }
    }

    @Test func cancellationWithNoDataOnScreenShowsNoError() async {
      let c = client { _ in throw URLError(.cancelled) }
      let store = AccountsStore { c }
      await store.load()
      #expect(store.error == nil)
      #expect(store.data == nil)
    }

    @Test func swiftCancellationErrorIsAlsoSilent() async {
      let c = client { _ in throw CancellationError() }
      let store = AccountsStore { c }
      await store.load()
      #expect(store.error == nil)
      #expect(store.data == nil)
    }

    @Test func cancellationDuringAReloadLeavesTheBannerAndDataAlone() async throws {
      let json = try TestData.accountsJSON()
      var shouldCancel = false
      let c = client { _ in
        if shouldCancel { throw URLError(.cancelled) }
        return (200, json)
      }
      let store = AccountsStore { c }
      await store.load()
      #expect(store.data != nil)

      shouldCancel = true
      await store.load()
      #expect(store.banner == nil)
      #expect(store.data != nil)
    }

    // MARK: - F2d: only the latest load's result is applied

    @Test func outOfOrderLoadsKeepOnlyTheLatestRequestsResult() async throws {
      let olderJSON = try TestData.accountsJSON()  // accountCount 2
      let newerJSON = Data(
        #"{"groups":[],"summary":{"totalAssets":0,"totalLiabilities":0,"netWorth":0,"accountCount":0,"lastRefreshed":null}}"#
          .utf8)
      let lock = NSLock()
      var callCount = 0
      let c = client { _ in
        lock.lock()
        callCount += 1
        let n = callCount
        lock.unlock()
        if n == 1 {
          Thread.sleep(forTimeInterval: 0.05)
          return (200, olderJSON)
        }
        return (200, newerJSON)
      }
      let store = AccountsStore { c }

      let firstLoad = Task { await store.load() }
      try await Task.sleep(for: .milliseconds(10))
      await store.load()
      await firstLoad.value

      #expect(
        store.data?.summary.accountCount == 0,
        "the second load started later and must win even though the first, slower response arrived after it")
    }
  }
}
```


`ios/BudgetPhoneTests/TransactionModelTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

struct TransactionModelTests {
  @Test func decodesALedgerPage() throws {
    let page = try TestData.transactions()
    #expect(page.transactions.count == 5)
    #expect(page.totalPages == 1)
    let split = try TestData.transaction("tx-split")
    #expect(split.splits.map(\.id) == ["sp-1", "sp-2"])
    #expect(split.splitRemainder == -10)
    #expect(try TestData.transaction("tx-cashout").breakdown?.priorBalance == 20)
    #expect(try TestData.transaction("tx-pending").label == nil)
  }

  @Test func decodesCategoriesKeepingOnlyNames() throws {
    let r = try JSONDecoder().decode(CategoriesResponse.self, from: TestData.fixture("categories"))
    #expect(r.categories.map(\.name) == ["Groceries", "Dining"])
    #expect(r.categories[0].subcategories.map(\.name) == ["Organic"])
  }

  @Test func categoryLabelFollowsTheWeb() throws {
    #expect(try TestData.transaction("tx-purchase").categoryLabel == "Shopping > Clothes")
    #expect(try TestData.transaction("tx-split").categoryLabel == "Groceries")
    #expect(try TestData.transaction("tx-refund").categoryLabel == "Shopping")
    let purchase = try TestData.transaction("tx-purchase")
    #expect(purchase.editableCategory == "Shopping")
    #expect(purchase.editableSubcategory == "Clothes")
  }

  @Test func badgesMatchRowBadges() throws {
    func texts(_ id: String) throws -> [String] { try TestData.transaction(id).badges.map(\.text) }
    #expect(try texts("tx-split") == ["Split 3 ways"])
    #expect(try TestData.transaction("tx-split").badges[0].tone == .amber)
    #expect(try texts("tx-refund") == ["→ #700"])
    #expect(try texts("tx-cashout") == ["2 categories"])
    #expect(try texts("tx-pending") == ["Zelle", "Pending", "Transfer"])
    #expect(try texts("tx-purchase").isEmpty)
  }

  @Test func detailLineUsesSerialDateAndAccount() throws {
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = .gmt
    #expect(try TestData.transaction("tx-split").detailLine(calendar: utc)
      == "#726 · Sep 20, 2026 · Sample Rewards Card ··0002")
    #expect(try TestData.transaction("tx-pending").detailLine(calendar: utc)
      == "#— · Sep 20, 2026 · Everyday Checking ··0001")
  }

  @Test func splittableAndDirection() throws {
    #expect(try TestData.transaction("tx-split").isSplittable)
    #expect(try !TestData.transaction("tx-pending").isSplittable)
    #expect(try TestData.transaction("tx-refund").isMoneyIn)
  }
}
```


- [ ] **Step 2: Run to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `cannot find type 'TransactionsResponse' in scope`.

- [ ] **Step 3: Implement**

The DTOs mirror `src/types/index.ts`. `categoryLabel` and `badges` port the row rendering in `src/components/TransactionTable.tsx` (`RowBadges` and the category line), in the same order and wording.


`ios/BudgetPhone/Models/TransactionModels.swift`:

```swift
import Foundation

// Mirrors of src/types/index.ts for the Transactions area. Property names
// match the JSON keys; dates stay ISO strings, as in the web code.

struct LinkedTargetDTO: Codable, Equatable, Sendable {
  let id: String
  let label: Int?
  let name: String
  let category: String
}

struct RefundDTO: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let label: Int?
  let date: String
  let amount: Double  // negative (money in)
  let name: String
}

struct SplitPartDTO: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let amount: Double  // positive
  let category: String
  let subcategory: String?
  let userCategory: String
}

struct CashoutBreakdown: Codable, Equatable, Sendable {
  struct Slice: Codable, Equatable, Sendable {
    let category: String
    let amount: Double
  }
  let slices: [Slice]
  let priorBalance: Double
}

struct TransactionDTO: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let externalId: String
  let accountId: String
  let accountName: String
  let accountMask: String?
  let amount: Double  // Plaid's sign: positive = money out
  let date: String
  let name: String
  let merchantName: String?
  let category: String
  let categoryDetailed: String?
  let userCategory: String?
  let plaidCategory: String
  let plaidCategoryDetailed: String?
  let logoUrl: String?
  let pending: Bool
  let isTransfer: Bool
  let isFee: Bool
  let personalNote: String?
  let source: String  // PLAID | VENMO
  let label: Int?
  let linkedTo: LinkedTargetDTO?
  let refunds: [RefundDTO]
  let netAmount: Double
  let splits: [SplitPartDTO]
  let splitRemainder: Double?
  let breakdown: CashoutBreakdown?
}

struct TransactionsResponse: Codable, Equatable, Sendable {
  let transactions: [TransactionDTO]
  let page: Int
  let limit: Int
  let total: Int
  let totalPages: Int
}

/// POST /api/plaid/sync.
struct SyncResult: Decodable, Equatable, Sendable {
  struct Item: Decodable, Equatable, Sendable {
    let itemId: String
    let institution: String
    let success: Bool
    let error: String?
    let skipped: Bool?
  }
  let summary: [Item]
}

/// GET /api/transactions/:id/link-candidates.
struct LinkCandidate: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let label: Int?
  let date: String
  let name: String
  let amount: Double
  let category: String
}

struct LinkCandidatesResponse: Decodable, Sendable {
  let candidates: [LinkCandidate]
}

/// GET /api/categories. Only the names are used here; the counts and Plaid
/// mappings are for the Settings screen.
struct CategoriesResponse: Decodable, Sendable {
  struct Category: Decodable, Sendable {
    struct Sub: Decodable, Sendable { let name: String }
    let name: String
    let subcategories: [Sub]
  }
  let categories: [Category]
}

// MARK: - Row rules

extension TransactionDTO {
  var title: String { merchantName ?? name }
  var isSplittable: Bool { Ledger.isSplittable(amount: amount, pending: pending) }
  var isMoneyIn: Bool { amount < 0 }

  /// The web's category line: the user's "Parent > Sub" when overridden,
  /// else Plaid's detailed category, else its primary.
  var categoryLabel: String {
    if let raw = userCategory {
      let (parent, sub) = CategoryPath.split(raw)
      return sub.map { "\(parent) > \($0)" } ?? parent
    }
    return categoryDetailed ?? category
  }

  /// The parent category the editor starts on.
  var editableCategory: String {
    userCategory.map { CategoryPath.split($0).parent } ?? category
  }

  var editableSubcategory: String? {
    userCategory.flatMap { CategoryPath.split($0).sub }
  }

  /// The parts plus the leftover, when there is a leftover line to draw.
  var splitWays: Int { splits.count + (splitRemainder == nil ? 0 : 1) }

  /// The amount has shrunk below its splits since they were made.
  var splitIsShrunk: Bool { (splitRemainder ?? 0) < 0 }

  /// `#101 · Sep 23, 2026 · Sample Rewards Card ··0002`
  func detailLine(calendar: Calendar = .gregorianCurrent) -> String {
    var parts = ["#\(label.map(String.init) ?? "—")"]
    if let d = Formatters.parseISO(date) { parts.append(Formatters.date(d, calendar: calendar)) }
    parts.append(accountName + (accountMask.map { " ··\($0)" } ?? ""))
    return parts.joined(separator: " · ")
  }

  enum BadgeTone: Equatable, Sendable { case violet, green, amber, slate }
  struct Badge: Equatable, Sendable {
    let text: String
    let tone: BadgeTone
  }

  /// RowBadges in TransactionTable.tsx, same order and wording.
  var badges: [Badge] {
    var b: [Badge] = []
    if source == "VENMO" { b.append(Badge(text: "Venmo", tone: .violet)) }
    if source != "VENMO" && Ledger.isZelleName(name) { b.append(Badge(text: "Zelle", tone: .violet)) }
    if let linkedTo { b.append(Badge(text: "→ #\(linkedTo.label.map(String.init) ?? "?")", tone: .green)) }
    if pending { b.append(Badge(text: "Pending", tone: .amber)) }
    if isTransfer && breakdown == nil { b.append(Badge(text: "Transfer", tone: .slate)) }
    if let breakdown { b.append(Badge(text: "\(breakdown.slices.count) categories", tone: .slate)) }
    if !splits.isEmpty {
      b.append(Badge(text: splitWays == 1 ? "Split 1 way" : "Split \(splitWays) ways",
                     tone: splitIsShrunk ? .amber : .slate))
    }
    if isFee { b.append(Badge(text: "Fee", tone: .slate)) }
    return b
  }
}
```


- [ ] **Step 4: Run to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Add the iPhone app's transaction models and row rules

Co-Authored-By: <your model's attribution line>"
```

---

### Task 3: Ledger query, write bodies and API calls

**Files:**
- Create: `ios/BudgetPhone/Transactions/TransactionQuery.swift`, `ios/BudgetPhone/Transactions/TransactionRequests.swift`, `ios/BudgetPhone/Networking/APIClient+Transactions.swift`
- Test: `ios/BudgetPhoneTests/TransactionRequestTests.swift`

**Interfaces:**
- Produces: `struct TransactionQuery: Equatable, Codable { search; accountId: String?; hideInternal = true; showLinked = false; sort: Sort = .date; ascending = false; static pageSize = 50; filtersAreDefault; queryItems(page:) -> [URLQueryItem] }`, `enum Sort: String { date, label }`; `CategoryUpdate.set(_:subcategory:)` / `.reset`; `LinkUpdate(linkedToLabel: Int?)`; `NewSplit(amount:category:subcategory:)`; `UIStateValue { isStored: Bool; string: String? }`; on `APIClient`: `transactions(_:page:)`, `syncTransactions()`, `updateCategory(transactionId:_:)`, `updateLink(transactionId:_:)`, `linkCandidates(transactionId:)`, `addSplit(transactionId:_:)`, `deleteSplit(transactionId:splitId:)`, `categories()`, `uiState(_:) -> UIStateValue`.

Web sources: `src/components/TransactionLedger.tsx` (the `URLSearchParams`), `src/app/api/transactions/route.ts`, `src/app/api/transactions/[id]/route.ts`, `…/splits/route.ts`, `…/splits/[splitId]/route.ts`, `…/link-candidates/route.ts`, `src/app/api/ui-state/route.ts`, `src/components/useProMode.ts`.

- [ ] **Step 1: Write the failing tests**


`ios/BudgetPhoneTests/TransactionRequestTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

struct TransactionRequestTests {
  func json<T: Encodable>(_ value: T) throws -> String {
    let e = JSONEncoder()
    e.outputFormatting = .sortedKeys
    return String(decoding: try e.encode(value), as: UTF8.self)
  }

  func dict(_ items: [URLQueryItem]) -> [String: String] {
    Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
  }

  @Test func defaultQueryMatchesTheWeb() {
    let items = TransactionQuery().queryItems(page: 1)
    #expect(items.map(\.name) == ["page", "limit", "hideInternal", "hideLinked", "sort", "dir"])
    #expect(dict(items) == [
      "page": "1", "limit": "50", "hideInternal": "true", "hideLinked": "true",
      "sort": "date", "dir": "desc",
    ])
    #expect(TransactionQuery().filtersAreDefault)
  }

  @Test func everyFilterMapsToItsParameter() {
    var q = TransactionQuery()
    q.search = "  sample mart "
    q.accountId = "acc-card"
    q.hideInternal = false
    q.showLinked = true
    q.sort = .label
    q.ascending = true
    #expect(dict(q.queryItems(page: 3)) == [
      "page": "3", "limit": "50", "hideInternal": "false", "hideLinked": "false",
      "sort": "label", "dir": "asc", "search": "sample mart", "accountId": "acc-card",
    ])
    #expect(!q.filtersAreDefault)
  }

  @Test func blankSearchAndAccountAreOmitted() {
    var q = TransactionQuery()
    q.search = "   "
    q.accountId = ""
    #expect(!q.queryItems(page: 1).contains { $0.name == "search" || $0.name == "accountId" })
    #expect(q.filtersAreDefault == false, "an empty-string account is still a choice away from nil")
  }

  @Test func categoryBodies() throws {
    #expect(try json(CategoryUpdate.set("Groceries", subcategory: " Organic ")) == #"{"category":"Groceries","subcategory":"Organic"}"#)
    #expect(try json(CategoryUpdate.set("Groceries", subcategory: "  ")) == #"{"category":"Groceries","subcategory":null}"#)
    #expect(try json(CategoryUpdate.reset) == #"{"category":null}"#)
  }

  @Test func linkBodies() throws {
    #expect(try json(LinkUpdate(linkedToLabel: 700)) == #"{"linkedToLabel":700}"#)
    #expect(try json(LinkUpdate(linkedToLabel: nil)) == #"{"linkedToLabel":null}"#)
  }

  @Test func splitBody() throws {
    #expect(try json(NewSplit(amount: 30.5, category: "Household", subcategory: nil))
      == #"{"amount":30.5,"category":"Household","subcategory":null}"#)
    #expect(try json(NewSplit(amount: 10, category: "Groceries", subcategory: " Organic"))
      == #"{"amount":10,"category":"Groceries","subcategory":"Organic"}"#)
  }

  @Test func uiStateValueDistinguishesNothingFromNonStrings() throws {
    func decode(_ s: String) throws -> UIStateValue {
      try JSONDecoder().decode(UIStateValue.self, from: Data(s.utf8))
    }
    #expect(try decode(#"{"value":"pro"}"#).string == "pro")
    #expect(try decode(#"{"value":"pro"}"#).isStored)
    #expect(try !decode(#"{"value":null}"#).isStored)
    #expect(try !decode(#"{}"#).isStored)
    #expect(try decode(#"{"value":{"x":1}}"#).isStored)
    #expect(try decode(#"{"value":{"x":1}}"#).string == nil)
  }
}
```


- [ ] **Step 2: Run to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `cannot find 'TransactionQuery' in scope`.

- [ ] **Step 3: Implement**


`ios/BudgetPhone/Transactions/TransactionQuery.swift`:

```swift
import Foundation

/// The ledger's search, filters and sort — TransactionLedger.tsx's state —
/// and the query string it sends.
struct TransactionQuery: Equatable, Sendable, Codable {
  enum Sort: String, Codable, Sendable, CaseIterable { case date, label }

  static let pageSize = 50

  var search = ""
  var accountId: String?
  var hideInternal = true
  var showLinked = false
  var sort: Sort = .date
  var ascending = false

  /// True when the filter menu has nothing set away from its defaults.
  /// Search is not a filter here; it has its own field.
  var filtersAreDefault: Bool {
    accountId == nil && hideInternal && !showLinked && sort == .date && !ascending
  }

  /// The web's URLSearchParams, in its order. Search and account are left
  /// out when empty, as the web does.
  func queryItems(page: Int) -> [URLQueryItem] {
    var items = [
      URLQueryItem(name: "page", value: String(page)),
      URLQueryItem(name: "limit", value: String(Self.pageSize)),
      URLQueryItem(name: "hideInternal", value: String(hideInternal)),
      URLQueryItem(name: "hideLinked", value: String(!showLinked)),
      URLQueryItem(name: "sort", value: sort.rawValue),
      URLQueryItem(name: "dir", value: ascending ? "asc" : "desc"),
    ]
    let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { items.append(URLQueryItem(name: "search", value: trimmed)) }
    if let accountId, !accountId.isEmpty { items.append(URLQueryItem(name: "accountId", value: accountId)) }
    return items
  }
}
```


`ios/BudgetPhone/Transactions/TransactionRequests.swift`:

```swift
import Foundation

// Request bodies for the Transactions writes, each exactly what the web
// sends (TransactionTable.tsx, TransactionLinkPicker.tsx, P2pCategorizer.tsx).

/// PATCH /api/transactions/:id — set a category, or `reset` to Plaid's.
struct CategoryUpdate: Encodable, Equatable, Sendable {
  let category: String?
  let subcategory: String?
  /// `{ category: null }` — the web's Reset. The server clears the override.
  static let reset = CategoryUpdate(category: nil, subcategory: nil)

  static func set(_ category: String, subcategory: String?) -> CategoryUpdate {
    let sub = subcategory?.trimmingCharacters(in: .whitespaces)
    return CategoryUpdate(category: category, subcategory: (sub?.isEmpty ?? true) ? nil : sub)
  }

  private enum CodingKeys: String, CodingKey { case category, subcategory }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(category, forKey: .category)  // null on reset
    if category != nil { try c.encode(subcategory, forKey: .subcategory) }
  }
}

/// PATCH /api/transactions/:id — `linkedToLabel: null` unlinks.
struct LinkUpdate: Encodable, Equatable, Sendable {
  let linkedToLabel: Int?

  private enum CodingKeys: String, CodingKey { case linkedToLabel }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(linkedToLabel, forKey: .linkedToLabel)  // explicit null
  }
}

/// POST /api/transactions/:id/splits.
struct NewSplit: Encodable, Equatable, Sendable {
  let amount: Double
  let category: String
  let subcategory: String?

  init(amount: Double, category: String, subcategory: String?) {
    self.amount = amount
    self.category = category
    let sub = subcategory?.trimmingCharacters(in: .whitespaces)
    self.subcategory = (sub?.isEmpty ?? true) ? nil : sub
  }

  private enum CodingKeys: String, CodingKey { case amount, category, subcategory }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(amount, forKey: .amount)
    try c.encode(category, forKey: .category)
    try c.encode(subcategory, forKey: .subcategory)  // explicit null
  }
}
```


`ios/BudgetPhone/Networking/APIClient+Transactions.swift`:

```swift
import Foundation

extension APIClient {
  func transactions(_ query: TransactionQuery, page: Int) async throws(APIError) -> TransactionsResponse {
    try decode(await send("GET", "api/transactions", query: query.queryItems(page: page), timeout: 15))
  }

  /// Pulls new transactions from Plaid for every linked bank. A bank that
  /// fails comes back in the summary; the call itself still succeeds.
  func syncTransactions() async throws(APIError) -> SyncResult {
    try decode(await send("POST", "api/plaid/sync", body: Data("{}".utf8), timeout: 120))
  }

  func updateCategory(transactionId: String, _ update: CategoryUpdate) async throws(APIError) {
    _ = try await send("PATCH", "api/transactions/\(transactionId)", body: encode(update), timeout: 15)
  }

  func updateLink(transactionId: String, _ update: LinkUpdate) async throws(APIError) {
    _ = try await send("PATCH", "api/transactions/\(transactionId)", body: encode(update), timeout: 15)
  }

  func linkCandidates(transactionId: String) async throws(APIError) -> [LinkCandidate] {
    let r: LinkCandidatesResponse = try decode(
      await send("GET", "api/transactions/\(transactionId)/link-candidates", timeout: 15))
    return r.candidates
  }

  func addSplit(transactionId: String, _ split: NewSplit) async throws(APIError) {
    _ = try await send("POST", "api/transactions/\(transactionId)/splits", body: encode(split), timeout: 15)
  }

  func deleteSplit(transactionId: String, splitId: String) async throws(APIError) {
    _ = try await send("DELETE", "api/transactions/\(transactionId)/splits/\(splitId)", timeout: 15)
  }

  func categories() async throws(APIError) -> CategoriesResponse {
    try decode(await send("GET", "api/categories", timeout: 15))
  }

  /// GET /api/ui-state?key= → `{ value }`.
  func uiState(_ key: String) async throws(APIError) -> UIStateValue {
    try decode(
      await send("GET", "api/ui-state", query: [URLQueryItem(name: "key", value: key)], timeout: 15))
  }
}

/// `{ value: <any JSON> }` from the shared ui-state store, a plain JSON file
/// anything can write. The web's loadSynced treats only null (or a missing
/// key) as "nothing stored"; any other value counts as stored, even one that
/// isn't a string — which resolveProMode then reads as Normal.
struct UIStateValue: Decodable, Equatable, Sendable {
  /// False when the store has nothing (null) under the key.
  let isStored: Bool
  /// The value when it is a string.
  let string: String?

  private enum CodingKeys: String, CodingKey { case value }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    if try !c.contains(.value) || c.decodeNil(forKey: .value) {
      isStored = false
      string = nil
    } else {
      isStored = true
      string = try? c.decode(String.self, forKey: .value)
    }
  }
}
```


- [ ] **Step 4: Run to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Add the ledger query, write bodies and API calls

Co-Authored-By: <your model's attribution line>"
```

---

### Task 4: Ledger, category and mode stores

**Files:**
- Create: `ios/BudgetPhone/Shared/ProMode.swift`, `ios/BudgetPhone/Transactions/CategoryCatalog.swift`, `ios/BudgetPhone/Transactions/TransactionsStore.swift`
- Test: `ios/BudgetPhoneTests/TransactionsStoreTests.swift`

**Interfaces:**
- Produces:
  - `@MainActor @Observable final class ProMode { init(client:); isPro: Bool; load() async; static resolve(_: UIStateValue) -> Bool }`
  - `@MainActor @Observable final class CategoryCatalog { init(client:); names: [String]; load() async; noteUsed(_ userCategory: String?); subcategories(of:) -> [String] }`
  - `@MainActor @Observable final class TransactionsStore { init(client:); query; rows: [TransactionDTO]; total: Int?; totalPages; error: APIError?; isLoading; isLoadingMore; loadMoreFailed; isSyncing; banner: String?; hasMore; row(_ id:) -> TransactionDTO?; apply(_:) async; reload() async; loadMore() async; sync() async; setCategory(_:_:) async throws(APIError); setLink(_:label:) async throws(APIError); addSplit(_:_:) async throws(APIError); deleteSplit(_:splitId:) async throws(APIError); linkCandidates(_:) async throws(APIError) -> [LinkCandidate]; reloadPage(containing:) async }`
- All `init(client: @escaping @MainActor () -> APIClient?)`, as `AccountsStore`.

Rules (spec, "Ledger" and "Shared pieces"): pages de-duplicate by id (first copy wins); a query change starts over and discards responses from older queries (generation counter); a failed next page keeps rows and sets `loadMoreFailed`; failures with nothing loaded set `error`, otherwise `banner`; Sync names failed banks as `Couldn't sync <institution> (<error>)` then reloads; a write re-fetches only the page holding the row; ProMode reads `pro-mode`, falls back to `analytics-mode` only when nothing is stored, treats only `"pro"` as Pro, and keeps its value when a read fails.

- [ ] **Step 1: Write the failing tests**


`ios/BudgetPhoneTests/TransactionsStoreTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// The ledger store, ProMode and CategoryCatalog against StubURLProtocol.
  /// Serialized: the stub's handler is shared.
  @Suite(.serialized)
  @MainActor
  struct TransactionsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    func ok(_ json: String) -> (Int, Data) { (200, Data(json.utf8)) }

    // MARK: Paging

    @Test func loadsPagesInOrderAndStopsAtTheLast() async throws {
      let c = client { r in
        (200, try TestData.ledgerPage(TestData.page(of: r) == 1 ? ["a", "b"] : ["c"], page: TestData.page(of: r), totalPages: 2, total: 3))
      }
      let store = TransactionsStore { c }
      await store.reload()
      #expect(store.rows.map(\.id) == ["a", "b"])
      #expect(store.total == 3)
      #expect(store.hasMore)
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a", "b", "c"])
      #expect(!store.hasMore)
      await store.loadMore()
      #expect(StubURLProtocol.requests.count == 2, "no request past the last page")
    }

    @Test func aRowRepeatedAcrossPagesAppearsOnce() async throws {
      let c = client { r in
        (200, try TestData.ledgerPage(TestData.page(of: r) == 1 ? ["a", "b"] : ["b", "c"], page: TestData.page(of: r), totalPages: 2))
      }
      let store = TransactionsStore { c }
      await store.reload()
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a", "b", "c"])
    }

    @Test func aFailedNextPageKeepsTheRowsAndOffersRetry() async throws {
      var failPage2 = true
      let c = client { r in
        let p = TestData.page(of: r)
        if p == 2 && failPage2 { throw URLError(.timedOut) }
        return (200, try TestData.ledgerPage(p == 1 ? ["a"] : ["b"], page: p, totalPages: 2))
      }
      let store = TransactionsStore { c }
      await store.reload()
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a"])
      #expect(store.loadMoreFailed)
      #expect(store.error == nil)
      failPage2 = false
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a", "b"])
      #expect(!store.loadMoreFailed)
    }

    @Test func aQueryChangeStartsOverAndSendsTheNewParameters() async throws {
      let c = client { r in
        let search = TestData.query(of: r, "search")
        return (200, try TestData.ledgerPage(search == nil ? ["a", "b"] : ["m"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.reload()
      var q = store.query
      q.search = "sample"
      await store.apply(q)
      #expect(store.rows.map(\.id) == ["m"])
      #expect(TestData.query(of: StubURLProtocol.requests.last!, "search") == "sample")
      await store.apply(q)
      #expect(StubURLProtocol.requests.count == 2, "applying the same query again does nothing")
    }

    @Test func aResponseForAnOlderQueryIsDiscarded() async throws {
      let c = client { r in
        if TestData.query(of: r, "search") == nil {
          Thread.sleep(forTimeInterval: 0.15)  // the older, slower query
          return (200, try TestData.ledgerPage(["old"], page: 1, totalPages: 1))
        }
        return (200, try TestData.ledgerPage(["new"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      let older = Task { await store.reload() }
      try await Task.sleep(for: .milliseconds(30))
      var q = store.query
      q.search = "x"
      await store.apply(q)
      await older.value
      #expect(store.rows.map(\.id) == ["new"])
    }

    @Test func firstPageFailureIsFullScreenLaterIsABanner() async throws {
      var fail = true
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        return (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.reload()
      #expect(store.error != nil)
      fail = false
      await store.reload()
      #expect(store.error == nil)
      fail = true
      await store.reload()
      #expect(store.rows.map(\.id) == ["a"])
      #expect(store.banner != nil)
    }

    // MARK: Sync

    @Test func syncNamesFailedBanksThenReloads() async throws {
      let summary = #"{"summary":[{"itemId":"i1","institution":"Example Bank","success":false,"error":"ITEM_LOGIN_REQUIRED"},{"itemId":"i2","institution":"Example Invest","success":true,"skipped":true},{"itemId":"i3","institution":"Sample Card Co","success":true,"added":3}]}"#
      let c = client { r in
        r.httpMethod == "POST" ? (200, Data(summary.utf8)) : (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.sync()
      #expect(store.banner == "Couldn't sync Example Bank (ITEM_LOGIN_REQUIRED)")
      #expect(store.rows.map(\.id) == ["a"])
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["POST", "GET"])
      #expect(StubURLProtocol.requests[0].url?.path() == "/api/plaid/sync")
    }

    // MARK: Writes

    @Test func aWriteReloadsOnlyThePageHoldingTheRow() async throws {
      var afterWrite = false
      let c = client { r in
        if r.httpMethod == "PATCH" {
          afterWrite = true
          return (200, Data(#"{"ok":true,"userCategory":"Dining"}"#.utf8))
        }
        let p = TestData.page(of: r)
        if p == 1 { return (200, try TestData.ledgerPage(["a", "b"], page: 1, totalPages: 2)) }
        // Page 2 after the write no longer holds "c" (it now fails the filter).
        return (200, try TestData.ledgerPage(afterWrite ? ["d"] : ["c", "d"], page: 2, totalPages: 2))
      }
      let store = TransactionsStore { c }
      await store.reload()
      await store.loadMore()
      try await store.setCategory("c", .set("Dining", subcategory: nil))
      #expect(store.rows.map(\.id) == ["a", "b", "d"])
      let methodsAndPages = StubURLProtocol.requests.map { "\($0.httpMethod!) \(TestData.page(of: $0))" }
      #expect(methodsAndPages == ["GET 1", "GET 2", "PATCH 0", "GET 2"])
      let body = try #require(StubURLProtocol.body(of: StubURLProtocol.requests[2]))
      #expect(String(decoding: body, as: UTF8.self).contains(#""category":"Dining""#))
    }

    @Test func aRefusedWriteThrowsTheServersMessageAndChangesNothing() async throws {
      let c = client { r in
        if r.httpMethod == "POST" {
          return (400, Data(#"{"error":"A split amount must be greater than zero"}"#.utf8))
        }
        return (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.reload()
      await #expect(throws: APIError.server(status: 400, message: "A split amount must be greater than zero")) {
        try await store.addSplit("a", NewSplit(amount: 0, category: "Dining", subcategory: nil))
      }
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["GET", "POST"])
    }

    @Test func writeEndpoints() async throws {
      let c = client { r in
        if r.httpMethod == "GET" { return (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1)) }
        return (200, Data(#"{"ok":true}"#.utf8))
      }
      let store = TransactionsStore { c }
      await store.reload()
      try await store.setLink("a", label: 700)
      try await store.deleteSplit("a", splitId: "sp-1")
      let writes = StubURLProtocol.requests.filter { $0.httpMethod != "GET" }
      #expect(writes.map { "\($0.httpMethod!) \($0.url!.path())" } == [
        "PATCH /api/transactions/a", "DELETE /api/transactions/a/splits/sp-1",
      ])
      #expect(String(decoding: StubURLProtocol.body(of: writes[0])!, as: UTF8.self) == #"{"linkedToLabel":700}"#)
    }

    @Test func linkCandidatesDecode() async throws {
      let c = client { _ in
        (200, Data(#"{"candidates":[{"id":"p1","label":700,"date":"2026-09-01T12:00:00.000Z","name":"Sample Store","amount":60,"category":"Shopping"}]}"#.utf8))
      }
      let store = TransactionsStore { c }
      let candidates = try await store.linkCandidates("r1")
      #expect(candidates.map(\.label) == [700])
      #expect(StubURLProtocol.requests[0].url?.path() == "/api/transactions/r1/link-candidates")
    }

    // MARK: ProMode

    @Test func proModeReadsTheKeyThenTheLegacyKey() async throws {
      var values = ["pro-mode": #"{"value":null}"#, "analytics-mode": #"{"value":"pro"}"#]
      let c = client { r in (200, Data(values[TestData.query(of: r, "key")!]!.utf8)) }
      let mode = ProMode { c }
      #expect(!mode.isPro, "Normal until loaded")
      await mode.load()
      #expect(mode.isPro, "falls back to the legacy key")

      values["pro-mode"] = #"{"value":"normal"}"#
      await mode.load()
      #expect(!mode.isPro, "the current key wins when stored")

      values["pro-mode"] = #"{"value":{"odd":true}}"#
      await mode.load()
      #expect(!mode.isPro, "a stored non-string is Normal, not a fallback")
    }

    @Test func proModeKeepsItsValueWhenTheReadFails() async throws {
      var fail = false
      let c = client { _ in
        if fail { throw URLError(.timedOut) }
        return (200, Data(#"{"value":"pro"}"#.utf8))
      }
      let mode = ProMode { c }
      await mode.load()
      fail = true
      await mode.load()
      #expect(mode.isPro)
    }

    // MARK: CategoryCatalog

    @Test func catalogMergesDeclaredAndSeenSubcategories() async throws {
      let json = try TestData.fixture("categories")
      let c = client { _ in (200, json) }
      let catalog = CategoryCatalog { c }
      await catalog.load()
      #expect(catalog.names == ["Groceries", "Dining"])
      catalog.noteUsed("Groceries > Bulk")
      catalog.noteUsed("Dining")
      catalog.noteUsed(nil)
      #expect(catalog.subcategories(of: "Groceries") == ["Bulk", "Organic"])
      #expect(catalog.subcategories(of: "Dining").isEmpty)
    }
  }
}
```


- [ ] **Step 2: Run to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `cannot find 'TransactionsStore' in scope`.

- [ ] **Step 3: Implement**


`ios/BudgetPhone/Shared/ProMode.swift`:

```swift
import Foundation
import Observation

/// The shared Normal / Pro setting, as useProMode.ts reads it: the
/// `pro-mode` key, else the legacy `analytics-mode` key, and only the string
/// "pro" means Pro. Until it has loaded — and whenever it cannot — the phone
/// behaves as Normal, so a Pro control never appears and then vanishes. The
/// phone only reads the setting; Settings → Mode will change it.
@MainActor
@Observable
final class ProMode {
  static let key = "pro-mode"
  static let legacyKey = "analytics-mode"

  private(set) var isPro = false
  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// resolveProMode.
  static func resolve(_ value: UIStateValue) -> Bool { value.string == "pro" }

  func load() async {
    guard let client = client() else { return }
    do throws(APIError) {
      let stored = try await client.uiState(Self.key)
      isPro = stored.isStored ? Self.resolve(stored) : Self.resolve(try await client.uiState(Self.legacyKey))
    } catch {
      // Keep whatever was last known; a failed read is not a mode change.
    }
  }
}
```


`ios/BudgetPhone/Transactions/CategoryCatalog.swift`:

```swift
import Foundation
import Observation

/// The category list the pickers offer: GET /api/categories, plus the
/// subcategories seen on loaded rows and saved this session — the web's
/// `categories` and `knownSubs`. Shared by the row editor and the split
/// sheet (and later the Rules screen).
@MainActor
@Observable
final class CategoryCatalog {
  private(set) var names: [String] = []
  private var subs: [String: Set<String>] = [:]
  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// Keeps what it had when the call fails; the pickers still offer the
  /// row's own category via `Ledger.categoryOptions`.
  func load() async {
    guard let client = client() else { return }
    do throws(APIError) {
      let r = try await client.categories()
      names = r.categories.map(\.name)
      for c in r.categories {
        subs[c.name, default: []].formUnion(c.subcategories.map(\.name))
      }
    } catch {}
  }

  /// Records the subcategory in a "Parent > Sub" value, if it has one.
  func noteUsed(_ userCategory: String?) {
    guard let userCategory else { return }
    let (parent, sub) = CategoryPath.split(userCategory)
    if let sub { subs[parent, default: []].insert(sub) }
  }

  func subcategories(of parent: String) -> [String] {
    (subs[parent] ?? []).sorted { $0.localizedCompare($1) == .orderedAscending }
  }
}
```


`ios/BudgetPhone/Transactions/TransactionsStore.swift`:

```swift
import Foundation
import Observation

/// The ledger: its query, the pages loaded so far, Sync, and the row writes.
/// Failures follow the Accounts rules — full screen while nothing has loaded,
/// a banner over rows that are still showing.
@MainActor
@Observable
final class TransactionsStore {
  private(set) var query = TransactionQuery()
  /// Loaded pages in order; `rows` flattens them.
  private var pages: [[TransactionDTO]] = []
  private(set) var total: Int?
  private(set) var totalPages = 0

  private(set) var error: APIError?
  private(set) var isLoading = false
  private(set) var isLoadingMore = false
  /// The last next-page request failed; the view offers Retry.
  private(set) var loadMoreFailed = false
  private(set) var isSyncing = false
  var banner: String?

  private let client: @MainActor () -> APIClient?
  /// Bumped whenever the query changes or page 1 reloads; a response only
  /// applies if its generation is still current.
  private var generation = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// Every loaded row once, in page order. A sync between two page requests
  /// can shift a row across a page boundary; the first copy wins.
  var rows: [TransactionDTO] {
    var seen = Set<String>()
    return pages.joined().filter { seen.insert($0.id).inserted }
  }

  var hasMore: Bool { pages.count < totalPages }

  func row(_ id: String) -> TransactionDTO? {
    pages.lazy.joined().first { $0.id == id }
  }

  /// New search, filters or sort: start over at page 1.
  func apply(_ query: TransactionQuery) async {
    guard query != self.query else { return }
    self.query = query
    await reload()
  }

  /// Page 1 of the current query, replacing everything loaded.
  func reload() async {
    generation += 1
    let current = generation
    guard let client = client() else {
      error = .notConfigured
      return
    }
    if pages.isEmpty { error = nil }
    isLoading = true
    loadMoreFailed = false
    defer { if current == generation { isLoading = false } }
    do throws(APIError) {
      let r = try await client.transactions(query, page: 1)
      guard current == generation else { return }
      pages = [r.transactions]
      total = r.total
      totalPages = r.totalPages
      error = nil
      banner = nil
    } catch {
      guard current == generation, error != .cancelled else { return }
      if pages.isEmpty { self.error = error } else { banner = error.message }
    }
  }

  /// The next page, appended. Called when the last row appears.
  func loadMore() async {
    guard hasMore, !isLoadingMore, !isLoading, let client = client() else { return }
    let current = generation
    let page = pages.count + 1
    isLoadingMore = true
    loadMoreFailed = false
    defer { if current == generation { isLoadingMore = false } }
    do throws(APIError) {
      let r = try await client.transactions(query, page: page)
      guard current == generation, pages.count == page - 1 else { return }
      pages.append(r.transactions)
      total = r.total
      totalPages = r.totalPages
    } catch {
      guard current == generation, error != .cancelled else { return }
      loadMoreFailed = true
    }
  }

  /// "Sync transactions": Plaid first, then page 1. Banks that failed are
  /// named in the banner; the reload happens regardless.
  func sync() async {
    guard !isSyncing, let client = client() else { return }
    isSyncing = true
    defer { isSyncing = false }
    var syncBanner: String?
    do throws(APIError) {
      let failed = try await client.syncTransactions().summary.filter { !$0.success }
      if !failed.isEmpty {
        syncBanner = "Couldn't sync "
          + failed.map { "\($0.institution) (\($0.error ?? "unknown error"))" }.joined(separator: ", ")
      }
    } catch {
      if error != .cancelled { syncBanner = error.message }
    }
    await reload()
    if let syncBanner { banner = syncBanner }
  }

  // MARK: - Writes. Each re-reads the page holding the row, so the list and
  // the detail screen show the server's result. Errors are thrown for the
  // detail screen to show; nothing is changed locally on failure.

  func setCategory(_ id: String, _ update: CategoryUpdate) async throws(APIError) {
    try await requireClient().updateCategory(transactionId: id, update)
    await reloadPage(containing: id)
  }

  func setLink(_ id: String, label: Int?) async throws(APIError) {
    try await requireClient().updateLink(transactionId: id, LinkUpdate(linkedToLabel: label))
    await reloadPage(containing: id)
  }

  func addSplit(_ id: String, _ split: NewSplit) async throws(APIError) {
    try await requireClient().addSplit(transactionId: id, split)
    await reloadPage(containing: id)
  }

  func deleteSplit(_ id: String, splitId: String) async throws(APIError) {
    try await requireClient().deleteSplit(transactionId: id, splitId: splitId)
    await reloadPage(containing: id)
  }

  func linkCandidates(_ id: String) async throws(APIError) -> [LinkCandidate] {
    try await requireClient().linkCandidates(transactionId: id)
  }

  private func requireClient() throws(APIError) -> APIClient {
    guard let client = client() else { throw .notConfigured }
    return client
  }

  /// Re-fetches the one page a row came from and swaps it in. After a write
  /// the row may no longer match the filters (a category set to Transfer
  /// with transfers hidden); it then simply drops out of the list.
  func reloadPage(containing id: String) async {
    guard let index = pages.firstIndex(where: { $0.contains { $0.id == id } }) else {
      await reload()
      return
    }
    guard let client = client() else { return }
    let current = generation
    do throws(APIError) {
      let r = try await client.transactions(query, page: index + 1)
      guard current == generation, index < pages.count else { return }
      pages[index] = r.transactions
      total = r.total
      totalPages = r.totalPages
    } catch {
      guard current == generation, error != .cancelled else { return }
      banner = error.message
    }
  }
}
```


- [ ] **Step 4: Run to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet` — run it twice; the timing tests (`aResponseForAnOlderQueryIsDiscarded`) must pass both times.
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Add the ledger, category and mode stores

Co-Authored-By: <your model's attribution line>"
```

---

### Task 5: Venmo and Zelle models and store

**Files:**
- Create: `ios/BudgetPhone/Models/P2PModels.swift`, `ios/BudgetPhone/Networking/APIClient+P2P.swift`, `ios/BudgetPhone/Transactions/P2PStore.swift`
- Test: `ios/BudgetPhoneTests/P2PTests.swift`

**Interfaces:**
- Consumes: `LinkedTargetDTO`, `Formatters`, `StubbedNetworkTests`.
- Produces: `P2PTransaction` (+ `Direction { in, out }`, `signedAmount`, `isIgnored`), `P2PResponse`, `P2PImportResult.notice`, `P2PCategoryUpdate`, `enum P2PSource { venmo, zelle; title; endpoint; canImport }`, `P2PTotals(_:) { sent; received; net }`; `APIClient.p2p(_:)`, `.setP2PCategory(_:id:category:)`, `.importP2P(_:)`; `@MainActor @Observable final class P2PStore { init(source:client:); source; data; error; isLoading; isImporting; banner; notice; totals; options(for:) -> [String]; load() async; setCategory(_:to:) async; runImport() async }`.

Web source: `src/components/P2pCategorizer.tsx` (totals, notice wording, optimistic update then reload on failure), `src/app/api/venmo/*`, `src/app/api/zelle/*`.

- [ ] **Step 1: Write the failing tests**


`ios/BudgetPhoneTests/P2PTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

private let feed = #"""
{"transactions":[
 {"id":"v1","label":801,"date":"2026-09-10T12:00:00.000Z","note":"dinner","counterparty":"Sample Friend","direction":"out","amount":40,"category":"Dining","linkedTo":null},
 {"id":"v2","label":802,"date":"2026-09-11T12:00:00.000Z","note":"","counterparty":null,"direction":"in","amount":15,"category":"Dining","linkedTo":null},
 {"id":"v3","label":803,"date":"2026-09-12T12:00:00.000Z","note":"rent share","counterparty":"Sample Roommate","direction":"out","amount":500,"category":"Transfer","linkedTo":null},
 {"id":"v4","label":null,"date":"2026-09-13T12:00:00.000Z","note":"?","counterparty":"Sample Person","direction":"in","amount":20,"category":"Uncategorized","linkedTo":null},
 {"id":"v5","label":805,"date":"2026-09-14T12:00:00.000Z","note":"tickets back","counterparty":"Sample Friend","direction":"in","amount":30,"category":"Concerts","linkedTo":{"id":"p9","label":650,"name":"Sample Tickets","category":"Concerts"}}
],"categories":["Uncategorized","Dining","Travel","Transfer"]}
"""#

struct P2PModelTests {
  func response() throws -> P2PResponse {
    try JSONDecoder().decode(P2PResponse.self, from: Data(feed.utf8))
  }

  @Test func totalsSkipUncategorizedAndTransfer() throws {
    let t = P2PTotals(try response().transactions)
    #expect(t.sent == 40)
    #expect(t.received == 45)
    #expect(t.net == -5)
  }

  @Test func signedAmountUsesARealMinus() throws {
    let rows = try response().transactions
    #expect(rows[0].signedAmount == "\u{2212}$40.00")
    #expect(rows[1].signedAmount == "+$15.00")
    #expect(rows[3].isIgnored)
  }

  @Test func importNotice() {
    #expect(P2PImportResult(imported: 12, reconciledCashouts: 1).notice == "Imported 12 payments · reconciled 1 cash-out.")
    #expect(P2PImportResult(imported: 3, reconciledCashouts: 2).notice == "Imported 3 payments · reconciled 2 cash-outs.")
    #expect(P2PImportResult(imported: 0, reconciledCashouts: 0).notice == "No statements found in your Downloads folder.")
  }

  @Test func sources() {
    #expect(P2PSource.venmo.endpoint == "api/venmo")
    #expect(P2PSource.venmo.canImport)
    #expect(!P2PSource.zelle.canImport)
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct P2PStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func store(_ source: P2PSource = .venmo, _ handler: @escaping (URLRequest) throws -> (Int, Data)) -> P2PStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler))
      return P2PStore(source: source) { c }
    }

    @Test func optionsIncludeALinkedRowsInheritedCategory() async throws {
      let s = store { _ in (200, Data(feed.utf8)) }
      await s.load()
      let rows = try #require(s.data?.transactions)
      #expect(s.options(for: rows[0]) == ["Uncategorized", "Dining", "Travel", "Transfer"])
      #expect(s.options(for: rows[4]) == ["Uncategorized", "Dining", "Travel", "Transfer", "Concerts"])
    }

    @Test func aCategoryChangeShowsAtOnceAndSendsTheWebsBody() async throws {
      let s = store(.zelle) { r in
        r.httpMethod == "PATCH" ? (200, Data(#"{"ok":true}"#.utf8)) : (200, Data(feed.utf8))
      }
      await s.load()
      await s.setCategory("v1", to: "Travel")
      #expect(s.data?.transactions[0].category == "Travel")
      let patch = try #require(StubURLProtocol.requests.last)
      #expect(patch.url?.path() == "/api/zelle/v1")
      #expect(String(decoding: StubURLProtocol.body(of: patch)!, as: UTF8.self) == #"{"userCategory":"Travel"}"#)
    }

    @Test func aRefusedChangeShowsTheMessageAndReloads() async throws {
      let s = store { r in
        r.httpMethod == "PATCH" ? (400, Data(#"{"error":"Invalid category"}"#.utf8)) : (200, Data(feed.utf8))
      }
      await s.load()
      await s.setCategory("v1", to: "Nope")
      #expect(s.banner == "Invalid category — reloaded.")
      #expect(s.data?.transactions[0].category == "Dining", "the reload restores the server's value")
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["GET", "PATCH", "GET"])
    }

    @Test func importShowsTheNoticeAndReloads() async throws {
      let s = store { r in
        r.httpMethod == "POST"
          ? (200, Data(#"{"imported":4,"reconciledCashouts":1,"unmatchedCashouts":0,"accountHolder":""}"#.utf8))
          : (200, Data(feed.utf8))
      }
      await s.runImport()
      #expect(s.notice == "Imported 4 payments · reconciled 1 cash-out.")
      #expect(StubURLProtocol.requests.map { "\($0.httpMethod!) \($0.url!.path())" } == ["POST /api/venmo/import", "GET /api/venmo"])
    }

    @Test func zelleNeverImports() async throws {
      let s = store(.zelle) { _ in (200, Data(feed.utf8)) }
      await s.runImport()
      #expect(StubURLProtocol.requests.isEmpty)
    }
  }
}
```


- [ ] **Step 2: Run to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `cannot find type 'P2PResponse' in scope`.

- [ ] **Step 3: Implement**


`ios/BudgetPhone/Models/P2PModels.swift`:

```swift
import Foundation

/// One row of GET /api/venmo or /api/zelle — P2pCategorizer.tsx's P2pTx.
/// `amount` is a magnitude; `direction` says which way it went.
struct P2PTransaction: Codable, Equatable, Sendable, Identifiable {
  enum Direction: String, Codable, Sendable { case `in`, out }
  let id: String
  let label: Int?
  let date: String
  let note: String
  let counterparty: String?
  let direction: Direction
  let amount: Double
  let category: String
  let linkedTo: LinkedTargetDTO?
}

struct P2PResponse: Codable, Equatable, Sendable {
  let transactions: [P2PTransaction]
  let categories: [String]
}

/// POST /api/venmo/import.
struct P2PImportResult: Decodable, Equatable, Sendable {
  let imported: Int
  let reconciledCashouts: Int

  /// The web's notice after an import.
  var notice: String {
    imported > 0
      ? "Imported \(imported) payments · reconciled \(reconciledCashouts) cash-out\(reconciledCashouts == 1 ? "" : "s")."
      : "No statements found in your Downloads folder."
  }
}

/// PATCH /api/venmo/:id or /api/zelle/:id.
struct P2PCategoryUpdate: Encodable, Equatable, Sendable {
  let userCategory: String
}

/// The categorizer's two feeds.
enum P2PSource: String, Sendable, CaseIterable {
  case venmo, zelle

  var title: String { self == .venmo ? "Venmo" : "Zelle" }
  var endpoint: String { "api/\(rawValue)" }
  /// Venmo imports from CSV; Zelle rides the bank feed.
  var canImport: Bool { self == .venmo }
}

extension P2PTransaction {
  /// "+$12.00" in, "−$12.00" out — the web prints a real minus sign here.
  var signedAmount: String { (direction == .in ? "+" : "\u{2212}") + Formatters.currency(amount) }
  var isIgnored: Bool { P2PTotals.ignored.contains(category) }
}

/// The header figures, over categorized rows only (P2pCategorizer's
/// `totals`: Uncategorized and Transfer don't count as spending).
struct P2PTotals: Equatable, Sendable {
  static let ignored: Set<String> = ["Uncategorized", "Transfer"]

  let sent: Double
  let received: Double
  var net: Double { sent - received }

  init(_ rows: [P2PTransaction]) {
    var out = 0.0, inc = 0.0
    for t in rows where !Self.ignored.contains(t.category) {
      if t.direction == .out { out += t.amount } else { inc += t.amount }
    }
    sent = out
    received = inc
  }
}
```


`ios/BudgetPhone/Networking/APIClient+P2P.swift`:

```swift
import Foundation

extension APIClient {
  func p2p(_ source: P2PSource) async throws(APIError) -> P2PResponse {
    try decode(await send("GET", source.endpoint, timeout: 15))
  }

  func setP2PCategory(_ source: P2PSource, id: String, category: String) async throws(APIError) {
    _ = try await send(
      "PATCH", "\(source.endpoint)/\(id)", body: encode(P2PCategoryUpdate(userCategory: category)),
      timeout: 15)
  }

  /// The server reads the CSVs from its own Downloads folder.
  func importP2P(_ source: P2PSource) async throws(APIError) -> P2PImportResult {
    try decode(await send("POST", "\(source.endpoint)/import", timeout: 60))
  }
}
```


`ios/BudgetPhone/Transactions/P2PStore.swift`:

```swift
import Foundation
import Observation

/// One categorizer feed (Venmo or Zelle). A category change shows at once
/// and is sent in the background; if the server refuses it, the message goes
/// in the banner and the list reloads — P2pCategorizer's behaviour.
@MainActor
@Observable
final class P2PStore {
  let source: P2PSource
  private(set) var data: P2PResponse?
  private(set) var error: APIError?
  private(set) var isLoading = false
  private(set) var isImporting = false
  var banner: String?
  /// The import result, shown until the next import or dismissal.
  var notice: String?

  private let client: @MainActor () -> APIClient?
  private var generation = 0

  init(source: P2PSource, client: @escaping @MainActor () -> APIClient?) {
    self.source = source
    self.client = client
  }

  var totals: P2PTotals { P2PTotals(data?.transactions ?? []) }

  /// The picker's options for a row: the feed's list, plus the row's own
  /// category if a link gave it one that isn't in the list.
  func options(for row: P2PTransaction) -> [String] {
    let list = data?.categories ?? []
    return list.contains(row.category) ? list : list + [row.category]
  }

  func load() async {
    generation += 1
    let current = generation
    guard let client = client() else {
      error = .notConfigured
      return
    }
    if data == nil { error = nil }
    isLoading = true
    defer { if current == generation { isLoading = false } }
    do throws(APIError) {
      let r = try await client.p2p(source)
      guard current == generation else { return }
      data = r
      error = nil
    } catch {
      guard current == generation, error != .cancelled else { return }
      if data == nil { self.error = error } else { banner = error.message }
    }
  }

  func setCategory(_ id: String, to category: String) async {
    guard let client = client(), let current = data,
      let index = current.transactions.firstIndex(where: { $0.id == id })
    else { return }
    var rows = current.transactions
    let old = rows[index]
    rows[index] = P2PTransaction(
      id: old.id, label: old.label, date: old.date, note: old.note,
      counterparty: old.counterparty, direction: old.direction, amount: old.amount,
      category: category, linkedTo: old.linkedTo)
    data = P2PResponse(transactions: rows, categories: current.categories)
    do throws(APIError) {
      try await client.setP2PCategory(source, id: id, category: category)
    } catch {
      guard error != .cancelled else { return }
      banner = error.message + " — reloaded."
      await load()
    }
  }

  func runImport() async {
    guard source.canImport, !isImporting, let client = client() else { return }
    isImporting = true
    defer { isImporting = false }
    notice = nil
    do throws(APIError) {
      notice = try await client.importP2P(source).notice
      await load()
    } catch {
      if error != .cancelled { banner = error.message }
    }
  }
}
```


- [ ] **Step 4: Run to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Add the Venmo and Zelle models and store

Co-Authored-By: <your model's attribution line>"
```

---

### Task 6: Row and detail views

**Files:**
- Create: `ios/BudgetPhone/Transactions/TransactionRow.swift`, `ios/BudgetPhone/Transactions/CategoryFields.swift`, `ios/BudgetPhone/Transactions/LinkPurchaseView.swift`, `ios/BudgetPhone/Transactions/AddSplitSheet.swift`, `ios/BudgetPhone/Transactions/TransactionDetailView.swift`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `TransactionRow(transaction:)`, `CategoryLine(transaction:)`, `BadgeView(badge:)`, `FlowLayout(spacing:)`; `CategoryFields(options:knownSubs:category:subcategory:)`; `LinkPurchaseView(transactionId:store:onLinked:)` (`onLinked: () async -> Void = {}`); `AddSplitSheet(transaction:store:catalog:)`; `TransactionDetailView(id:store:catalog:proMode:)`.

Views only — no new unit tests; the logic they call is tested in Tasks 1–5. Wording is the web's: "Split across categories", "(rest)", the shrunk-split and Normal-mode notes, "Paid back by", "Pooled from these Venmo payments", "Prior balance (uncategorized)" (only when > 0), "Connect to a Purchase", "No likely purchase found — enter a number below." Subcategories in the split list use "›" as the web's split panel does; the category line uses " > ".

Swift note: closures passed to a typed-throws helper lose their error type, which is why the detail screen routes writes through a small `Write` enum rather than closures.

- [ ] **Step 1: Write the views**


`ios/BudgetPhone/Transactions/TransactionRow.swift`:

```swift
import SwiftUI

/// One ledger row, in the web row's order: title and amount, the serial /
/// date / account line, badges, then the category line.
struct TransactionRow: View {
  let transaction: TransactionDTO

  var body: some View {
    let t = transaction
    let amount = Ledger.signedAmount(t.amount)
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        Text(t.title)
          .font(.body.weight(.medium))
          .lineLimit(2)
        Spacer(minLength: 0)
        VStack(alignment: .trailing, spacing: 2) {
          Text(amount.text)
            .monospacedDigit()
            .foregroundStyle(amount.isOutflow ? Color.primary : Color.green)
          if !t.refunds.isEmpty {
            Text("net \(Formatters.currency(t.netAmount))")
              .font(.caption)
              .monospacedDigit()
              .foregroundStyle(.green)
          }
        }
      }
      Text(t.detailLine())
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(1)
      let badges = t.badges
      if !badges.isEmpty {
        FlowLayout(spacing: 4) {
          ForEach(badges, id: \.text) { BadgeView(badge: $0) }
        }
      }
      CategoryLine(transaction: t)
    }
    .foregroundStyle(t.pending ? .secondary : .primary)
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}

/// The category, with CUSTOM for an override or a lock for a row whose
/// category comes from its link.
struct CategoryLine: View {
  let transaction: TransactionDTO

  var body: some View {
    HStack(spacing: 6) {
      Text(transaction.categoryLabel)
        .font(.footnote)
        .foregroundStyle(.secondary)
      if transaction.linkedTo != nil {
        Image(systemName: "lock.fill")
          .font(.caption2)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Category from linked purchase")
      } else if transaction.userCategory != nil {
        Text("CUSTOM")
          .font(.caption2.weight(.semibold))
          .padding(.horizontal, 4)
          .background(Color.blue.opacity(0.15), in: .rect(cornerRadius: 3))
          .foregroundStyle(.blue)
      }
    }
  }
}

struct BadgeView: View {
  let badge: TransactionDTO.Badge

  var body: some View {
    Text(badge.text)
      .font(.caption2.weight(.medium))
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(color.opacity(0.15), in: .capsule)
      .foregroundStyle(color)
  }

  private var color: Color {
    switch badge.tone {
    case .violet: .purple
    case .green: .green
    case .amber: .orange
    case .slate: .secondary
    }
  }
}

/// Lays badges out left to right, wrapping onto new lines as needed.
struct FlowLayout: Layout {
  var spacing: CGFloat = 4

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    arrange(width: proposal.width ?? .infinity, subviews: subviews).size
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let origins = arrange(width: bounds.width, subviews: subviews).origins
    for (view, origin) in zip(subviews, origins) {
      view.place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
    }
  }

  private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
    var origins: [CGPoint] = []
    var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, maxX: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width {
        x = 0
        y += lineHeight + spacing
        lineHeight = 0
      }
      origins.append(CGPoint(x: x, y: y))
      x += size.width + spacing
      maxX = max(maxX, x - spacing)
      lineHeight = max(lineHeight, size.height)
    }
    return (CGSize(width: maxX, height: y + lineHeight), origins)
  }
}
```


`ios/BudgetPhone/Transactions/CategoryFields.swift`:

```swift
import SwiftUI

/// The two-level picker the row editor and the split sheet share — the web's
/// category <select> plus its subcategory datalist. "Other…" reveals a text
/// field for a subcategory not in the list yet.
struct CategoryFields: View {
  let options: [String]
  let knownSubs: (String) -> [String]
  @Binding var category: String
  @Binding var subcategory: String

  @State private var typingNew = false

  var body: some View {
    Picker("Category", selection: $category) {
      ForEach(options, id: \.self) { Text($0).tag($0) }
    }
    .onChange(of: category) { subcategory = ""; typingNew = false }

    let subs = knownSubs(category)
    Picker("Subcategory", selection: subSelection(subs)) {
      Text("None").tag("")
      ForEach(subs, id: \.self) { Text($0).tag($0) }
      Text("Other…").tag(Self.other)
    }
    if typingNew {
      TextField("New subcategory", text: $subcategory)
        .textInputAutocapitalization(.words)
    }
  }

  private static let other = "\u{0}other"

  private func subSelection(_ subs: [String]) -> Binding<String> {
    Binding(
      get: {
        if typingNew { return Self.other }
        return subs.contains(subcategory) || subcategory.isEmpty ? subcategory : Self.other
      },
      set: { value in
        if value == Self.other {
          typingNew = true
          if subs.contains(subcategory) { subcategory = "" }
        } else {
          typingNew = false
          subcategory = value
        }
      })
  }
}
```


`ios/BudgetPhone/Transactions/LinkPurchaseView.swift`:

```swift
import SwiftUI

/// TransactionLinkPicker.tsx: the purchases this money-in row most likely
/// pays back, best first, plus linking by a typed serial number.
struct LinkPurchaseView: View {
  let transactionId: String
  let store: TransactionsStore
  /// Runs after a successful link, e.g. to reload a Venmo or Zelle list.
  var onLinked: () async -> Void = {}

  @Environment(\.dismiss) private var dismiss
  @State private var candidates: [LinkCandidate]?
  @State private var typed = ""
  @State private var saving = false
  @State private var failure: String?

  var body: some View {
    Form {
      Section {
        if let candidates {
          if candidates.isEmpty {
            Text("No likely purchase found — enter a number below.")
              .foregroundStyle(.secondary)
          }
          ForEach(candidates) { c in
            Button { link(c.label) } label: { candidateRow(c) }
              .disabled(c.label == nil || saving)
          }
        } else {
          ProgressView()
        }
      } header: {
        Text("Likely purchases")
      }

      Section {
        HStack {
          Text("#")
          TextField("Number", text: $typed)
            .keyboardType(.numberPad)
          Button("Connect") { link(Int(typed)) }
            .disabled(Int(typed) == nil || saving)
        }
      } header: {
        Text("By number")
      } footer: {
        Text("The # shown to the left of a purchase's date in the ledger.")
      }
    }
    .navigationTitle("Connect to a Purchase")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      do throws(APIError) {
        candidates = try await store.linkCandidates(transactionId)
      } catch {
        candidates = []
        if error != .cancelled { failure = error.message }
      }
    }
    .alert("Couldn't Connect", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(failure ?? "")
    }
  }

  private func candidateRow(_ c: LinkCandidate) -> some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 2) {
        Text(c.name).foregroundStyle(.primary)
        Text(["#\(c.label.map(String.init) ?? "—")",
              Formatters.parseISO(c.date).map { Formatters.date($0) } ?? "",
              c.category].joined(separator: " · "))
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      Spacer()
      Text(Formatters.currency(c.amount)).monospacedDigit().foregroundStyle(.primary)
    }
  }

  private func link(_ label: Int?) {
    guard let label else { return }
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        try await store.setLink(transactionId, label: label)
        await onLinked()
        dismiss()
      } catch {
        if error != .cancelled { failure = error.message }
      }
    }
  }
}
```


`ios/BudgetPhone/Transactions/AddSplitSheet.swift`:

```swift
import SwiftUI

/// AddSplitForm in TransactionTable.tsx: carve an amount out of a purchase
/// under another category. The server checks the amount against what is
/// left and its message is shown as is.
struct AddSplitSheet: View {
  let transaction: TransactionDTO
  let store: TransactionsStore
  let catalog: CategoryCatalog

  @Environment(\.dismiss) private var dismiss
  @State private var amountText = ""
  @State private var category: String
  @State private var subcategory = ""
  @State private var saving = false
  @State private var failure: String?

  init(transaction: TransactionDTO, store: TransactionsStore, catalog: CategoryCatalog) {
    self.transaction = transaction
    self.store = store
    self.catalog = catalog
    _category = State(initialValue: transaction.editableCategory)
  }

  /// What is still unallocated — the leftover, or the whole amount when the
  /// row has no parts yet.
  private var left: Double { transaction.splitRemainder ?? transaction.amount }

  private var amount: Double? {
    guard let v = Double(amountText.trimmingCharacters(in: .whitespaces)), v > 0 else { return nil }
    return v
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Amount", text: $amountText)
            .keyboardType(.decimalPad)
        } footer: {
          Text("\(Formatters.currency(max(left, 0))) left to split.")
        }
        Section {
          CategoryFields(
            options: Ledger.categoryOptions(catalog.names, current: transaction.editableCategory, plaid: transaction.plaidCategory),
            knownSubs: catalog.subcategories(of:),
            category: $category,
            subcategory: $subcategory)
        }
      }
      .navigationTitle("Add Split")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save).disabled(amount == nil)
          }
        }
      }
      .alert("Couldn't Add Split", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(failure ?? "")
      }
    }
  }

  private func save() {
    guard let amount else { return }
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        let split = NewSplit(amount: amount, category: category, subcategory: subcategory)
        try await store.addSplit(transaction.id, split)
        catalog.noteUsed(CategoryPath.join(split.category, split.subcategory))
        dismiss()
      } catch {
        if error != .cancelled { failure = error.message }
      }
    }
  }
}
```


`ios/BudgetPhone/Transactions/TransactionDetailView.swift`:

```swift
import SwiftUI

/// Everything the web shows when a row expands or its category editor opens:
/// category, link, splits, refunds and a Venmo cash-out's breakdown. Reads
/// the row from the store by id, so it shows the server's copy after a write.
struct TransactionDetailView: View {
  let id: String
  let store: TransactionsStore
  let catalog: CategoryCatalog
  let proMode: ProMode

  /// The last copy seen, kept for when a write moves the row out of the
  /// loaded pages (a category that the filters now hide).
  @State private var snapshot: TransactionDTO?
  @State private var category = ""
  @State private var subcategory = ""
  @State private var saving = false
  @State private var failure: String?
  @State private var addingSplit = false

  private var transaction: TransactionDTO? { store.row(id) ?? snapshot }

  var body: some View {
    Group {
      if let t = transaction {
        form(t)
      } else {
        ContentUnavailableView("Transaction Not Loaded", systemImage: "questionmark.circle")
      }
    }
    .navigationBarTitleDisplayMode(.inline)
    .onAppear { adopt(store.row(id)) }
    .onChange(of: store.row(id)) { _, row in adopt(row) }
    .alert("Couldn't Save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(failure ?? "")
    }
  }

  /// Takes the server's copy and resets the editor to it.
  private func adopt(_ row: TransactionDTO?) {
    guard let row else { return }
    snapshot = row
    category = row.editableCategory
    subcategory = row.editableSubcategory ?? ""
  }

  private func form(_ t: TransactionDTO) -> some View {
    Form {
      summary(t)
      if t.linkedTo == nil { categorySection(t) }
      if t.isMoneyIn { linkSection(t) }
      if !t.splits.isEmpty || (t.isSplittable && proMode.isPro) { splitsSection(t) }
      if !t.refunds.isEmpty { refundsSection(t) }
      if let breakdown = t.breakdown { breakdownSection(breakdown) }
      if store.row(id) == nil {
        Section {
        } footer: {
          Text("This transaction no longer matches the ledger's filters.")
        }
      }
    }
    .navigationTitle(t.title)
    .toolbar {
      if t.linkedTo == nil {
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Save") { run(.category(.set(category, subcategory: subcategory))) }
              .disabled(!categoryChanged(t))
          }
        }
      }
    }
    .sheet(isPresented: $addingSplit) {
      AddSplitSheet(transaction: t, store: store, catalog: catalog)
    }
  }

  private func categoryChanged(_ t: TransactionDTO) -> Bool {
    let chosen = CategoryPath.join(category, subcategory)
    let current = t.userCategory ?? t.category
    return chosen != current
  }

  // MARK: Sections

  private func summary(_ t: TransactionDTO) -> some View {
    let amount = Ledger.signedAmount(t.amount)
    return Section {
      VStack(alignment: .leading, spacing: 6) {
        Text(amount.text)
          .font(.largeTitle.weight(.semibold))
          .monospacedDigit()
          .foregroundStyle(amount.isOutflow ? Color.primary : Color.green)
          .minimumScaleFactor(0.6)
          .lineLimit(1)
        Text(t.detailLine())
          .font(.subheadline)
          .foregroundStyle(.secondary)
        let badges = t.badges
        if !badges.isEmpty {
          FlowLayout(spacing: 4) { ForEach(badges, id: \.text) { BadgeView(badge: $0) } }
        }
      }
      .padding(.vertical, 4)
      if t.merchantName != nil { LabeledContent("Bank description", value: t.name) }
      if let note = t.personalNote, !note.isEmpty { LabeledContent("Note", value: note) }
    }
  }

  private func categorySection(_ t: TransactionDTO) -> some View {
    Section {
      CategoryFields(
        options: Ledger.categoryOptions(catalog.names, current: t.editableCategory, plaid: t.plaidCategory),
        knownSubs: catalog.subcategories(of:),
        category: $category,
        subcategory: $subcategory)
      if t.userCategory != nil {
        Button("Use Bank's Category", role: .destructive) {
          run(.category(.reset))
        }
        .disabled(saving)
      }
    } header: {
      Text("Category")
    } footer: {
      if t.userCategory != nil {
        Text("The bank's category is \(t.plaidCategoryDetailed ?? t.plaidCategory).")
      }
    }
  }

  private func linkSection(_ t: TransactionDTO) -> some View {
    Section {
      if let linked = t.linkedTo {
        LabeledContent("Linked to", value: "#\(linked.label.map(String.init) ?? "?") \(linked.name)")
        LabeledContent("Category", value: linked.category)
        Button("Unlink", role: .destructive) { run(.unlink) }
          .disabled(saving)
      } else {
        NavigationLink("Connect to a Purchase…") { LinkPurchaseView(transactionId: t.id, store: store) }
      }
    } header: {
      Text("Paid back")
    } footer: {
      if t.linkedTo != nil {
        Text("While linked, this row takes the purchase's category. Unlink to set its own.")
      }
    }
  }

  private func splitsSection(_ t: TransactionDTO) -> some View {
    Section {
      ForEach(t.splits) { part in
        LabeledContent(part.subcategory.map { "\(part.category) › \($0)" } ?? part.category) {
          Text(Formatters.currency(part.amount)).monospacedDigit()
        }
        .swipeActions {
          if proMode.isPro {
            Button("Remove", role: .destructive) {
              run(.deleteSplit(part.id))
            }
          }
        }
      }
      if let rest = t.splitRemainder {
        let label = (t.categoryDetailed.map { "\(t.category) › \($0)" } ?? t.category) + " (rest)"
        LabeledContent(label) {
          Text(Formatters.currency(rest))
            .monospacedDigit()
            .foregroundStyle(rest < 0 ? Color.red : Color.primary)
        }
      }
      if proMode.isPro && t.isSplittable {
        Button("Add Split", systemImage: "plus") { addingSplit = true }
          .disabled(saving)
      }
    } header: {
      Text("Split across categories")
    } footer: {
      VStack(alignment: .leading, spacing: 6) {
        if t.splitIsShrunk {
          Text("This transaction's amount changed and is now smaller than its splits. Remove or re-add a split to fix it.")
            .foregroundStyle(.orange)
        }
        if !proMode.isPro {
          Text("Splits still count toward your totals in Normal mode — switch to Pro in Settings to change them.")
        }
      }
    }
  }

  private func refundsSection(_ t: TransactionDTO) -> some View {
    Section {
      ForEach(t.refunds) { r in
        LabeledContent {
          Text(Formatters.currency(abs(r.amount))).monospacedDigit()
        } label: {
          Text("#\(r.label.map(String.init) ?? "—") \(Formatters.parseISO(r.date).map { Formatters.date($0) } ?? "") · \(r.name)")
        }
      }
      LabeledContent("Net") {
        Text(Formatters.currency(t.netAmount)).monospacedDigit().foregroundStyle(.green)
      }
    } header: {
      Text("Paid back by")
    }
  }

  private func breakdownSection(_ b: CashoutBreakdown) -> some View {
    Section {
      ForEach(b.slices, id: \.category) { slice in
        LabeledContent(slice.category) {
          Text(Formatters.currency(slice.amount)).monospacedDigit()
        }
      }
      if b.priorBalance > 0 {
        LabeledContent("Prior balance (uncategorized)") {
          Text(Formatters.currency(b.priorBalance)).monospacedDigit()
        }
      }
    } header: {
      Text("Pooled from these Venmo payments")
    }
  }

  private enum Write {
    case category(CategoryUpdate)
    case unlink
    case deleteSplit(String)
  }

  /// Runs a write; on failure shows the server's message and leaves the form
  /// as the user left it.
  private func run(_ write: Write) {
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        switch write {
        case .category(let update): try await store.setCategory(id, update)
        case .unlink: try await store.setLink(id, label: nil)
        case .deleteSplit(let splitId): try await store.deleteSplit(id, splitId: splitId)
        }
        catalog.noteUsed(store.row(id)?.userCategory)
      } catch {
        if error != .cancelled { failure = error.message }
      }
    }
  }
}
```


- [ ] **Step 2: Build and test**

Run: `xcodebuild build -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet` — expected: no errors and no warnings from these files. Then `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet` — expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add ios
git commit -m "Add the transaction row and detail views

Co-Authored-By: <your model's attribution line>"
```

---

### Task 7: Ledger, Venmo/Zelle screens and the tab

**Files:**
- Create: `ios/BudgetPhone/Transactions/P2PCategorizerView.swift`, `ios/BudgetPhone/Transactions/LedgerView.swift`, `ios/BudgetPhone/Transactions/TransactionsView.swift`
- Modify: `ios/BudgetPhone/App/RootView.swift` (full replacement)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `P2PCategorizerView(store:ledger:)`, `LedgerView(store:catalog:proMode:)`, `TransactionsView()`, `struct TransactionRoute: Hashable { id }`; RootView tabs Accounts · Transactions · Settings.

Notes:
- The segmented control lives in the navigation bar's principal slot, so the title is inline (spec, Navigation).
- Search is debounced with `.task(id: search)` + a 300 ms sleep: a new keystroke cancels the pending query.
- No Sync button: pulling the list down runs `store.sync()` (Plaid, then page 1), the same gesture that refreshes balances on Accounts. The empty state is wrapped in a `ScrollView` so the pull works there too. With only the Filter button trailing, the segmented control stays centred on all three segments; a second trailing item pushes it left on the Ledger — don't add one.
- The ledger list is `.insetGrouped`, like the Venmo/Zelle lists, so the background stays the grouped grey when switching segments. The count is the section header.
- Filters and sort persist in `@AppStorage("transactions.filters")` (JSON of `TransactionQuery` with `search` cleared); search does not persist.
- The P2P row's category binding captures the store directly; passing an `@MainActor @Sendable (String) -> Void` into `Binding(set:)` crashed the Swift 6.2 compiler (IRGen) during prototyping — don't reintroduce that shape.

- [ ] **Step 1: Write the screens**


`ios/BudgetPhone/Transactions/P2PCategorizerView.swift`:

```swift
import SwiftUI

/// P2pCategorizer.tsx for one feed: totals over categorized payments, a
/// category menu per payment, Connect to a Purchase on money in, and (Venmo
/// only) Import.
struct P2PCategorizerView: View {
  let store: P2PStore
  /// For linking: the ledger store owns the link write and its reload.
  let ledger: TransactionsStore

  @AppStorage(ServerAddress.storageKey) private var server = ""
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    content
      .toolbar {
        if store.source.canImport {
          ToolbarItem(placement: .topBarTrailing) {
            if store.isImporting {
              ProgressView()
            } else {
              Button("Import CSV", systemImage: "square.and.arrow.down") {
                Task { await store.runImport() }
              }
            }
          }
        }
      }
      .task { if store.data == nil { await store.load() } }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { Task { await store.load() } }
      }
  }

  @ViewBuilder private var content: some View {
    if let data = store.data {
      if data.transactions.isEmpty {
        ContentUnavailableView {
          Label("Nothing to Categorize Yet", systemImage: "person.2")
        } description: {
          Text(emptyHint)
        }
      } else {
        list(data)
      }
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView()
    }
  }

  private var emptyHint: String {
    store.source == .venmo
      ? "Drop your VenmoStatement_*.csv exports in the Mac's Downloads folder, then tap Import."
      : "Zelle payments arrive automatically with your bank sync. Once a connected account has Zelle activity, it shows up here to categorize."
  }

  private func list(_ data: P2PResponse) -> some View {
    List {
      Section {
        let totals = store.totals
        HStack {
          figure("Sent", totals.sent, .primary)
          figure("Received", totals.received, .green)
          figure("Net spend", totals.net, .primary)
        }
      } footer: {
        Text("Categorized payments only — Uncategorized and Transfer don't count.")
      }
      Section {
        ForEach(data.transactions) { row in
          P2PRow(row: row, store: store, ledger: ledger)
        }
      }
    }
    .refreshable { await store.load() }
    .safeAreaInset(edge: .top) {
      VStack(spacing: 8) {
        if let notice = store.notice {
          Banner(text: notice) { store.notice = nil }
        }
        if let banner = store.banner {
          Banner(text: banner) { store.banner = nil }
        }
      }
    }
  }

  private func figure(_ label: String, _ amount: Double, _ color: Color) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.caption).foregroundStyle(.secondary)
      Text(Formatters.currency(amount))
        .font(.subheadline.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(color)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct P2PRow: View {
  let row: P2PTransaction
  let store: P2PStore
  let ledger: TransactionsStore

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline) {
        Text(row.counterparty ?? "—").font(.body.weight(.medium))
        Spacer()
        Text(row.signedAmount)
          .monospacedDigit()
          .foregroundStyle(row.direction == .in ? Color.green : Color.primary)
      }
      if !row.note.isEmpty {
        Text(row.note).font(.subheadline)
      }
      Text(["#\(row.label.map(String.init) ?? "—")",
            Formatters.parseISO(row.date).map { Formatters.date($0) } ?? ""].joined(separator: " · "))
        .font(.footnote)
        .foregroundStyle(.secondary)
      HStack {
        if let linked = row.linkedTo {
          HStack(spacing: 4) {
            Image(systemName: "lock.fill").font(.caption2)
            Text("\(row.category) · linked to #\(linked.label.map(String.init) ?? "?")")
          }
          .font(.footnote)
          .foregroundStyle(.secondary)
        } else {
          Menu {
            Picker("Category", selection: categoryBinding) {
              ForEach(store.options(for: row), id: \.self) { Text($0).tag($0) }
            }
          } label: {
            Label(row.category, systemImage: "tag")
              .font(.footnote)
              .foregroundStyle(row.isIgnored ? Color.secondary : Color.accentColor)
          }
        }
        Spacer()
        if row.direction == .in && row.linkedTo == nil {
          NavigationLink("Connect…") {
            LinkPurchaseView(transactionId: row.id, store: ledger) { await store.load() }
          }
          .font(.footnote)
          .fixedSize()
        }
      }
    }
    .padding(.vertical, 2)
  }

  private var categoryBinding: Binding<String> {
    let id = row.id
    let store = store
    return Binding(get: { row.category }, set: { category in
      Task { await store.setCategory(id, to: category) }
    })
  }
}
```


`ios/BudgetPhone/Transactions/LedgerView.swift`:

```swift
import SwiftUI

/// TransactionLedger.tsx: search, filters, sort, and the rows, paged by
/// scrolling. Pulling down runs the web's "Sync transactions" — the same
/// gesture that refreshes balances on Accounts.
struct LedgerView: View {
  let store: TransactionsStore
  let catalog: CategoryCatalog
  let proMode: ProMode

  @AppStorage(ServerAddress.storageKey) private var server = ""
  /// Filters and sort, kept per device (search is not kept).
  @AppStorage("transactions.filters") private var savedFilters = Data()
  @State private var search = ""
  @State private var accountGroups: [AccountGroup] = []
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    content
      .searchable(text: $search, prompt: "Description or merchant")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) { filterMenu }
      }
      .task {
        var q = restoredFilters()
        q.search = search
        await store.apply(q)
        if store.rows.isEmpty && store.error == nil { await store.reload() }
        accountGroups = (try? await Self.client()?.accounts().groups) ?? []
      }
      // Debounced: a new keystroke cancels the pending query.
      .task(id: search) {
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        var q = store.query
        q.search = search
        await store.apply(q)
      }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { Task { await store.reload() } }
      }
      .onChange(of: store.rows) { _, rows in
        for row in rows { catalog.noteUsed(row.userCategory) }
      }
  }

  private static func client() -> APIClient? { ServerAddress.saved().map { APIClient(baseURL: $0) } }

  @ViewBuilder private var content: some View {
    if let error = store.error, store.rows.isEmpty {
      ErrorView(error: error, server: server) { Task { await store.reload() } }
    } else if store.total == nil {
      ProgressView()
    } else if store.rows.isEmpty {
      // Scrollable so pull-to-sync works here too: with no rows, it is the
      // only way to fetch the first ones.
      ScrollView {
        emptyState.containerRelativeFrame(.vertical)
      }
      .refreshable { await store.sync() }
    } else {
      list
    }
  }

  private var list: some View {
    List {
      Section {
        ForEach(store.rows) { row in
          NavigationLink(value: TransactionRoute(id: row.id)) {
            TransactionRow(transaction: row)
          }
          .onAppear {
            if row.id == store.rows.last?.id { Task { await store.loadMore() } }
          }
        }
        if store.hasMore {
          pagingFooter
        }
      } header: {
        if let total = store.total {
          Text(total == 1 ? "1 transaction" : "\(total) transactions")
        }
      }
    }
    // Grouped, like the Venmo and Zelle lists, so switching segments keeps
    // the same grey background.
    .listStyle(.insetGrouped)
    .refreshable { await store.sync() }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner {
        Banner(text: banner) { store.banner = nil }
      }
    }
  }

  @ViewBuilder private var pagingFooter: some View {
    if store.loadMoreFailed {
      Button("Couldn't load more — Retry") { Task { await store.loadMore() } }
        .frame(maxWidth: .infinity)
    } else {
      ProgressView()
        .frame(maxWidth: .infinity)
        .onAppear { Task { await store.loadMore() } }
    }
  }

  @ViewBuilder private var emptyState: some View {
    if !store.query.search.isEmpty {
      ContentUnavailableView.search(text: store.query.search)
    } else if !store.query.filtersAreDefault {
      ContentUnavailableView {
        Label("No Matches", systemImage: "line.3.horizontal.decrease.circle")
      } description: {
        Text("No transactions match these filters.")
      } actions: {
        Button("Clear Filters") { update { $0 = TransactionQuery() } }
      }
    } else {
      ContentUnavailableView(
        "No Transactions", systemImage: "list.bullet.rectangle",
        description: Text("Connect an account on your Mac, then pull down here to sync."))
    }
  }

  private var filterMenu: some View {
    let q = store.query
    return Menu {
      Picker("Account", selection: Binding(get: { q.accountId ?? "" }, set: { id in update { $0.accountId = id.isEmpty ? nil : id } })) {
        Text("All accounts").tag("")
        ForEach(accountGroups) { group in
          Section(group.label) {
            ForEach(group.accounts) { Text($0.title).tag($0.id) }
          }
        }
      }
      .pickerStyle(.menu)
      Toggle("Hide transfers & fees", isOn: Binding(get: { q.hideInternal }, set: { v in update { $0.hideInternal = v } }))
      Toggle("Show connected payments", isOn: Binding(get: { q.showLinked }, set: { v in update { $0.showLinked = v } }))
      Section("Sort") {
        Picker("Sort by", selection: Binding(get: { q.sort }, set: { v in update { $0.sort = v } })) {
          Text("Date").tag(TransactionQuery.Sort.date)
          Text("Number (#)").tag(TransactionQuery.Sort.label)
        }
        Picker("Order", selection: Binding(get: { q.ascending }, set: { v in update { $0.ascending = v } })) {
          Text(q.sort == .date ? "Newest first" : "Highest first").tag(false)
          Text(q.sort == .date ? "Oldest first" : "Lowest first").tag(true)
        }
      }
    } label: {
      Label("Filter", systemImage: q.filtersAreDefault
        ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
    }
  }

  /// Changes the filters, saves them, and reloads from page 1.
  private func update(_ change: (inout TransactionQuery) -> Void) {
    var q = store.query
    change(&q)
    q.search = search
    var toSave = q
    toSave.search = ""
    savedFilters = (try? JSONEncoder().encode(toSave)) ?? Data()
    Task { await store.apply(q) }
  }

  private func restoredFilters() -> TransactionQuery {
    (try? JSONDecoder().decode(TransactionQuery.self, from: savedFilters)) ?? TransactionQuery()
  }
}
```


`ios/BudgetPhone/Transactions/TransactionsView.swift`:

```swift
import SwiftUI

/// The Transactions tab: Ledger, Venmo and Zelle behind a segmented control —
/// the web sidebar's three children. Each segment keeps its own store, so
/// switching does not reload the others.
struct TransactionsView: View {
  enum Segment: String, CaseIterable, Identifiable {
    case ledger, venmo, zelle
    var id: Self { self }
    var title: String {
      switch self {
      case .ledger: "Ledger"
      case .venmo: "Venmo"
      case .zelle: "Zelle"
      }
    }
  }

  @SceneStorage("transactions.segment") private var segment: Segment = .ledger
  @Environment(\.scenePhase) private var scenePhase

  @State private var ledger = TransactionsStore(client: Self.client)
  @State private var venmo = P2PStore(source: .venmo, client: Self.client)
  @State private var zelle = P2PStore(source: .zelle, client: Self.client)
  @State private var catalog = CategoryCatalog(client: Self.client)
  @State private var proMode = ProMode(client: Self.client)

  static func client() -> APIClient? { ServerAddress.saved().map { APIClient(baseURL: $0) } }

  var body: some View {
    NavigationStack {
      Group {
        switch segment {
        case .ledger: LedgerView(store: ledger, catalog: catalog, proMode: proMode)
        case .venmo: P2PCategorizerView(store: venmo, ledger: ledger)
        case .zelle: P2PCategorizerView(store: zelle, ledger: ledger)
        }
      }
      .navigationTitle("Transactions")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) {
          Picker("Section", selection: $segment) {
            ForEach(Segment.allCases) { Text($0.title).tag($0) }
          }
          .pickerStyle(.segmented)
          .fixedSize()
        }
      }
      .navigationDestination(for: TransactionRoute.self) { route in
        TransactionDetailView(id: route.id, store: ledger, catalog: catalog, proMode: proMode)
      }
    }
    .task {
      await catalog.load()
      await proMode.load()
    }
    // Another device may have changed categories or the mode meanwhile.
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      Task {
        await catalog.load()
        await proMode.load()
      }
    }
  }
}

/// Pushes a transaction's detail screen. By id, so the screen always shows
/// the store's latest copy of the row.
struct TransactionRoute: Hashable {
  let id: String
}
```


`ios/BudgetPhone/App/RootView.swift` — full replacement:

```swift
import SwiftUI

/// First launch asks for the server; after that, the tabs.
struct RootView: View {
  @AppStorage(ServerAddress.storageKey) private var server = ""

  var body: some View {
    if ServerAddress.normalize(server) == nil {
      ServerSetupView()
    } else {
      TabView {
        Tab("Accounts", systemImage: "building.columns") {
          AccountsView()
        }
        Tab("Transactions", systemImage: "list.bullet.rectangle") {
          TransactionsView()
        }
        Tab("Settings", systemImage: "gear") {
          SettingsView()
        }
      }
    }
  }
}
```


- [ ] **Step 2: Build and test**

Run: `xcodebuild build -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet` — expected: no errors or warnings. Then `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet` — expected: exit 0 (108 test cases pass in total).

- [ ] **Step 3: Commit**

```bash
git add ios
git commit -m "Add the Transactions tab: ledger, Venmo and Zelle

Co-Authored-By: <your model's attribution line>"
```

---

### Task 8: README, simulator checks and pre-merge checks

**Files:**
- Modify: `ios/README.md` (full replacement)

- [ ] **Step 1: Update the README**


`ios/README.md` — full replacement:

````markdown
# Budget for iPhone

A native SwiftUI client for the Budget web app. It reads and edits the same
data by calling the web app's own API, so the Budget server has to be running
somewhere the phone can reach.

Screens so far:

- **Accounts** — net worth, balances, due dates; refresh from Plaid; rename a
  card or set its due day and limit.
- **Transactions** — the ledger with search, filters, sort and Sync; each
  row's category, link to a purchase, splits (Pro), refunds and Venmo
  breakdown; the Venmo and Zelle categorizers, with Venmo CSV import.

Designs: `../docs/superpowers/specs/2026-09-26-ios-accounts-design.md`,
`../docs/superpowers/specs/2026-09-26-ios-transactions-design.md`.

## Run in the simulator

```bash
open BudgetPhone.xcodeproj
```

Pick an iPhone simulator and press Run (⌘R). On first launch, enter
`http://localhost:3000` — the simulator shares the Mac's network.

Tests: ⌘U in Xcode, or

```bash
xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData
```

## Run on your iPhone (free Apple ID)

1. `cp Config/Local.example.xcconfig Config/Local.xcconfig`
2. Xcode → Settings → Accounts → add your Apple ID. It creates a free
   "Personal Team". Click that team to see its ten-character Team ID (or
   find it in Keychain Access, under the "Apple Development" certificate's
   Organizational Unit). Put it in `DEVELOPMENT_TEAM` in
   `Config/Local.xcconfig` **before** opening the project.
3. Open the project and select the **BudgetPhone** target → Signing &
   Capabilities. With the Team ID already in `Local.xcconfig`, it should
   show your Personal Team without you touching the picker — leave it as is.
   If Xcode says the bundle identifier is taken, change `BUNDLE_ID_PREFIX` in
   `Local.xcconfig` too.

   Doing it in this order matters: picking the team from the Signing &
   Capabilities picker instead writes your Team ID straight into the tracked
   `BudgetPhone.xcodeproj/project.pbxproj`, a public repo. If that happens,
   run `git checkout -- BudgetPhone.xcodeproj/project.pbxproj` before
   committing — `scripts/test-scrub.sh` also fails the build if a Team ID
   slips into the project file.
4. Connect the iPhone by cable. On the phone: Settings → Privacy & Security →
   Developer Mode → on (it restarts).
5. Choose the iPhone as the run destination and press Run. The first time,
   trust the developer on the phone: Settings → General → VPN & Device
   Management.
6. In the app, enter the Mac's address, e.g. `http://your-mac.local:3000`
   (System Settings → General → Sharing shows the `.local` name). Allow
   local-network access when iOS asks.

**Every 7 days** a free signature expires and the app stops opening. Connect
the phone and press Run again; nothing on the phone is lost.

## Away from home

The server has no login, so it is only reachable on your own network. To use
the app elsewhere, install Tailscale on the Mac and the iPhone, then put the
Mac's Tailscale IP (`100.x.y.z`) in the app's Settings — plain `http` works
there. A MagicDNS name ending in `.ts.net` needs `https`; ATS blocks plain
`http` to it. Add authentication to the server before running it anywhere
permanently — see the design doc.
````


- [ ] **Step 2: Simulator checks against the live server (read-only)**

Budget must be running (`lsof -nP -iTCP:3000 -sTCP:LISTEN`). Build and install as in the Accounts plan (bundle `local.budget.BudgetPhone`, `serverURL` = `http://localhost:3000` via `simctl spawn … defaults write`). If the simulator panel tool is available, drive it by taps; otherwise use `xcrun simctl`. **Only GETs** — do not change a category, link, split, sync or import against the real server; those are for the user to run.

Check and record in the report (no real names or amounts in the report — say matched / did not match):
1. Transactions tab → Ledger: the count line equals `total` from `curl -s 'http://localhost:3000/api/transactions?page=1&limit=50&hideInternal=true&hideLinked=true&sort=date&dir=desc'`, and the first rows' serials, dates and amounts match that response.
2. Switching Ledger → Venmo → Zelle keeps the segmented control in the same centred position and the same grey background.
3. Filter menu: toggling "Hide transfers & fees" off changes the count to that of the same curl with `hideInternal=false`; Sort → Number reorders by `#`. Restore the defaults afterwards.
4. Search: typing a merchant from row 1 narrows the list; clearing restores it.
5. Scroll to the bottom: further pages load until the count is reached.
6. A row's detail screen shows its category, and for a split / refunded / cash-out row (find one via curl) the matching section.
7. Venmo and Zelle segments: totals equal the web page's three figures.
8. Dark mode and the largest accessibility size render without clipped amounts.

- [ ] **Step 3: Checks**

Run from `budget-claude/`: `npm test` (scrub, launcher, node tests, lint — all pass) and the iOS test command from `ios/`.

- [ ] **Step 4: Commit**

```bash
git add ios
git commit -m "Document the iPhone app's Transactions screens

Co-Authored-By: <your model's attribution line>"
```

- [ ] **Step 5: Merge readiness (do not merge)**

From the repository root: `git log --oneline $(git merge-base main ios-transactions)..main` and `git merge-tree --write-tree main ios-transactions >/dev/null && echo clean || echo CONFLICTS`. Report both. Merging waits for the user.
