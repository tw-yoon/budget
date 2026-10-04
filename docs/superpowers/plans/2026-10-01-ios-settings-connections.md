# iPhone Settings → Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Debit cards (list, add, remove) and connected banks (list, disconnect) on the phone. Connecting or reconnecting a bank stays on the Mac.

**Architecture:**
- Task 1: models, a fixture, and `ConnectionText`.
- Task 2: `APIClient+Connections.swift`.
- Task 3: `ConnectionsStore`.
- Task 4: `ConnectionsView`, `AddDebitCardSheet`, and the Settings row.

**Tech Stack:** Swift 6, SwiftUI, iOS 26, Swift Testing, `StubURLProtocol`.

**Spec:** `docs/superpowers/specs/2026-10-01-ios-settings-connections-design.md`

## Global Constraints

- Work in `ios/` on branch `ios-settings-connections`. Read `ios/CLAUDE.md` first. It is binding.
- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. **Never overwrite an existing fixture.** `connections.json` is new; if it exists, stop and report.
- Test command, run from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Run `bash ../scripts/test-scrub.sh` before every commit.
- Suites using `StubURLProtocol` nest as `extension StubbedNetworkTests { @Suite(.serialized) … }`.
- Inside `Task { }`, use `do throws(APIError) { … }`. Writes go through `ConnectionWrite`. Never pass an `@MainActor @Sendable` closure into `Binding(set:)`.
- Wording comes verbatim from `../src/components/DebitCards.tsx` and `ConnectedBanks.tsx`, except where the spec says otherwise. In string literals, write non-ASCII characters (`·` U+00B7, `…` U+2026) as `\u{…}` escapes.
- **The live server holds real money data.** Implementers never run the app. Tests use `StubURLProtocol` only, and fixtures use invented values only.
- `../.gitignore` and `../../dashboardv1/` are unrelated; never stage them.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Models and wording

**Files:**
- Create: `ios/BudgetPhone/Models/ConnectionModels.swift`
- Create: `ios/BudgetPhone/Support/ConnectionText.swift`
- Create: `ios/BudgetPhoneTests/Fixtures/connections.json`
- Test: `ios/BudgetPhoneTests/ConnectionTextTests.swift`

**Interfaces (produces):**
- `BankSummary: Identifiable { itemId, institution: String; accountCount: Int; id == itemId }`
- `DebitCardDTO: Identifiable { id, name, last4, accountId, accountName: String; available: Double? }`
- `ConnectionsResponse { groups: [AccountGroup]; banks: [BankSummary]; debitCards: [DebitCardDTO]; checkingAccounts: [AccountDTO] (computed) }`
- `NewDebitCard: Encodable { name, last4, accountId }`
- `enum ConnectionText`: `plural`, `bankLine`, `disconnectTitle`, `disconnectMessage`, `cardLine`, `removeTitle`, `available`, `noCards`, `noChecking`, `macFooter`, `cleanLast4`, `accountLabel`

- [ ] **Step 1: Fixture** (invented values; confirm the file doesn't exist first)

`ios/BudgetPhoneTests/Fixtures/connections.json`:
```json
{
  "groups": [
    { "type": "DEPOSITORY", "label": "Cash", "subtotal": 1500, "isLiability": false,
      "accounts": [
        { "id": "a1", "name": "Sample Checking", "officialName": null, "mask": "0001",
          "type": "DEPOSITORY", "subtype": "checking", "currentBalance": 1500,
          "availableBalance": 1450, "balanceFetchedAt": "2026-10-01T12:00:00.000Z",
          "institution": "Example Bank", "isLiability": false, "nextPaymentDueDate": null,
          "lastStatementBalance": null, "minimumPaymentAmount": null, "paymentIsOverdue": null,
          "displayName": "Everyday", "manualDueDay": null, "manualCreditLimit": null },
        { "id": "a2", "name": "Sample Savings", "officialName": null, "mask": "0003",
          "type": "DEPOSITORY", "subtype": "savings", "currentBalance": 0,
          "availableBalance": null, "balanceFetchedAt": "2026-10-01T12:00:00.000Z",
          "institution": "Example Bank", "isLiability": false, "nextPaymentDueDate": null,
          "lastStatementBalance": null, "minimumPaymentAmount": null, "paymentIsOverdue": null,
          "displayName": null, "manualDueDay": null, "manualCreditLimit": null }
      ] }
  ],
  "summary": { "totalAssets": 1500, "totalLiabilities": 0, "netWorth": 1500, "accountCount": 2,
               "lastRefreshed": "2026-10-01T12:00:00.000Z" },
  "banks": [
    { "itemId": "item-sample-abc123", "institution": "Example Bank", "accountCount": 2 },
    { "itemId": "item-sample-zzz999", "institution": "Sample Credit Union", "accountCount": 1 }
  ],
  "debitCards": [
    { "id": "d1", "name": "Sample Debit", "last4": "0002", "accountId": "a1",
      "accountName": "Everyday", "available": 1450 },
    { "id": "d2", "name": "Spare Debit", "last4": "0004", "accountId": "a1",
      "accountName": "Everyday", "available": null }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`ios/BudgetPhoneTests/ConnectionTextTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

/// Settings → Connections: decoding and wording
/// (../src/components/DebitCards.tsx, ConnectedBanks.tsx), with no network.
struct ConnectionTextTests {
  func data() throws -> ConnectionsResponse {
    try JSONDecoder().decode(ConnectionsResponse.self, from: TestData.fixture("connections"))
  }

  @Test func decodesTheFixture() throws {
    let d = try data()
    #expect(d.banks.map(\.id) == ["item-sample-abc123", "item-sample-zzz999"])
    #expect(d.debitCards.map(\.id) == ["d1", "d2"])
    #expect(d.debitCards[1].available == nil)
    #expect(d.checkingAccounts.map(\.id) == ["a1", "a2"], "the DEPOSITORY group's accounts")
  }

  @Test func noDepositoryGroupMeansNoCheckingAccounts() throws {
    let json = #"{"groups":[],"banks":[],"debitCards":[]}"#
    let d = try JSONDecoder().decode(ConnectionsResponse.self, from: Data(json.utf8))
    #expect(d.checkingAccounts.isEmpty)
  }

  @Test func bankLine() throws {
    let d = try data()
    #expect(ConnectionText.bankLine(d.banks[0]) == "2 accounts \u{00B7} id \u{2026}abc123")
    #expect(ConnectionText.bankLine(d.banks[1]) == "1 account \u{00B7} id \u{2026}zzz999")
  }

  @Test func disconnectWording() throws {
    let b = try data().banks[0]
    #expect(ConnectionText.disconnectTitle(b) == "Disconnect Example Bank?")
    #expect(ConnectionText.disconnectMessage(b)
      == "This removes its 2 account(s) and their transactions from this app and revokes the Plaid connection. It cannot be undone (you'd reconnect to get the data back).")
  }

  @Test func cardWording() throws {
    let d = try data()
    #expect(ConnectionText.cardLine(d.debitCards[0]) == "\u{00B7}\u{00B7}0002 \u{00B7} draws from Everyday")
    #expect(ConnectionText.removeTitle(d.debitCards[0]) == "Remove debit card Sample Debit \u{00B7}\u{00B7}0002?")
    #expect(ConnectionText.available(d.debitCards[0]) == "$1,450.00 available")
    #expect(ConnectionText.available(d.debitCards[1]) == nil)
  }

  @Test func fixedStrings() {
    #expect(ConnectionText.noCards == "No debit cards yet.")
    #expect(ConnectionText.noChecking == "Connect a checking account first, then add the debit card linked to it.")
    #expect(ConnectionText.macFooter
      == "To connect a bank or investment account, or reconnect one, use Budget on your Mac.")
  }

  @Test func cleanLast4KeepsAtMostFourDigits() {
    #expect(ConnectionText.cleanLast4("12a3-45") == "1234")
    #expect(ConnectionText.cleanLast4("98") == "98")
    #expect(ConnectionText.cleanLast4("") == "")
  }

  @Test func accountLabelPrefersTheDisplayName() throws {
    let accounts = try data().checkingAccounts
    #expect(ConnectionText.accountLabel(accounts[0]) == "Everyday")
    #expect(ConnectionText.accountLabel(accounts[1]) == "Sample Savings")
  }
}
```

- [ ] **Step 3: Run the tests and confirm they fail to compile**

- [ ] **Step 4: Models**

`ios/BudgetPhone/Models/ConnectionModels.swift`:
```swift
import Foundation

// Settings → Connections' view of GET /api/accounts, plus the debit-card
// write body. Mirrors BankSummary and DebitCardDTO in src/types/index.ts.

struct BankSummary: Decodable, Equatable, Sendable, Identifiable {
  let itemId: String
  let institution: String
  let accountCount: Int

  var id: String { itemId }
}

struct DebitCardDTO: Decodable, Equatable, Sendable, Identifiable {
  let id: String
  let name: String
  let last4: String
  let accountId: String
  let accountName: String
  let available: Double?
}

/// GET /api/accounts, read for Connections. `summary` is not needed here, so
/// it is not decoded; the Accounts tab keeps its own `AccountsResponse`.
struct ConnectionsResponse: Decodable, Equatable, Sendable {
  let groups: [AccountGroup]
  let banks: [BankSummary]
  let debitCards: [DebitCardDTO]

  /// The accounts a debit card can draw from — SettingsConnections'
  /// `groups.find(g => g.type === "DEPOSITORY")?.accounts ?? []`.
  var checkingAccounts: [AccountDTO] {
    groups.first { $0.type == "DEPOSITORY" }?.accounts ?? []
  }
}

/// POST /api/debit-cards — the three fields AddForm sends.
struct NewDebitCard: Encodable, Equatable, Sendable {
  let name: String
  let last4: String
  let accountId: String
}
```

- [ ] **Step 5: `ConnectionText`**

`ios/BudgetPhone/Support/ConnectionText.swift`:
```swift
import Foundation

/// Settings → Connections' wording, ported from ../src/components/DebitCards.tsx
/// and ConnectedBanks.tsx. `macFooter` is the phone's own: Plaid Link stays
/// on the Mac.
enum ConnectionText {
  static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

  /// "2 accounts · id …abc123"
  static func bankLine(_ b: BankSummary) -> String {
    "\(plural(b.accountCount, "account")) \u{00B7} id \u{2026}\(b.itemId.suffix(6))"
  }

  static func disconnectTitle(_ b: BankSummary) -> String { "Disconnect \(b.institution)?" }

  static func disconnectMessage(_ b: BankSummary) -> String {
    "This removes its \(b.accountCount) account(s) and their transactions from this app and revokes the Plaid connection. It cannot be undone (you'd reconnect to get the data back)."
  }

  /// "··0002 · draws from Everyday"
  static func cardLine(_ c: DebitCardDTO) -> String {
    "\u{00B7}\u{00B7}\(c.last4) \u{00B7} draws from \(c.accountName)"
  }

  static func removeTitle(_ c: DebitCardDTO) -> String {
    "Remove debit card \(c.name) \u{00B7}\u{00B7}\(c.last4)?"
  }

  /// "$1,450.00 available", or nil when the balance is unknown.
  static func available(_ c: DebitCardDTO) -> String? {
    c.available.map { "\(Formatters.currency($0)) available" }
  }

  static let noCards = "No debit cards yet."
  static let noChecking = "Connect a checking account first, then add the debit card linked to it."
  static let macFooter =
    "To connect a bank or investment account, or reconnect one, use Budget on your Mac."

  /// AddForm's `replace(/\D/g, "").slice(0, 4)`.
  static func cleanLast4(_ raw: String) -> String {
    String(raw.filter(\.isASCII).filter(\.isNumber).prefix(4))
  }

  /// The account picker's label: `displayName ?? name`.
  static func accountLabel(_ a: AccountDTO) -> String { a.displayName ?? a.name }
}
```

- [ ] **Step 6: Run the tests and confirm they pass** — the full suite.

- [ ] **Step 7: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Models/ConnectionModels.swift BudgetPhone/Support/ConnectionText.swift BudgetPhoneTests/Fixtures/connections.json BudgetPhoneTests/ConnectionTextTests.swift
git commit -m "Add the connection models and the web's connection wording to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Networking

**Files:**
- Create: `ios/BudgetPhone/Networking/APIClient+Connections.swift`
- Test: `ios/BudgetPhoneTests/ConnectionsAPITests.swift`

**Interfaces:** produces `connections() -> ConnectionsResponse`, `addDebitCard(_:)`, `removeDebitCard(id:)`, `disconnectBank(itemId:)`. All are `async throws(APIError)`.

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/ConnectionsAPITests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Connections: each call's method, path and exact body.
  @Suite(.serialized)
  struct ConnectionsAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    func only() throws -> URLRequest {
      #expect(StubURLProtocol.requests.count == 1)
      return try #require(StubURLProtocol.requests.first)
    }

    func body(_ r: URLRequest) throws -> NSDictionary {
      let data = try #require(StubURLProtocol.body(of: r))
      return try #require(try JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    @Test func connectionsReadsTheAccountsRoute() async throws {
      let c = client { _ in (200, try TestData.fixture("connections")) }
      let d = try await c.connections()
      #expect(d.banks.count == 2)
      let r = try only()
      #expect(r.httpMethod == "GET")
      #expect(r.url?.path() == "/api/accounts")
    }

    @Test func addSendsExactlyTheThreeFields() async throws {
      let c = client { _ in (200, Data(#"{"id":"d9"}"#.utf8)) }
      try await c.addDebitCard(NewDebitCard(name: "Sample Debit", last4: "0002", accountId: "a1"))
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/debit-cards")
      #expect(try body(r) == ["name": "Sample Debit", "last4": "0002", "accountId": "a1"] as NSDictionary)
    }

    @Test func addCarriesTheServerMessage() async throws {
      let c = client { _ in (400, Data(#"{"error":"Last 4 must be exactly 4 digits"}"#.utf8)) }
      await #expect(throws: APIError.server(status: 400, message: "Last 4 must be exactly 4 digits")) {
        try await c.addDebitCard(NewDebitCard(name: "Sample Debit", last4: "12", accountId: "a1"))
      }
    }

    @Test func removeSendsNoBody() async throws {
      let c = client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      try await c.removeDebitCard(id: "d1")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/debit-cards/d1")
      #expect(StubURLProtocol.body(of: r) == nil)
    }

    @Test func disconnectSendsNoBody() async throws {
      let c = client { _ in (200, Data(#"{"ok":true,"institution":"Example Bank","removedAccounts":2}"#.utf8)) }
      try await c.disconnectBank(itemId: "item-sample-abc123")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/plaid/items/item-sample-abc123")
      #expect(StubURLProtocol.body(of: r) == nil)
    }
  }
}
```

- [ ] **Step 2: Run the tests and confirm they fail to compile**

- [ ] **Step 3: The calls**

`ios/BudgetPhone/Networking/APIClient+Connections.swift`:
```swift
import Foundation

// Settings → Connections (../src/app/api/debit-cards/**,
// ../src/app/api/plaid/items/[itemId]). Connecting a bank (Plaid Link)
// stays on the Mac, so the link-token routes have no calls here.

extension APIClient {
  /// GET /api/accounts, read for its `banks`, `debitCards` and checking accounts.
  func connections() async throws(APIError) -> ConnectionsResponse {
    try decode(await send("GET", "api/accounts", timeout: 15))
  }

  /// POST /api/debit-cards — `{ name, last4, accountId }`.
  func addDebitCard(_ card: NewDebitCard) async throws(APIError) {
    _ = try await send("POST", "api/debit-cards", body: encode(card), timeout: 15)
  }

  /// DELETE /api/debit-cards/:id.
  func removeDebitCard(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/debit-cards/\(id)", timeout: 15)
  }

  /// DELETE /api/plaid/items/:itemId — revokes the Plaid item and removes
  /// its accounts and transactions. It calls Plaid, hence the long timeout.
  func disconnectBank(itemId: String) async throws(APIError) {
    _ = try await send("DELETE", "api/plaid/items/\(itemId)", timeout: 60)
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass** — the full suite.

- [ ] **Step 5: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Networking/APIClient+Connections.swift BudgetPhoneTests/ConnectionsAPITests.swift
git commit -m "Add the connection API calls to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `ConnectionsStore`

**Files:**
- Create: `ios/BudgetPhone/Settings/ConnectionsStore.swift`
- Test: `ios/BudgetPhoneTests/ConnectionsStoreTests.swift`

**Interfaces:**
- Produces `enum ConnectionWrite: Equatable, Sendable { removeCard(id:), disconnect(itemId:) }`.
- Produces `@MainActor @Observable final class ConnectionsStore`, with `init(client:)`.
- Read-only state (`private(set)`): `data: ConnectionsResponse?`, `error: APIError?`, `isLoading`, `isSaving`.
- Settable: `var banner: String?`.
- Methods: `load() async`, `perform(_:) async`, `add(_ card: NewDebitCard) async throws(APIError)`.

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/ConnectionsStoreTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Connections: the store's failure rules and its writes.
  @Suite(.serialized)
  @MainActor
  struct ConnectionsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func store(
      gates: [Gate] = [], _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> ConnectionsStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler, gates: gates))
      return ConnectionsStore { c }
    }

    nonisolated static func fixture() -> (Int, Data) { (200, (try? TestData.fixture("connections")) ?? Data()) }
    nonisolated static let fail: (Int, Data) = (500, Data(#"{"error":"Failed to load accounts"}"#.utf8))
    nonisolated static func isWrite(_ r: URLRequest) -> Bool { r.httpMethod != "GET" }

    nonisolated static func answering(_ write: (Int, Data)) -> (URLRequest) -> (Int, Data) {
      { r in r.httpMethod == "GET" ? fixture() : write }
    }

    func methods() -> [String] { StubURLProtocol.requests.compactMap(\.httpMethod) }

    @Test func aFirstLoadFailureIsFullScreen() async {
      let s = store { _ in Self.fail }
      await s.load()
      #expect(s.data == nil)
      #expect(s.error == .server(status: 500, message: "Failed to load accounts"))
    }

    @Test func aFailureOverDataIsABannerAndTheDataStays() async {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let s = store { _ in
        count.n += 1
        return count.n == 1 ? Self.fixture() : Self.fail
      }
      await s.load()
      await s.load()
      #expect(s.data?.banks.count == 2)
      #expect(s.error == nil)
      #expect(s.banner == "Failed to load accounts")
    }

    @Test func aSuccessfulLoadClearsTheBanner() async {
      let s = store { _ in Self.fixture() }
      s.banner = "old"
      await s.load()
      #expect(s.banner == nil)
    }

    @Test func aCancelledLoadIsSilent() async {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let s = store { _ in
        count.n += 1
        if count.n == 1 { return Self.fixture() }
        throw URLError(.cancelled)
      }
      await s.load()
      await s.load()
      #expect(s.banner == nil)
      #expect(s.error == nil)
    }

    @Test func aRemovalReloads() async {
      let s = store(Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      await s.perform(.removeCard(id: "d1"))
      #expect(methods() == ["GET", "DELETE", "GET"])
      #expect(s.banner == nil)
    }

    @Test func aFailedDisconnectShowsTheServerMessageWithoutReloading() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to disconnect bank"}"#.utf8))))
      await s.load()
      await s.perform(.disconnect(itemId: "item-sample-abc123"))
      #expect(s.banner == "Failed to disconnect bank")
      #expect(methods() == ["GET", "DELETE"])
      #expect(!s.isSaving)
    }

    @Test func aWriteClearsAStaleBannerBeforeItsRequest() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      s.banner = "stale"
      let running = Task { await s.perform(.removeCard(id: "d1")) }
      await write.arrival()
      #expect(s.banner == nil)
      #expect(s.isSaving)
      write.open()
      await running.value
      #expect(!s.isSaving)
    }

    @Test func aSecondWriteWhileOneIsInFlightSendsNothing() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      let first = Task { await s.perform(.removeCard(id: "d1")) }
      await write.arrival()
      await s.perform(.disconnect(itemId: "item-sample-abc123"))
      write.open()
      await first.value
      #expect(methods().filter { $0 == "DELETE" }.count == 1)
    }

    @Test func aCancelledWriteIsSilent() async {
      let s = store { r in
        if r.httpMethod == "GET" { return Self.fixture() }
        throw URLError(.cancelled)
      }
      await s.load()
      await s.perform(.disconnect(itemId: "item-sample-abc123"))
      #expect(s.banner == nil)
      #expect(methods() == ["GET", "DELETE"])
    }

    @Test func addClearsAStaleBannerAndThrowsTheServerMessage() async {
      let s = store(Self.answering((400, Data(#"{"error":"Card name is required"}"#.utf8))))
      await s.load()
      s.banner = "stale"
      await #expect(throws: APIError.server(status: 400, message: "Card name is required")) {
        try await s.add(NewDebitCard(name: "", last4: "0002", accountId: "a1"))
      }
      #expect(s.banner == nil)
      #expect(methods() == ["GET", "POST"])
    }

    @Test func addReloadsOnSuccess() async throws {
      let s = store(Self.answering((200, Data(#"{"id":"d9"}"#.utf8))))
      await s.load()
      try await s.add(NewDebitCard(name: "Sample Debit", last4: "0002", accountId: "a1"))
      #expect(methods() == ["GET", "POST", "GET"])
    }
  }
}
```

- [ ] **Step 2: Run the tests and confirm they fail to compile**

- [ ] **Step 3: The store**

`ios/BudgetPhone/Settings/ConnectionsStore.swift`:
```swift
import Foundation
import Observation

/// One Settings → Connections write. An enum rather than a closure, so the
/// store keeps the typed error (see TransactionDetailView.Write).
enum ConnectionWrite: Equatable, Sendable {
  case removeCard(id: String)
  case disconnect(itemId: String)
}

/// What Settings → Connections shows (../src/components/SettingsConnections.tsx):
/// debit cards and connected banks. Same failure rules as the other stores:
/// with nothing on screen an error is full-screen; with data showing it
/// becomes a banner and the data stays.
@MainActor
@Observable
final class ConnectionsStore {
  private(set) var data: ConnectionsResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// One write at a time.
  private(set) var isSaving = false
  var banner: String?

  private let client: @MainActor () -> APIClient?
  private var loadGeneration = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  func load() async {
    loadGeneration += 1
    let generation = loadGeneration
    guard let client = client() else {
      data = nil
      error = .notConfigured
      return
    }
    if data == nil { error = nil }
    isLoading = true
    defer { if generation == loadGeneration { isLoading = false } }
    do throws(APIError) {
      let result = try await client.connections()
      guard generation == loadGeneration else { return }
      data = result
      error = nil
      banner = nil
    } catch {
      guard generation == loadGeneration else { return }
      if error == .cancelled { return }
      if data == nil { self.error = error } else { banner = error.message }
    }
  }

  /// Runs one write. A stale banner clears before the request; success
  /// reloads, failure shows the server's message and leaves the list as is.
  func perform(_ write: ConnectionWrite) async {
    guard !isSaving else { return }
    guard let client = client() else {
      banner = APIError.notConfigured.message
      return
    }
    isSaving = true
    defer { isSaving = false }
    banner = nil
    do throws(APIError) {
      switch write {
      case .removeCard(let id): try await client.removeDebitCard(id: id)
      case .disconnect(let itemId): try await client.disconnectBank(itemId: itemId)
      }
    } catch {
      if error != .cancelled { banner = error.message }
      return
    }
    await load()
  }

  /// The Add sheet's submit. Throws so the sheet keeps its fields and shows why.
  func add(_ card: NewDebitCard) async throws(APIError) {
    guard let client = client() else { throw .notConfigured }
    banner = nil
    try await client.addDebitCard(card)
    await load()
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass** — the full suite.

- [ ] **Step 5: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Settings/ConnectionsStore.swift BudgetPhoneTests/ConnectionsStoreTests.swift
git commit -m "Add the Connections store to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Screens and wiring

**Files:**
- Create: `ios/BudgetPhone/Settings/ConnectionsView.swift`
- Create: `ios/BudgetPhone/Settings/AddDebitCardSheet.swift`
- Modify: `ios/BudgetPhone/Settings/SettingsView.swift`
- Modify: `ios/README.md`

**Interfaces:**
- Consumes: `ConnectionsStore`, `ConnectionWrite`, `ConnectionText`, `NewDebitCard`, `Banner`, `ErrorView(error:server:retry:)`.
- Produces: `ConnectionsView(store:)` and `AddDebitCardSheet(store:accounts:)`.

There are no unit tests for views. Verification is the build plus the full test run. Implementers do **not** run the app.

- [ ] **Step 1: The list**

`ios/BudgetPhone/Settings/ConnectionsView.swift`:
```swift
import SwiftUI

/// Settings → Connections (../src/components/SettingsConnections.tsx):
/// debit cards and connected banks. Swipe removes a card or disconnects a
/// bank, each after asking. Connecting a bank (Plaid Link) stays on the Mac.
/// Pull down to reload (GET only; never Plaid's balance refresh).
struct ConnectionsView: View {
  let store: ConnectionsStore
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false
  @State private var removing: DebitCardDTO?
  @State private var disconnecting: BankSummary?

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Connections")
      .sheet(isPresented: $adding) {
        AddDebitCardSheet(store: store, accounts: store.data?.checkingAccounts ?? [])
      }
      .alert(
        removing.map(ConnectionText.removeTitle) ?? "",
        isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
        presenting: removing
      ) { card in
        Button("Remove", role: .destructive) { Task { await store.perform(.removeCard(id: card.id)) } }
        Button("Cancel", role: .cancel) {}
      }
      .alert(
        disconnecting.map(ConnectionText.disconnectTitle) ?? "",
        isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }),
        presenting: disconnecting
      ) { bank in
        Button("Disconnect", role: .destructive) {
          Task { await store.perform(.disconnect(itemId: bank.itemId)) }
        }
        Button("Cancel", role: .cancel) {}
      } message: { bank in
        Text(ConnectionText.disconnectMessage(bank))
      }
      .task { await store.load() }
  }

  @ViewBuilder private var content: some View {
    if let data = store.data {
      list(data)
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView()
    }
  }

  private func list(_ data: ConnectionsResponse) -> some View {
    List {
      Section {
        ForEach(data.debitCards) { card in
          DebitCardRow(card: card)
            .swipeActions {
              Button("Remove", systemImage: "trash", role: .destructive) { removing = card }
                .disabled(store.isSaving)
            }
        }
        if !data.checkingAccounts.isEmpty {
          Button("Add Debit Card") { adding = true }.disabled(store.isSaving)
        }
      } header: {
        Text("Debit Cards")
      } footer: {
        if data.debitCards.isEmpty {
          Text(data.checkingAccounts.isEmpty ? ConnectionText.noChecking : ConnectionText.noCards)
        }
      }
      Section {
        ForEach(data.banks) { bank in
          VStack(alignment: .leading, spacing: 2) {
            Text(bank.institution)
            Text(ConnectionText.bankLine(bank)).font(.footnote).foregroundStyle(.secondary)
          }
          .swipeActions {
            Button("Disconnect", systemImage: "link.badge.minus", role: .destructive) { disconnecting = bank }
              .disabled(store.isSaving)
          }
        }
      } header: {
        Text("Connected Banks")
      } footer: {
        Text(ConnectionText.macFooter)
      }
    }
    .listStyle(.insetGrouped)
    .refreshable {
      store.banner = nil
      await store.load()
    }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
    }
  }
}

/// One debit card: name, "··0002 · draws from …", and the available amount.
/// At accessibility sizes the amount stacks under the label so it never
/// wraps mid-number.
private struct DebitCardRow: View {
  let card: DebitCardDTO
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 4) {
        label
        amount
      }
    } else {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        label
        Spacer(minLength: 0)
        amount
      }
    }
  }

  private var label: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(card.name)
      Text(ConnectionText.cardLine(card)).font(.footnote).foregroundStyle(.secondary)
    }
  }

  @ViewBuilder private var amount: some View {
    if let available = ConnectionText.available(card) {
      Text(available).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
    }
  }
}
```

- [ ] **Step 2: The Add sheet**

`ios/BudgetPhone/Settings/AddDebitCardSheet.swift`:
```swift
import SwiftUI

/// DebitCards' AddForm as a sheet. Add waits for a name and four digits; the
/// server's own message shows in the form, which keeps its fields.
struct AddDebitCardSheet: View {
  let store: ConnectionsStore
  let accounts: [AccountDTO]
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var last4 = ""
  @State private var accountId = ""
  @State private var saving = false
  @State private var errorMessage: String?

  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Card name (e.g. Chase Debit)", text: $name)
          TextField("Last 4 digits", text: Binding(get: { last4 }, set: { setLast4($0) }))
            .keyboardType(.numberPad)
          Picker("Account", selection: $accountId) {
            ForEach(accounts) { Text(ConnectionText.accountLabel($0)).tag($0.id) }
          }
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Add Debit Card")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save)
              .disabled(trimmedName.isEmpty || last4.count != 4 || accountId.isEmpty)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
    .onAppear { if accountId.isEmpty { accountId = accounts.first?.id ?? "" } }
  }

  private func setLast4(_ raw: String) {
    last4 = ConnectionText.cleanLast4(raw)
  }

  private func save() {
    let card = NewDebitCard(name: trimmedName, last4: last4, accountId: accountId)
    saving = true
    errorMessage = nil
    Task {
      do throws(APIError) {
        try await store.add(card)
        dismiss()
      } catch {
        saving = false
        if error != .cancelled { errorMessage = error.message }
      }
    }
  }
}
```

- [ ] **Step 3: The Settings row**

In `ios/BudgetPhone/Settings/SettingsView.swift`, add `@State private var connections = ConnectionsStore(client: RootView.client)` next to the other stores. Then add this directly under the Rules `NavigationLink`, in the same section:
```swift
          NavigationLink("Connections") { ConnectionsView(store: connections) }
```

- [ ] **Step 4: README**

In `ios/README.md`, extend the Settings bullet with "Connections (debit cards; connected banks, with disconnect — connecting stays on the Mac)" before "and the server address". Add `../docs/superpowers/specs/2026-10-01-ios-settings-connections-design.md` to the README's spec list, after the Rules spec.

- [ ] **Step 5: Build and run every test**

Expected: no new warnings in the touched files, and every suite passes. If `removing.map(ConnectionText.removeTitle)` doesn't type-check, use `removing.map { ConnectionText.removeTitle($0) }`.

- [ ] **Step 6: Self-check the diff for live data** — `git diff main -- . ../docs | grep -n -i -E "bank|card|\\\$[0-9]"`. Only invented values and the web's own placeholder ("Chase Debit", already in `DebitCards.tsx`) are allowed.

- [ ] **Step 7: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Settings README.md
git commit -m "Add Settings → Connections to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
