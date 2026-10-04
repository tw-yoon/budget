# iPhone Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the web's Subscriptions page to the phone: a card on Analytics shows the monthly total and opens a list where you can detect from banks, add and delete.

**Architecture:**
- Task 1: Codable models and four `APIClient` calls.
- Task 2: a `@MainActor @Observable` `SubscriptionsStore`.
- Task 3: SwiftUI views for the list (`SubscriptionsView`, `SubscriptionRow`, `AddSubscriptionSheet`).
- Task 4: a card on `AnalyticsView`, which owns the store and pushes the list.

**Tech Stack:** Swift 6, SwiftUI, iOS 26, Swift Testing, `StubURLProtocol`.

**Spec:** `docs/superpowers/specs/2026-10-01-ios-subscriptions-design.md`

## Global Constraints

- Work in `ios/` on branch `ios-subscriptions`. Read `ios/CLAUDE.md` first. It is binding.
- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. Files under `BudgetPhone/` and `BudgetPhoneTests/` join their targets automatically, and `.json` under `BudgetPhoneTests/Fixtures/` becomes a test resource.
- Test command, run from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Run `bash ../scripts/test-scrub.sh` before every commit.
- Every suite that uses `StubURLProtocol` nests as `extension StubbedNetworkTests { @Suite(.serialized) … }`.
- Inside `Task { }`, use `do throws(APIError) { … }`. Never pass an `@MainActor @Sendable` closure into `Binding(set:)`.
- Ports name their web source in a comment. Wording is copied from the web verbatim, except where the spec says otherwise.
- **The live server holds real money data.** Implementers never run the app. Tests use `StubURLProtocol` only, and fixtures use invented values only.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Models and calls

**Files:**
- Create: `ios/BudgetPhone/Models/SubscriptionModels.swift`
- Create: `ios/BudgetPhone/Networking/APIClient+Subscriptions.swift`
- Create: `ios/BudgetPhoneTests/Fixtures/subscriptions.json`
- Test: `ios/BudgetPhoneTests/SubscriptionModelTests.swift`, `ios/BudgetPhoneTests/SubscriptionAPITests.swift`

**Interfaces (produces):**
- `SubscriptionDTO`: `id`, `name`, `amount`, `cadence`, `cadenceLabel`, `monthlyCost`, `nextDate`, `merchantName`, `accountName`, `source`, `isActive`; computed `isDetected` and `detailLine`; `static nextDateText(_ iso: String) -> String?`
- `SubscriptionsResponse`: `var subscriptions`, `monthlyTotal`; computed `activeCount` and `summary`.
- `DetectResult`: `found`, `errors: [Failure]`; computed `notice`.
- `NewSubscription(name:amount:cadence:nextDate:)`, `static day(_ date: Date, calendar: Calendar = .current) -> String`.
- `Cadence` (`CaseIterable`, `Identifiable`, `rawValue`, `label`).
- `APIClient`: `subscriptions()`, `addSubscription(_:)`, `deleteSubscription(id:)`, `detectSubscriptions()`.

- [ ] **Step 1: Fixture** (invented values only)

`ios/BudgetPhoneTests/Fixtures/subscriptions.json`:
```json
{
  "subscriptions": [
    { "id": "s1", "name": "Sample Stream", "amount": 15.49, "cadence": "MONTHLY", "cadenceLabel": "Monthly",
      "monthlyCost": 15.49, "nextDate": "2026-10-05T00:00:00.000Z", "merchantName": null,
      "accountName": "Sample Rewards Card", "source": "MANUAL", "isActive": true },
    { "id": "s2", "name": "Example Music", "amount": 120, "cadence": "YEARLY", "cadenceLabel": "Yearly",
      "monthlyCost": 10, "nextDate": null, "merchantName": "Example Music", "accountName": null,
      "source": "AUTO", "isActive": false }
  ],
  "monthlyTotal": 15.49
}
```

- [ ] **Step 2: Failing pure tests**

`ios/BudgetPhoneTests/SubscriptionModelTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

struct SubscriptionModelTests {
  func response() throws -> SubscriptionsResponse {
    try JSONDecoder().decode(SubscriptionsResponse.self, from: TestData.fixture("subscriptions"))
  }

  @Test func decodesTheList() throws {
    let r = try response()
    #expect(r.subscriptions.map(\.id) == ["s1", "s2"])
    #expect(r.monthlyTotal == 15.49)
    #expect(r.subscriptions[0].nextDate == "2026-10-05T00:00:00.000Z")
    #expect(r.subscriptions[1].accountName == nil)
    #expect(!r.subscriptions[0].isDetected)
    #expect(r.subscriptions[1].isDetected)
  }

  /// The web header: `${formatCurrency(monthlyTotal)}/mo across ${active} active`.
  @Test func summaryCountsActiveOnly() throws {
    #expect(try response().activeCount == 1)
    #expect(try response().summary == "$15.49/mo across 1 active")
  }

  /// Cadence · account · next date, as the web row's second line.
  @Test func detailLine() throws {
    let r = try response()
    #expect(r.subscriptions[0].detailLine == "Monthly · Sample Rewards Card · next Oct 5, 2026")
    #expect(r.subscriptions[1].detailLine == "Yearly")
  }

  /// The stored calendar date, whatever the phone's time zone.
  @Test func nextDateReadsInUTC() {
    #expect(SubscriptionDTO.nextDateText("2026-10-05T00:00:00.000Z") == "Oct 5, 2026")
    #expect(SubscriptionDTO.nextDateText("not a date") == nil)
  }

  @Test func detectNoticeMatchesTheWeb() throws {
    func notice(_ json: String) throws -> String {
      try JSONDecoder().decode(DetectResult.self, from: Data(json.utf8)).notice
    }
    #expect(try notice(#"{"found":1,"errors":[]}"#) == "Found 1 recurring charge.")
    #expect(try notice(#"{"found":3,"errors":[]}"#) == "Found 3 recurring charges.")
    #expect(try notice(#"{"found":0,"errors":[{"institution":"Example Bank","error":"login required"},{"institution":"Other Bank","error":"timeout"}]}"#)
      == "Found 0 recurring charges. (Example Bank: login required; Other Bank: timeout)")
  }

  @Test func cadencesMatchTheWeb() {
    #expect(Cadence.allCases.map(\.rawValue) == ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY", "QUARTERLY", "YEARLY"])
    #expect(Cadence.allCases.map(\.label) == ["Weekly", "Every 2 weeks", "Twice a month", "Monthly", "Quarterly", "Yearly"])
  }

  @Test func dayIsTheCalendarDate() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    let date = calendar.date(from: DateComponents(year: 2026, month: 3, day: 7, hour: 23))!
    #expect(NewSubscription.day(date, calendar: calendar) == "2026-03-07")
  }
}
```

`ios/BudgetPhoneTests/SubscriptionAPITests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// The subscriptions calls' methods, paths and bodies.
  @Suite(.serialized)
  struct SubscriptionAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ json: String) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session { _ in (200, Data(json.utf8)) })
    }

    func json(_ request: URLRequest) throws -> [String: Any] {
      let body = try #require(StubURLProtocol.body(of: request))
      return try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    @Test func listIsAGet() async throws {
      _ = try await client(#"{"subscriptions":[],"monthlyTotal":0}"#).subscriptions()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "GET")
      #expect(request.url?.path() == "/api/subscriptions")
    }

    @Test func addSendsExactlyTheFourFields() async throws {
      try await client(#"{"id":"new"}"#).addSubscription(
        NewSubscription(name: "Sample Stream", amount: 15.49, cadence: "MONTHLY", nextDate: "2026-10-05"))
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "POST")
      #expect(request.url?.path() == "/api/subscriptions")
      let body = try json(request)
      #expect(Set(body.keys) == ["name", "amount", "cadence", "nextDate"])
      #expect(body["name"] as? String == "Sample Stream")
      #expect(!(body["amount"] is String))
      #expect((body["amount"] as? NSNumber)?.doubleValue == 15.49)
      #expect(body["cadence"] as? String == "MONTHLY")
      #expect(body["nextDate"] as? String == "2026-10-05")
    }

    @Test func noNextDateIsSentAsNull() async throws {
      try await client(#"{"id":"new"}"#).addSubscription(
        NewSubscription(name: "Sample Stream", amount: 5, cadence: "YEARLY", nextDate: nil))
      let body = try json(#require(StubURLProtocol.requests.first))
      #expect(Set(body.keys) == ["name", "amount", "cadence", "nextDate"])
      #expect(body["nextDate"] is NSNull)
    }

    @Test func deleteHitsTheId() async throws {
      try await client(#"{"ok":true}"#).deleteSubscription(id: "s1")
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "DELETE")
      #expect(request.url?.path() == "/api/subscriptions/s1")
    }

    @Test func detectIsAPostWithAnEmptyBody() async throws {
      let result = try await client(#"{"found":2,"errors":[]}"#).detectSubscriptions()
      #expect(result.found == 2)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "POST")
      #expect(request.url?.path() == "/api/subscriptions/detect")
      #expect(try json(request).isEmpty)
    }
  }
}
```

- [ ] **Step 3: Run the tests. They should fail** (build error: the types are not defined).

- [ ] **Step 4: Models**

`ios/BudgetPhone/Models/SubscriptionModels.swift`:
```swift
import Foundation

// Mirrors of SubscriptionDTO / SubscriptionsResponse in ../src/types/index.ts,
// plus the detect result and the POST body of ../src/app/api/subscriptions.

struct SubscriptionDTO: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let amount: Double
  let cadence: String
  let cadenceLabel: String
  let monthlyCost: Double
  let nextDate: String?
  let merchantName: String?
  let accountName: String?
  let source: String  // MANUAL | AUTO
  let isActive: Bool

  /// The web's "detected" tag (source AUTO); anything else is "manual".
  var isDetected: Bool { source == "AUTO" }

  /// The row's second line (SubscriptionsDashboard Row): cadence, then the
  /// account and next date when present.
  var detailLine: String {
    var parts = [cadenceLabel]
    if let accountName, !accountName.isEmpty { parts.append(accountName) }
    if let next = nextDate.flatMap(Self.nextDateText) { parts.append("next \(next)") }
    return parts.joined(separator: " · ")
  }

  /// "Oct 5, 2026". Read in UTC so the stored calendar date shows as is; the
  /// web formats it in local time and shows the day before west of UTC.
  static func nextDateText(_ iso: String) -> String? {
    guard let date = Formatters.parseISO(iso) else { return nil }
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = .gmt
    return Formatters.date(date, calendar: utc)
  }
}

struct SubscriptionsResponse: Decodable, Equatable, Sendable {
  var subscriptions: [SubscriptionDTO]
  let monthlyTotal: Double

  var activeCount: Int { subscriptions.filter(\.isActive).count }

  /// The web page's header line.
  var summary: String { "\(Formatters.currency(monthlyTotal))/mo across \(activeCount) active" }
}

/// POST /api/subscriptions/detect.
struct DetectResult: Decodable, Equatable, Sendable {
  struct Failure: Decodable, Equatable, Sendable {
    let institution: String
    let error: String
  }

  let found: Int
  let errors: [Failure]

  /// SubscriptionsDashboard's detect message.
  var notice: String {
    var text = "Found \(found) recurring charge\(found == 1 ? "" : "s")."
    if !errors.isEmpty {
      text += " (" + errors.map { "\($0.institution): \($0.error)" }.joined(separator: "; ") + ")"
    }
    return text
  }
}

/// The body AddForm posts. `nextDate` is always sent, as null when unset.
struct NewSubscription: Encodable, Equatable, Sendable {
  let name: String
  let amount: Double
  let cadence: String
  let nextDate: String?

  private enum CodingKeys: String, CodingKey { case name, amount, cadence, nextDate }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(amount, forKey: .amount)
    try c.encode(cadence, forKey: .cadence)
    try c.encode(nextDate, forKey: .nextDate)  // Optional → null, not omitted
  }

  /// "2026-10-05", what the web's date input sends.
  static func day(_ date: Date, calendar: Calendar = .current) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04ld-%02ld-%02ld", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
  }
}

/// CADENCES / CADENCE_LABELS (../src/lib/subscriptions.ts).
enum Cadence: String, CaseIterable, Identifiable, Sendable {
  case weekly = "WEEKLY"
  case biweekly = "BIWEEKLY"
  case semiMonthly = "SEMI_MONTHLY"
  case monthly = "MONTHLY"
  case quarterly = "QUARTERLY"
  case yearly = "YEARLY"

  var id: String { rawValue }

  var label: String {
    switch self {
    case .weekly: "Weekly"
    case .biweekly: "Every 2 weeks"
    case .semiMonthly: "Twice a month"
    case .monthly: "Monthly"
    case .quarterly: "Quarterly"
    case .yearly: "Yearly"
    }
  }
}
```
If `c.encode(nextDate, forKey:)` resolves to an overload that omits nil, use `if let nextDate { try c.encode(nextDate, forKey: .nextDate) } else { try c.encodeNil(forKey: .nextDate) }`.

- [ ] **Step 5: Calls**

`ios/BudgetPhone/Networking/APIClient+Subscriptions.swift`:
```swift
import Foundation

extension APIClient {
  /// GET /api/subscriptions — the list (active first, then by name) and the
  /// monthly total of the active ones.
  func subscriptions() async throws(APIError) -> SubscriptionsResponse {
    try decode(await send("GET", "api/subscriptions", timeout: 15))
  }

  /// POST /api/subscriptions — add one manually. A 400 carries the reason.
  func addSubscription(_ subscription: NewSubscription) async throws(APIError) {
    _ = try await send("POST", "api/subscriptions", body: encode(subscription), timeout: 15)
  }

  /// DELETE /api/subscriptions/:id
  func deleteSubscription(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/subscriptions/\(id)", timeout: 15)
  }

  /// POST /api/subscriptions/detect — scans Plaid's recurring streams, so
  /// the long timeout. Banks that fail come back in `errors`.
  func detectSubscriptions() async throws(APIError) -> DetectResult {
    try decode(await send("POST", "api/subscriptions/detect", body: Data("{}".utf8), timeout: 60))
  }
}
```

- [ ] **Step 6: Run the tests. They should pass**, along with the full suite.
- [ ] **Step 7: Scrub and commit:** "Add the subscriptions models and calls to the iPhone app".

---

### Task 2: `SubscriptionsStore`

**Files:**
- Create: `ios/BudgetPhone/Subscriptions/SubscriptionsStore.swift`
- Test: `ios/BudgetPhoneTests/SubscriptionsStoreTests.swift`

**Interfaces (produces):** `@MainActor @Observable final class SubscriptionsStore` with:
- `init(client: @escaping @MainActor () -> APIClient?)`
- read-only `data: SubscriptionsResponse?`, `error: APIError?`, `isLoading`, `isDetecting`
- `var banner: String?` and `var notice: String?`
- `load()`, `detect()`, `add(_:) async throws(APIError)`, `delete(_:)`

- [ ] **Step 1: Failing tests**

`ios/BudgetPhoneTests/SubscriptionsStoreTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

/// Answers the stub handler reads at response time.
final class SubscriptionsStub: @unchecked Sendable {
  var failing: Set<String> = []  // "METHOD /path"
  var detect = #"{"found":2,"errors":[]}"#
  var name = "Sample Stream"
  var cancel = false
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct SubscriptionsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let stub = SubscriptionsStub()

    nonisolated static func answer(_ r: URLRequest, _ stub: SubscriptionsStub) throws -> (Int, Data) {
      if stub.cancel { throw URLError(.cancelled) }
      let key = "\(r.httpMethod ?? "") \(r.url!.path())"
      if stub.failing.contains(key) {
        let message = r.httpMethod == "POST" && r.url!.path() == "/api/subscriptions"
          ? "Amount must be a positive number" : "Failed to load subscriptions"
        return (r.httpMethod == "POST" && r.url!.path() == "/api/subscriptions" ? 400 : 500,
                Data(#"{"error":"\#(message)"}"#.utf8))
      }
      switch key {
      case "GET /api/subscriptions":
        return (200, Data(#"{"subscriptions":[{"id":"s1","name":"\#(stub.name)","amount":10,"cadence":"MONTHLY","cadenceLabel":"Monthly","monthlyCost":10,"nextDate":null,"merchantName":null,"accountName":null,"source":"MANUAL","isActive":true},{"id":"s2","name":"Example Music","amount":5,"cadence":"MONTHLY","cadenceLabel":"Monthly","monthlyCost":5,"nextDate":null,"merchantName":null,"accountName":null,"source":"AUTO","isActive":true}],"monthlyTotal":15}"#.utf8))
      case "POST /api/subscriptions/detect": return (200, Data(stub.detect.utf8))
      case "POST /api/subscriptions": return (200, Data(#"{"id":"s3"}"#.utf8))
      case "DELETE /api/subscriptions/s1": return (200, Data(#"{"ok":true}"#.utf8))
      default: return (404, Data())
      }
    }

    func store(gates: [Gate] = []) -> SubscriptionsStore {
      let stub = self.stub
      let c = APIClient(baseURL: base, session: StubURLProtocol.session({ try Self.answer($0, stub) }, gates: gates))
      return SubscriptionsStore { c }
    }

    func sent() -> [String] { StubURLProtocol.requests.map { "\($0.httpMethod ?? "") \($0.url!.path())" } }

    nonisolated static func isGET(_ r: URLRequest) -> Bool { r.httpMethod == "GET" }
    nonisolated static func isDetect(_ r: URLRequest) -> Bool { r.url?.path() == "/api/subscriptions/detect" }
    nonisolated static func isDelete(_ r: URLRequest) -> Bool { r.httpMethod == "DELETE" }

    // MARK: Load

    @Test func loads() async {
      let s = store()
      await s.load()
      #expect(s.data?.subscriptions.count == 2)
      #expect(s.error == nil && s.banner == nil)
    }

    @Test func withNothingLoadedAFailureIsFullScreen() async {
      stub.failing = ["GET /api/subscriptions"]
      let s = store()
      await s.load()
      #expect(s.error == .server(status: 500, message: "Failed to load subscriptions"))
      #expect(s.banner == nil)
    }

    @Test func noServerIsNotConfigured() async {
      let s = SubscriptionsStore { nil }
      await s.load()
      #expect(s.error == .notConfigured)
    }

    @Test func withDataAFailureIsABannerAndTheDataStays() async {
      let s = store()
      await s.load()
      stub.failing = ["GET /api/subscriptions"]
      await s.load()
      #expect(s.banner == "Failed to load subscriptions")
      #expect(s.data != nil)
      #expect(s.error == nil)
    }

    @Test func aSuccessfulLoadClearsTheBanner() async {
      let s = store()
      await s.load()
      s.banner = "Old"
      await s.load()
      #expect(s.banner == nil)
    }

    @Test func cancelledIsSilent() async {
      stub.cancel = true
      let s = store()
      await s.load()
      #expect(s.error == nil && s.banner == nil)
    }

    @Test func aStaleLoadIsDropped() async {
      let gate = Gate(Self.isGET)
      let s = store(gates: [gate])
      stub.name = "Old Name"
      let first = Task { await s.load() }
      await gate.arrival()
      stub.name = "New Name"
      await s.load()
      #expect(s.data?.subscriptions.first?.name == "New Name")
      stub.name = "Old Name"
      gate.open()
      await first.value
      #expect(s.data?.subscriptions.first?.name == "New Name")
    }

    // MARK: Detect

    @Test func detectPostsThenReloadsAndShowsTheNotice() async {
      let s = store()
      await s.detect()
      #expect(sent() == ["POST /api/subscriptions/detect", "GET /api/subscriptions"])
      #expect(s.notice == "Found 2 recurring charges.")
      #expect(!s.isDetecting)
    }

    @Test func detectClearsStaleMessagesBeforeItsCall() async {
      let gate = Gate(Self.isDetect)
      let s = store(gates: [gate])
      s.banner = "Old"
      s.notice = "Old notice"
      let task = Task { await s.detect() }
      await gate.arrival()
      #expect(s.banner == nil && s.notice == nil)
      #expect(s.isDetecting)
      gate.open()
      await task.value
    }

    @Test func aSecondDetectWhileOneRunsSendsNothing() async {
      let gate = Gate(Self.isDetect)
      let s = store(gates: [gate])
      let first = Task { await s.detect() }
      await gate.arrival()
      await s.detect()
      #expect(sent() == ["POST /api/subscriptions/detect"])
      gate.open()
      await first.value
    }

    @Test func aFailedDetectIsABannerThatSurvivesTheReload() async {
      stub.failing = ["POST /api/subscriptions/detect"]
      let s = store()
      await s.detect()
      #expect(s.banner == "Failed to load subscriptions")
      #expect(s.notice == nil)
      #expect(s.data != nil, "the list still reloads")
    }

    // MARK: Add

    @Test func addPostsThenReloads() async throws {
      let s = store()
      try await s.add(NewSubscription(name: "Sample Stream", amount: 10, cadence: "MONTHLY", nextDate: nil))
      #expect(sent() == ["POST /api/subscriptions", "GET /api/subscriptions"])
    }

    @Test func aRejectedAddThrowsTheServersMessageAndDoesNotReload() async {
      stub.failing = ["POST /api/subscriptions"]
      let s = store()
      await #expect(throws: APIError.server(status: 400, message: "Amount must be a positive number")) {
        try await s.add(NewSubscription(name: "Sample Stream", amount: 10, cadence: "MONTHLY", nextDate: nil))
      }
      #expect(sent() == ["POST /api/subscriptions"])
    }

    // MARK: Delete

    @Test func deleteRemovesTheRowAtOnce() async throws {
      let gate = Gate(Self.isDelete)
      let s = store(gates: [gate])
      await s.load()
      let row = try #require(s.data?.subscriptions.first)
      let task = Task { await s.delete(row) }
      await gate.arrival()
      #expect(s.data?.subscriptions.map(\.id) == ["s2"])
      gate.open()
      await task.value
      #expect(sent().contains("DELETE /api/subscriptions/s1"))
      #expect(sent().last == "GET /api/subscriptions")
    }

    @Test func aFailedDeleteBringsTheRowBackWithABanner() async throws {
      let s = store()
      await s.load()
      stub.failing = ["DELETE /api/subscriptions/s1"]
      let row = try #require(s.data?.subscriptions.first)
      await s.delete(row)
      #expect(s.data?.subscriptions.map(\.id) == ["s1", "s2"])
      #expect(s.banner == "Couldn't delete Sample Stream.")
    }
  }
}
```

- [ ] **Step 2: Run the tests. They should fail** (`SubscriptionsStore` is undefined).

- [ ] **Step 3: Store**

`ios/BudgetPhone/Subscriptions/SubscriptionsStore.swift`:
```swift
import Foundation
import Observation

/// What the Subscriptions card and list show
/// (../src/components/SubscriptionsDashboard.tsx). Shared by both, so a
/// detect from the card's menu shows up in the list and the other way round.
/// Same failure rules as AccountsStore: with nothing on screen an error is
/// full-screen; with data showing it becomes a banner and the data stays.
@MainActor
@Observable
final class SubscriptionsStore {
  private(set) var data: SubscriptionsResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  private(set) var isDetecting = false
  /// A non-blocking warning over data that is still valid.
  var banner: String?
  /// The last detect's result ("Found 3 recurring charges.").
  var notice: String?

  private let client: @MainActor () -> APIClient?
  /// Bumped by every load; a completion applies only if it is still the latest.
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
      let result = try await client.subscriptions()
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

  /// Detect from banks (Plaid), then a reload. One at a time. Stale
  /// messages clear before the call; this detect's own banner is applied
  /// after the reload, so the reload's success doesn't wipe it out.
  func detect() async {
    guard !isDetecting else { return }
    guard let client = client() else {
      error = .notConfigured
      return
    }
    isDetecting = true
    defer { isDetecting = false }
    banner = nil
    notice = nil
    var detectBanner: String?
    do throws(APIError) {
      notice = try await client.detectSubscriptions().notice
    } catch {
      if error != .cancelled { detectBanner = error.message }
    }
    await load()
    if let detectBanner { banner = detectBanner }
  }

  /// AddForm's submit. Throws so the sheet keeps its fields and shows why.
  func add(_ subscription: NewSubscription) async throws(APIError) {
    guard let client = client() else { throw .notConfigured }
    try await client.addSubscription(subscription)
    await load()
  }

  /// Removes the row at once, then deletes. A failure reloads (bringing the
  /// row back) and says so.
  func delete(_ subscription: SubscriptionDTO) async {
    guard let client = client() else { return }
    data?.subscriptions.removeAll { $0.id == subscription.id }
    do throws(APIError) {
      try await client.deleteSubscription(id: subscription.id)
      await load()
    } catch {
      await load()
      if error != .cancelled { banner = "Couldn't delete \(subscription.name)." }
    }
  }
}
```

- [ ] **Step 4: Run the tests. They should pass**, along with the full suite.
- [ ] **Step 5: Scrub and commit:** "Add the Subscriptions store to the iPhone app".

---

### Task 3: The list, row and add sheet

**Files:**
- Create: `ios/BudgetPhone/Subscriptions/SubscriptionRow.swift`, `SubscriptionsView.swift`, `AddSubscriptionSheet.swift`

**Interfaces:**
- Consumes: `SubscriptionsStore` (Task 2), the models (Task 1), and the existing `ErrorView`, `Banner`, `Notice`, `Formatters`, `ServerAddress`.
- Produces: `SubscriptionsView(store:)`, `SubscriptionRow(subscription:)`, `AddSubscriptionSheet(store:)`.

All the logic is already tested in Tasks 1–2. This task's check is a clean build and a green suite. The controller looks at it on the simulator.

- [ ] **Step 1: Row**

`ios/BudgetPhone/Subscriptions/SubscriptionRow.swift`:
```swift
import SwiftUI

/// One row of the list (SubscriptionsDashboard's Row). The amounts move
/// under the text at accessibility sizes.
struct SubscriptionRow: View {
  let subscription: SubscriptionDTO
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let stacked = dynamicTypeSize.isAccessibilitySize
    let layout =
      stacked
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
      : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
    layout {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(subscription.name).fontWeight(.medium).lineLimit(stacked ? nil : 1)
          tag(subscription.isDetected ? "detected" : "manual")
          if !subscription.isActive {
            Text("inactive").font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
          }
        }
        Text(subscription.detailLine).font(.caption).foregroundStyle(.secondary)
      }
      if !stacked { Spacer(minLength: 0) }
      VStack(alignment: stacked ? .leading : .trailing, spacing: 2) {
        Text(Formatters.currency(subscription.amount))
        Text("\(Formatters.currency(subscription.monthlyCost))/mo")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .monospacedDigit()
      .lineLimit(1)
    }
    .opacity(subscription.isActive ? 1 : 0.6)
  }

  private func tag(_ text: String) -> some View {
    Text(text)
      .font(.caption2)
      .textCase(.uppercase)
      .foregroundStyle(.secondary)
      .padding(.horizontal, 5)
      .padding(.vertical, 1)
      .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 4))
  }
}
```

- [ ] **Step 2: List**

`ios/BudgetPhone/Subscriptions/SubscriptionsView.swift`:
```swift
import SwiftUI

/// The Subscriptions list (../src/components/SubscriptionsDashboard.tsx),
/// pushed from the Analytics card. Pull down to detect from banks; + adds;
/// swipe to delete.
struct SubscriptionsView: View {
  let store: SubscriptionsStore
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Subscriptions")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Add Subscription", systemImage: "plus") { adding = true }
        }
      }
      .sheet(isPresented: $adding) { AddSubscriptionSheet(store: store) }
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

  private func list(_ data: SubscriptionsResponse) -> some View {
    List {
      if !data.subscriptions.isEmpty {
        Section {
          ForEach(data.subscriptions) { subscription in
            SubscriptionRow(subscription: subscription)
              .swipeActions {
                Button("Delete", systemImage: "trash", role: .destructive) {
                  Task { await store.delete(subscription) }
                }
              }
          }
        } header: {
          Text(data.summary).textCase(nil).monospacedDigit()
        } footer: {
          Text("Detection finds recurring charges from your transactions. It tries to skip rent, loans, and transfers, but isn't perfect. Delete anything that isn't a subscription.")
        }
      }
    }
    .listStyle(.insetGrouped)
    .overlay {
      if data.subscriptions.isEmpty {
        ContentUnavailableView(
          "No Subscriptions", systemImage: "repeat",
          description: Text("Pull down to detect from your banks, or tap + to add one."))
      }
    }
    .refreshable { await store.detect() }
    .safeAreaInset(edge: .top) {
      VStack(spacing: 8) {
        if let notice = store.notice { Notice(text: notice) { store.notice = nil } }
        if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
      }
    }
  }
}
```

- [ ] **Step 3: Add sheet**

`ios/BudgetPhone/Subscriptions/AddSubscriptionSheet.swift`:
```swift
import SwiftUI

/// SubscriptionsDashboard's AddForm as a sheet. Add waits for a name and a
/// positive amount; the server's own 400 message shows in the form.
struct AddSubscriptionSheet: View {
  let store: SubscriptionsStore
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var amount = ""
  @State private var cadence: Cadence = .monthly
  @State private var hasNextDate = false
  @State private var nextDate = Date.now
  @State private var saving = false
  @State private var errorMessage: String?

  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var amountValue: Double? {
    Double(amount).flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Name (e.g. Netflix)", text: $name)
          HStack {
            Text("$")
            TextField("Amount", text: $amount).keyboardType(.decimalPad)
          }
          Picker("Cadence", selection: $cadence) {
            ForEach(Cadence.allCases) { Text($0.label).tag($0) }
          }
        }
        Section {
          Toggle("Next Date", isOn: $hasNextDate)
          if hasNextDate {
            DatePicker("Date", selection: $nextDate, displayedComponents: .date)
          }
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Add Subscription")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save).disabled(trimmedName.isEmpty || amountValue == nil)
          }
        }
      }
    }
  }

  private func save() {
    guard let amountValue else { return }
    let subscription = NewSubscription(
      name: trimmedName, amount: amountValue, cadence: cadence.rawValue,
      nextDate: hasNextDate ? NewSubscription.day(nextDate) : nil)
    saving = true
    errorMessage = nil
    Task {
      do throws(APIError) {
        try await store.add(subscription)
        dismiss()
      } catch {
        saving = false
        if error != .cancelled { errorMessage = error.message }
      }
    }
  }
}
```

- [ ] **Step 4: Build and run the full suite.** It should pass with no new warnings.
- [ ] **Step 5: Scrub and commit:** "Add the Subscriptions list and add sheet to the iPhone app".

---

### Task 4: The Analytics card and wiring

**Files:**
- Create: `ios/BudgetPhone/Subscriptions/SubscriptionsCard.swift`
- Modify: `ios/BudgetPhone/Analytics/AnalyticsView.swift`

**Interfaces:**
- Consumes: `SubscriptionsStore` and `SubscriptionsView` (Tasks 2–3).
- Produces: `SubscriptionsCard(store:)` and `SubscriptionsRoute`.

- [ ] **Step 1: Card**

`ios/BudgetPhone/Subscriptions/SubscriptionsCard.swift`:
```swift
import SwiftUI

/// Pushes the Subscriptions list.
struct SubscriptionsRoute: Hashable {}

/// The Subscriptions entry on Analytics: the web page's header line, a
/// tap to open the list, and a long-press menu to detect from banks.
struct SubscriptionsCard: View {
  let store: SubscriptionsStore

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      NavigationLink(value: SubscriptionsRoute()) {
        HStack(alignment: .firstTextBaseline) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Subscriptions").font(.headline)
            summary
          }
          Spacer(minLength: 8)
          if store.isDetecting { ProgressView().controlSize(.small) }
          Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .contextMenu {
        Button("Detect from Banks", systemImage: "arrow.triangle.2.circlepath") {
          Task { await store.detect() }
        }
        .disabled(store.isDetecting)
      }

      if let notice = store.notice {
        message(notice, symbol: "checkmark.circle.fill", tint: .green) { store.notice = nil }
      }
      if let banner = store.banner {
        message(banner, symbol: "exclamationmark.triangle.fill", tint: .orange) { store.banner = nil }
      }
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
  }

  @ViewBuilder private var summary: some View {
    if let data = store.data {
      Text(data.summary).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
    } else if store.error == nil {
      ProgressView().controlSize(.small)
    } else {
      Text("Couldn't load subscriptions.").font(.subheadline).foregroundStyle(.secondary)
    }
  }

  private func message(
    _ text: String, symbol: String, tint: Color, dismiss: @escaping () -> Void
  ) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: symbol).foregroundStyle(tint)
      Text(text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly)
        .foregroundStyle(.secondary)
    }
  }
}
```
The card also shows the store's banner (a failed detect started from the card), because the Analytics screen has nowhere else to show it.

- [ ] **Step 2: Wire into `AnalyticsView`**

In `ios/BudgetPhone/Analytics/AnalyticsView.swift`:
1. Add the store next to `store`:
   ```swift
   @State private var subscriptions = SubscriptionsStore {
     ServerAddress.saved().map { APIClient(baseURL: $0) }
   }
   ```
2. On `content` inside the `NavigationStack`, after `.navigationTitle("Analytics")`, add:
   ```swift
   .navigationDestination(for: SubscriptionsRoute.self) { _ in
     SubscriptionsView(store: subscriptions)
   }
   ```
3. Add `.task { await subscriptions.load() }` after the existing `.task`. In the `scenePhase` and `server` `onChange` handlers, add `await subscriptions.load()` inside the same `Task` after the analytics load.
4. In `dashboard`, put `SubscriptionsCard(store: subscriptions)` immediately after `summary`.
5. Change `.refreshable { await store.refresh(isPro: proMode.isPro) }` to:
   ```swift
   .refreshable {
     await store.refresh(isPro: proMode.isPro)
     await subscriptions.load()  // a GET only; Detect runs from the list or the card's menu
   }
   ```

- [ ] **Step 3: Build and run the full suite.** It should pass with no new warnings.
- [ ] **Step 4: Scrub and commit:** "Add the Subscriptions card to the iPhone app's Analytics tab".

---

## After the tasks (controller only)

1. Simulator, **GET only**: open Analytics, check the card, then tap into the list. Check the empty state, and the light, dark and AX sizes.
   - **Never** pull to refresh on the list.
   - **Never** use the card's Detect.
   - **Never** add or delete.
2. Update `ios/README.md` (screens list) and the `ios/CLAUDE.md` layout table (add `Subscriptions/`).
3. Whole-branch review, then finish the branch. The owner does the write checks.
