# iPhone Analytics Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Analytics tab to the iPhone app with the web's summary cards, spending by category, monthly spending vs income, and, in Pro mode only, the cumulative Spending graph with an editable monthly limit that is shared with the web.

**Architecture:** Codable models and three new `APIClient` GETs (Task 1). Pure ports of the web's chart helpers go in `Support/` (Tasks 2–3). `AnalyticsStore` (`@MainActor @Observable`) loads and saves (Task 4). SwiftUI views use Swift Charts (Tasks 5–6). `RootView` adds the tab and passes the shared `ProMode`.

**Tech Stack:** Swift 6, SwiftUI, Swift Charts, iOS 26, Swift Testing, `StubURLProtocol`.

**Spec:** `docs/superpowers/specs/2026-09-30-ios-analytics-design.md`

## Global Constraints

- Work in `ios/` on branch `ios-analytics`. Read `ios/CLAUDE.md` first. It is binding.
- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. New files under `BudgetPhone/` or `BudgetPhoneTests/` join their targets automatically, and `.json` files under `BudgetPhoneTests/Fixtures/` become test resources.
- Test command, run from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Before every commit, run `bash ../scripts/test-scrub.sh`.
- Every suite that uses `StubURLProtocol` nests as `extension StubbedNetworkTests { @Suite(.serialized) … }`.
- Inside `Task { }`, use `do throws(APIError) { … }`. Never pass an `@MainActor @Sendable` closure into `Binding(set:)`.
- Each port names its web source in a comment. Wording is copied from the web verbatim. The one deliberate difference is the limit-save failure banner.
- **The live server holds real money data.** Implementers never run the app against it. Tests use `StubURLProtocol` only. Fixtures use invented values only (`Sample Mart`, round numbers).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Task | Responsibility |
|---|---|---|
| `BudgetPhone/Models/AnalyticsModels.swift` | 1 | Codable mirrors of the analytics JSON |
| `BudgetPhone/Networking/APIClient+Analytics.swift` | 1 | `analytics(months:)`, `cashflow()`, `spending()` |
| `BudgetPhone/Networking/APIClient+Settings.swift` | 1 | `putUIState` takes any `Encodable & Sendable` value |
| `BudgetPhone/Networking/APIClient+Transactions.swift` | 1 | `UIStateValue.number` |
| `BudgetPhoneTests/Fixtures/analytics.json`, `cashflow.json`, `spending.json` | 1 | Invented responses |
| `BudgetPhoneTests/AnalyticsModelTests.swift` | 1 | Decoding and `UIStateValue.number` |
| `BudgetPhoneTests/AnalyticsAPITests.swift` | 1 | Request paths, query and the PUT number body (stubbed) |
| `BudgetPhone/Support/Formatters.swift` | 2 | `compactCurrency`, `mathRound` |
| `BudgetPhone/Support/MonthWindow.swift` | 2 | `useMonthWindow` port |
| `BudgetPhone/Support/CategoryColors.swift` | 2 | `colors.ts` port |
| `BudgetPhone/Support/CategoryBreakdown.swift` | 2 | `CategoryChart` sum, `fold`, percentage, angle lookup |
| `BudgetPhoneTests/AnalyticsSupportTests.swift` | 2 | Tests for the four files above |
| `BudgetPhone/Support/SpendingMath.swift` | 3 | `SpendingGraph` math |
| `BudgetPhoneTests/SpendingMathTests.swift` | 3 | Tests for it |
| `BudgetPhone/Analytics/AnalyticsStore.swift` | 4 | Loads, range change, limit save |
| `BudgetPhoneTests/AnalyticsStoreTests.swift` | 4 | Store rules (stubbed) |
| `BudgetPhone/Analytics/AnalyticsView.swift` | 5 | Tab screen |
| `BudgetPhone/Analytics/ChartCard.swift`, `WindowNav.swift`, `SummaryGrid.swift`, `CategoryChartCard.swift`, `MonthlyTrendCard.swift` | 5 | Views |
| `BudgetPhone/App/RootView.swift` | 5 | Adds the tab |
| `BudgetPhoneTests/SummaryTileTests.swift` | 5 | Summary tile wording |
| `BudgetPhone/Analytics/SpendingGraphCard.swift`, `LimitSheet.swift` | 6 | Pro graph and limit editor |

---

### Task 1: Models, analytics calls, and a numeric ui-state value

**Files:**
- Create: `ios/BudgetPhone/Models/AnalyticsModels.swift`
- Create: `ios/BudgetPhone/Networking/APIClient+Analytics.swift`
- Modify: `ios/BudgetPhone/Networking/APIClient+Settings.swift` (whole file, 15 lines)
- Modify: `ios/BudgetPhone/Networking/APIClient+Transactions.swift`, the `UIStateValue` struct at the end of the file
- Create: `ios/BudgetPhoneTests/Fixtures/analytics.json`, `cashflow.json`, `spending.json`
- Test: `ios/BudgetPhoneTests/AnalyticsModelTests.swift`, `ios/BudgetPhoneTests/AnalyticsAPITests.swift`

**Interfaces:**
- Produces:
  - `struct AnalyticsSummary { totalSpent: Double; totalIncome: Double; net: Double; txCount: Int }`
  - `struct AnalyticsResult { summary: AnalyticsSummary; rangeMonths: Int }`
  - `struct CashflowMonth { key: String; label: String; income: [Income]; spend: [Spend]; totalIncome: Double; totalSpent: Double }`, with `Income { source; amount }` and `Spend { category; amount }`
  - `struct CashflowSeries { months: [CashflowMonth] }`
  - `struct DailySpend { date: String; amount: Double }` and `struct SpendingSeries { days: [DailySpend] }`
  - `APIClient.analytics(months: Int) async throws(APIError) -> AnalyticsResult`
  - `APIClient.cashflow() async throws(APIError) -> CashflowSeries`
  - `APIClient.spending() async throws(APIError) -> SpendingSeries`
  - `APIClient.putUIState(key: String, value: some Encodable & Sendable) async throws(APIError)`
  - `UIStateValue.number: Double?`
  - All models are `Decodable, Equatable, Sendable`.

- [ ] **Step 1: Add the fixtures (invented values only)**

`ios/BudgetPhoneTests/Fixtures/analytics.json`:
```json
{
  "summary": { "totalSpent": 1840.5, "totalIncome": 3200, "net": 1359.5, "txCount": 42 },
  "byCategory": [{ "category": "Groceries", "amount": 400, "count": 9 }],
  "byMonth": [{ "month": "2026-08", "label": "Aug", "spent": 900, "income": 1600 }],
  "topMerchants": [{ "name": "Sample Mart", "amount": 120, "count": 3 }],
  "rangeMonths": 6
}
```

`ios/BudgetPhoneTests/Fixtures/cashflow.json`:
```json
{
  "months": [
    {
      "key": "2026-07", "label": "Jul 2026",
      "income": [{ "source": "Paycheck", "amount": 3000 }, { "source": "Other income", "amount": 50 }],
      "spend": [
        { "category": "Groceries", "amount": 250, "subs": [{ "name": "Sample Mart", "amount": 100 }] },
        { "category": "Dining", "amount": 80 }
      ]
    },
    { "key": "2026-08", "label": "Aug 2026", "income": [], "spend": [{ "category": "Travel", "amount": 500 }] }
  ],
  "currentCash": 12000,
  "cashAsOf": null
}
```

`ios/BudgetPhoneTests/Fixtures/spending.json`:
```json
{ "days": [{ "date": "2026-07-01", "amount": 100 }, { "date": "2026-07-03", "amount": 50.25 }] }
```

- [ ] **Step 2: Write the failing pure tests**

`ios/BudgetPhoneTests/AnalyticsModelTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

struct AnalyticsModelTests {
  @Test func decodesTheSummaryAndIgnoresTheRest() throws {
    let result = try JSONDecoder().decode(AnalyticsResult.self, from: TestData.fixture("analytics"))
    #expect(result.summary == AnalyticsSummary(totalSpent: 1840.5, totalIncome: 3200, net: 1359.5, txCount: 42))
    #expect(result.rangeMonths == 6)
  }

  @Test func decodesCashflowMonthsAndTotalsThem() throws {
    let series = try JSONDecoder().decode(CashflowSeries.self, from: TestData.fixture("cashflow"))
    #expect(series.months.map(\.key) == ["2026-07", "2026-08"])
    #expect(series.months[0].label == "Jul 2026")
    #expect(series.months[0].totalIncome == 3050)
    #expect(series.months[0].totalSpent == 330)
    #expect(series.months[1].totalIncome == 0)
    #expect(series.months[1].spend == [CashflowMonth.Spend(category: "Travel", amount: 500)])
  }

  @Test func decodesDailySpend() throws {
    let series = try JSONDecoder().decode(SpendingSeries.self, from: TestData.fixture("spending"))
    #expect(series.days == [
      DailySpend(date: "2026-07-01", amount: 100), DailySpend(date: "2026-07-03", amount: 50.25),
    ])
  }

  private func stored(_ json: String) throws -> UIStateValue {
    try JSONDecoder().decode(UIStateValue.self, from: Data(json.utf8))
  }

  /// SpendingGraph accepts `v != null && v !== "" && !isNaN(Number(v))`.
  @Test func uiStateNumberFollowsTheWebsRule() throws {
    #expect(try stored(#"{"value":2500}"#).number == 2500)
    #expect(try stored(#"{"value":"1800"}"#).number == 1800)
    #expect(try stored(#"{"value":""}"#).number == nil)
    #expect(try stored(#"{"value":"lots"}"#).number == nil)
    #expect(try stored(#"{"value":"inf"}"#).number == nil)
    #expect(try stored(#"{"value":null}"#).number == nil)
    #expect(try stored(#"{"value":"pro"}"#).string == "pro", "the string reading is unchanged")
  }
}
```

`ios/BudgetPhoneTests/AnalyticsAPITests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// The analytics calls' paths and query, and a numeric ui-state PUT.
  @Suite(.serialized)
  struct AnalyticsAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ json: String) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session { _ in (200, Data(json.utf8)) })
    }

    @Test func analyticsSendsTheRange() async throws {
      let json = String(decoding: try TestData.fixture("analytics"), as: UTF8.self)
      _ = try await client(json).analytics(months: 12)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "GET")
      #expect(request.url?.path() == "/api/analytics")
      #expect(TestData.query(of: request, "months") == "12")
    }

    @Test func cashflowAndSpendingPaths() async throws {
      _ = try await client(#"{"months":[],"currentCash":0,"cashAsOf":null}"#).cashflow()
      #expect(StubURLProtocol.requests.first?.url?.path() == "/api/analytics/cashflow")
      _ = try await client(#"{"days":[]}"#).spending()
      #expect(StubURLProtocol.requests.first?.url?.path() == "/api/analytics/spending")
    }

    /// The web's pushSynced sends the limit as a JSON number, not a string.
    @Test func aNumericValueIsSentAsANumber() async throws {
      try await client(#"{"ok":true}"#).putUIState(key: "spendingMonthlyLimit", value: 2500.0)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "PUT")
      let body = try #require(StubURLProtocol.body(of: request))
      let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
      #expect(json.count == 2)
      #expect(json["key"] as? String == "spendingMonthlyLimit")
      #expect(!(json["value"] is String))
      #expect((json["value"] as? NSNumber)?.doubleValue == 2500)
    }
  }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run the test command. Expected: build failure. `AnalyticsResult`, `CashflowSeries`, `UIStateValue.number` and the others are not defined.

- [ ] **Step 4: Write the models**

`ios/BudgetPhone/Models/AnalyticsModels.swift`:
```swift
import Foundation

// Mirrors of the analytics types in ../src/types/index.ts. Only what the
// phone draws is decoded; byCategory, byMonth, topMerchants, the Sankey's
// cash fields and the sub-category breakdown are left out.

struct AnalyticsSummary: Decodable, Equatable, Sendable {
  let totalSpent: Double
  let totalIncome: Double
  let net: Double
  let txCount: Int
}

/// GET /api/analytics?months=N. The summary cards read only `summary`.
struct AnalyticsResult: Decodable, Equatable, Sendable {
  let summary: AnalyticsSummary
  let rangeMonths: Int
}

/// One month of GET /api/analytics/cashflow.
struct CashflowMonth: Decodable, Equatable, Sendable {
  struct Income: Decodable, Equatable, Sendable {
    let source: String
    let amount: Double
  }
  struct Spend: Decodable, Equatable, Sendable {
    let category: String
    let amount: Double
  }

  let key: String  // YYYY-MM
  let label: String  // "Jun 2026"
  let income: [Income]
  let spend: [Spend]

  /// MonthlyTrendChart's `income`.
  var totalIncome: Double { income.reduce(0) { $0 + $1.amount } }
  /// MonthlyTrendChart's `spent`.
  var totalSpent: Double { spend.reduce(0) { $0 + $1.amount } }
}

struct CashflowSeries: Decodable, Equatable, Sendable {
  let months: [CashflowMonth]  // oldest first
}

/// One day of GET /api/analytics/spending: net spend that day.
struct DailySpend: Decodable, Equatable, Sendable {
  let date: String  // YYYY-MM-DD
  let amount: Double
}

struct SpendingSeries: Decodable, Equatable, Sendable {
  let days: [DailySpend]  // oldest first, days with activity only
}
```

- [ ] **Step 5: Write the calls**

`ios/BudgetPhone/Networking/APIClient+Analytics.swift`:
```swift
import Foundation

extension APIClient {
  /// GET /api/analytics?months=N — the summary cards (AnalyticsDashboard).
  func analytics(months: Int) async throws(APIError) -> AnalyticsResult {
    try decode(
      await send(
        "GET", "api/analytics", query: [URLQueryItem(name: "months", value: String(months))],
        timeout: 15))
  }

  /// GET /api/analytics/cashflow — 24 months; the category and trend charts
  /// window over it on the phone, as useCashflow does on the web.
  func cashflow() async throws(APIError) -> CashflowSeries {
    try decode(await send("GET", "api/analytics/cashflow", timeout: 30))
  }

  /// GET /api/analytics/spending — daily spend for the cumulative graph.
  func spending() async throws(APIError) -> SpendingSeries {
    try decode(await send("GET", "api/analytics/spending", timeout: 30))
  }
}
```

- [ ] **Step 6: Make `putUIState` generic**

Replace `ios/BudgetPhone/Networking/APIClient+Settings.swift` with:
```swift
import Foundation

/// The body pushSynced sends (`../src/lib/ui-state.ts`). The value is any
/// JSON: Pro Mode sends a string, the spending limit a number.
private struct UIStatePut<Value: Encodable>: Encodable {
  let key: String
  let value: Value
}

extension APIClient {
  /// PUT /api/ui-state — `{ key, value }`; the value replaces the stored one.
  func putUIState(key: String, value: some Encodable & Sendable) async throws(APIError) {
    _ = try await send(
      "PUT", "api/ui-state", body: encode(UIStatePut(key: key, value: value)), timeout: 15)
  }
}
```
`ProMode.choose` calls `putUIState(key: Self.key, value: pro ? "pro" : "normal")`, which should still compile, because a string literal defaults to `String`. If the compiler can't infer the type, write `value: pro ? "pro" : "normal" as String` in `ios/BudgetPhone/Shared/ProMode.swift`.

- [ ] **Step 7: Add `UIStateValue.number`**

In `ios/BudgetPhone/Networking/APIClient+Transactions.swift`, replace the `UIStateValue` struct with:
```swift
/// `{ value: <any JSON> }` from the shared ui-state store, a plain JSON file
/// anything can write. The web's loadSynced treats only null (or a missing
/// key) as "nothing stored"; any other value counts as stored, even one that
/// isn't a string — which resolveProMode then reads as Normal.
struct UIStateValue: Decodable, Equatable, Sendable {
  /// False when the store has nothing (null) under the key.
  let isStored: Bool
  /// The value when it is a string.
  let string: String?
  /// The value as a number, by SpendingGraph's rule: a JSON number, or a
  /// non-empty string that reads as a finite number.
  let number: Double?

  private enum CodingKeys: String, CodingKey { case value }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    if try !c.contains(.value) || c.decodeNil(forKey: .value) {
      isStored = false
      string = nil
      number = nil
    } else {
      isStored = true
      string = try? c.decode(String.self, forKey: .value)
      if let n = try? c.decode(Double.self, forKey: .value) {
        number = n
      } else if let s = string, !s.isEmpty, let n = Double(s), n.isFinite {
        number = n
      } else {
        number = nil
      }
    }
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run the test command. Expected: all pass, including the existing `SettingsModeTests` (the Pro Mode PUT body is unchanged).

- [ ] **Step 9: Scrub and commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Models/AnalyticsModels.swift BudgetPhone/Networking BudgetPhone/Shared/ProMode.swift BudgetPhoneTests/Fixtures BudgetPhoneTests/AnalyticsModelTests.swift BudgetPhoneTests/AnalyticsAPITests.swift
git commit -m "Add the analytics models and calls to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Chart helper ports (formatters, month window, colours, category breakdown)

**Files:**
- Modify: `ios/BudgetPhone/Support/Formatters.swift` (add two functions)
- Create: `ios/BudgetPhone/Support/MonthWindow.swift`, `ios/BudgetPhone/Support/CategoryColors.swift`, `ios/BudgetPhone/Support/CategoryBreakdown.swift`
- Test: `ios/BudgetPhoneTests/AnalyticsSupportTests.swift`

**Interfaces:**
- Consumes: `CashflowMonth` (Task 1).
- Produces:
  - `Formatters.compactCurrency(_ amount: Double) -> String` ("$1.2K")
  - `Formatters.mathRound(_ x: Double) -> Double` (JavaScript's `Math.round`)
  - `struct MonthWindow`: `init(defaultSpan:)`, `mutating setTotal(_:)`, `pan(_:)`, `zoom(_:)`, `end`, `span`, `total`, `startIdx`, `range: Range<Int>`, `canEarlier`, `canLater`, `canZoomIn`, `canZoomOut`, `static clamp(end:span:total:) -> (end: Int, span: Int)`, `static label(_ labels: [String]) -> String`
  - `enum CategoryColors`: `income`, `draw`, `hub`, `other` (hex strings), `hex(for:) -> String`, `color(for:) -> Color`, `color(hex:) -> Color`
  - `struct CategorySlice: Identifiable { category: String; amount: Double }`
  - `enum CategoryBreakdown`: `slices(_ months: some Sequence<CashflowMonth>) -> [CategorySlice]`, `fold(_:) -> [CategorySlice]`, `percent(_ amount: Double, of sum: Double) -> Int`, `slice(at value: Double, in: [CategorySlice]) -> CategorySlice?`

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/AnalyticsSupportTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

struct AnalyticsSupportTests {
  // MARK: Formatters (../src/lib/format.ts formatCompactCurrency; Math.round)

  @Test func compactCurrencyMatchesIntl() {
    // Expected strings come from Node's Intl.NumberFormat with the web's options.
    #expect(Formatters.compactCurrency(0) == "$0")
    #expect(Formatters.compactCurrency(500) == "$500")
    #expect(Formatters.compactCurrency(1000) == "$1K")
    #expect(Formatters.compactCurrency(1250) == "$1.3K")
    #expect(Formatters.compactCurrency(2500) == "$2.5K")
    #expect(Formatters.compactCurrency(12345) == "$12.3K")
    #expect(Formatters.compactCurrency(1_000_000) == "$1M")
  }

  @Test func mathRoundRoundsHalvesUp() {
    #expect(Formatters.mathRound(2.5) == 3)
    #expect(Formatters.mathRound(-2.5) == -2)
    #expect(Formatters.mathRound(1.4) == 1)
    #expect(Formatters.mathRound(4.6) == 5)
  }

  // MARK: MonthWindow (useMonthWindow.ts)

  @Test func clampMatchesClampView() {
    #expect(MonthWindow.clamp(end: 0, span: 5, total: 10) == (5, 5))
    #expect(MonthWindow.clamp(end: 12, span: 0, total: 10) == (10, 1))
    #expect(MonthWindow.clamp(end: 3, span: 2, total: 0) == (0, 1))
  }

  @Test func beforeDataNothingIsShownOrEnabled() {
    let w = MonthWindow(defaultSpan: 6)
    #expect(w.range.isEmpty)
    #expect(!w.canEarlier && !w.canLater && !w.canZoomIn && !w.canZoomOut)
  }

  @Test func opensOnTheLatestDefaultSpan() {
    var w = MonthWindow(defaultSpan: 6)
    w.setTotal(24)
    #expect(w.range == 18..<24)
    #expect(w.canEarlier && !w.canLater && w.canZoomIn && w.canZoomOut)
  }

  @Test func aShortSeriesShowsAllOfIt() {
    var w = MonthWindow(defaultSpan: 6)
    w.setTotal(3)
    #expect(w.range == 0..<3)
    #expect(!w.canEarlier && !w.canZoomOut)
    w.pan(-1)
    #expect(w.range == 0..<3, "the window can't slide past the start")
    w.zoom(1)
    #expect(w.span == 3)
  }

  @Test func panAndZoomMoveTheWindow() {
    var w = MonthWindow(defaultSpan: 1)
    w.setTotal(24)
    w.pan(-1)
    #expect(w.range == 22..<23)
    #expect(w.canLater)
    w.zoom(1)
    #expect(w.range == 21..<23)
    w.zoom(-1)
    w.zoom(-1)
    #expect(w.span == 1, "zoom stops at one month")
  }

  @Test func laterTotalsDoNotResetTheWindow() {
    var w = MonthWindow(defaultSpan: 6)
    w.setTotal(24)
    w.pan(-2)
    w.setTotal(24)
    #expect(w.end == 22)
  }

  @Test func rangeLabels() {
    #expect(MonthWindow.label([]) == "—")
    #expect(MonthWindow.label(["Jun 2026"]) == "Jun 2026")
    #expect(MonthWindow.label(["Apr 2026", "May 2026", "Jun 2026"]) == "Apr 2026 – Jun 2026")
  }

  // MARK: CategoryColors (../src/lib/colors.ts)

  @Test func categoryColorsMatchTheWeb() {
    #expect(CategoryColors.hex(for: "Groceries") == "#06b6d4")
    #expect(CategoryColors.hex(for: "Other") == "#94a3b8")
    #expect(CategoryColors.hex(for: "Other income") == "#94a3b8")
    // Hashed names; expected values computed with the web's categoryColor.
    #expect(CategoryColors.hex(for: "Sample Category") == "#eab308")
    #expect(CategoryColors.hex(for: "Pets") == "#14b8a6")
    #expect(CategoryColors.hex(for: "Café") == "#a855f7", "hashes UTF-16 code units, as charCodeAt does")
  }

  // MARK: CategoryBreakdown (../src/components/charts/CategoryChart.tsx)

  private func month(_ key: String, _ spend: [(String, Double)]) -> CashflowMonth {
    CashflowMonth(
      key: key, label: key, income: [],
      spend: spend.map { CashflowMonth.Spend(category: $0.0, amount: $0.1) })
  }

  @Test func slicesSumAcrossMonthsLargestFirst() {
    let slices = CategoryBreakdown.slices([
      month("2026-07", [("Dining", 50), ("Groceries", 100)]),
      month("2026-08", [("Dining", 80)]),
    ])
    #expect(slices == [
      CategorySlice(category: "Dining", amount: 130), CategorySlice(category: "Groceries", amount: 100),
    ])
  }

  @Test func tiesKeepFirstSeenOrder() {
    let slices = CategoryBreakdown.slices([month("2026-07", [("B", 10), ("A", 10)])])
    #expect(slices.map(\.category) == ["B", "A"])
  }

  private func slices(_ n: Int, other: Int? = nil) -> [CategorySlice] {
    (0..<n).map { i in
      CategorySlice(category: i == other ? "Other" : "C\(i)", amount: Double(100 - i))
    }
  }

  @Test func eightOrFewerAreLeftAlone() {
    #expect(CategoryBreakdown.fold(slices(8)) == slices(8))
  }

  @Test func theTailFoldsIntoANewOther() {
    let folded = CategoryBreakdown.fold(slices(10))
    #expect(folded.count == 9)
    #expect(folded.last == CategorySlice(category: "Other", amount: 92 + 91))
  }

  @Test func theTailFoldsIntoAnExistingOther() {
    let folded = CategoryBreakdown.fold(slices(10, other: 3))
    #expect(folded.count == 8)
    #expect(folded[3] == CategorySlice(category: "Other", amount: 97 + 92 + 91))
  }

  @Test func percentRoundsLikeTheLegend() {
    #expect(CategoryBreakdown.percent(1, of: 8) == 13)  // 12.5 rounds up
    #expect(CategoryBreakdown.percent(5, of: 0) == 500)  // sum || 1
  }

  @Test func angleSelectionFindsTheSlice() {
    let s = [CategorySlice(category: "A", amount: 10), CategorySlice(category: "B", amount: 5)]
    #expect(CategoryBreakdown.slice(at: 4, in: s)?.category == "A")
    #expect(CategoryBreakdown.slice(at: 10.5, in: s)?.category == "B")
    #expect(CategoryBreakdown.slice(at: 99, in: s) == nil)
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the test command. Expected: build failure, because `MonthWindow`, `CategoryColors`, `CategoryBreakdown` and `Formatters.compactCurrency` are not defined.

- [ ] **Step 3: Add the formatters**

Append inside `enum Formatters` in `ios/BudgetPhone/Support/Formatters.swift`:
```swift
  /// "$1.2K" — formatCompactCurrency: compact notation, at most one
  /// decimal, halves rounded away from zero as Intl does.
  static func compactCurrency(_ amount: Double) -> String {
    amount.formatted(
      .currency(code: "USD")
        .notation(.compactName)
        .precision(.fractionLength(0...1))
        .rounded(rule: .toNearestOrAwayFromZero)
        .locale(enUS))
  }

  /// JavaScript's Math.round: halves go toward +∞ (-2.5 → -2), unlike
  /// Swift's `.rounded()`.
  static func mathRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
```
If `compactCurrency` produces something other than the expected strings (for example "$1.2 thousand" or a non-breaking space), change the implementation until it does. Don't change the test; the expected values come from the web.

- [ ] **Step 4: Write `MonthWindow`**

`ios/BudgetPhone/Support/MonthWindow.swift`:
```swift
import Foundation

/// useMonthWindow (../src/components/charts/useMonthWindow.ts) as a value
/// type: a span of months ending at `end` (exclusive), with pan (move the
/// window) and zoom (resize the span). Each chart keeps its own. Opens on
/// the most recent `defaultSpan` months once there is data.
struct MonthWindow: Equatable, Sendable {
  private(set) var end = 0
  private(set) var span = 1
  private(set) var total = 0
  let defaultSpan: Int
  private var opened = false

  init(defaultSpan: Int) { self.defaultSpan = defaultSpan }

  /// clampView.
  static func clamp(end: Int, span: Int, total: Int) -> (end: Int, span: Int) {
    let s = min(max(1, span), max(1, total))
    let e = min(max(s, end), total)
    return (e, s)
  }

  /// The hook's effect: track the month count, and open on the latest
  /// months the first time there are any.
  mutating func setTotal(_ total: Int) {
    self.total = total
    if total > 0 && !opened {
      opened = true
      (end, span) = Self.clamp(end: total, span: min(defaultSpan, total), total: total)
    }
  }

  mutating func pan(_ dir: Int) { (end, span) = Self.clamp(end: end + dir, span: span, total: total) }
  mutating func zoom(_ dir: Int) { (end, span) = Self.clamp(end: end, span: span + dir, total: total) }

  var startIdx: Int { max(0, end - span) }
  /// The months shown, as indexes into the series.
  var range: Range<Int> { min(startIdx, total)..<min(end, total) }
  var canEarlier: Bool { end - span > 0 }
  var canLater: Bool { end < total }
  var canZoomIn: Bool { span > 1 }
  var canZoomOut: Bool { span < total }

  /// The charts' range line: "—", "Jun 2026", or "Apr 2026 – Jun 2026".
  static func label(_ labels: [String]) -> String {
    switch labels.count {
    case 0: "—"
    case 1: labels[0]
    default: "\(labels[0]) – \(labels[labels.count - 1])"
    }
  }
}
```
Tuples are not `Equatable`, so `#expect(MonthWindow.clamp(...) == (5, 5))` uses the tuple `==` overload. If that doesn't compile inside `#expect`, compare `.end` and `.span` separately in the test.

- [ ] **Step 5: Write `CategoryColors`**

`ios/BudgetPhone/Support/CategoryColors.swift`:
```swift
import SwiftUI

/// The web's chart colours (../src/lib/colors.ts), so a category is the
/// same colour on the phone as in the browser.
enum CategoryColors {
  static let income = "#22c55e"  // green — money in
  static let draw = "#ef4444"  // red — over / drawn from savings
  static let hub = "#475569"  // slate — spent
  static let other = "#94a3b8"

  private static let palette = [
    "#6366f1", "#a855f7", "#ec4899", "#f97316", "#14b8a6",
    "#8b5cf6", "#eab308", "#06b6d4", "#db2777", "#0d9488",
    "#7c3aed", "#ca8a04", "#c084fc", "#64748b",
  ]

  private static let fixed: [String: String] = [
    "Food and Drink": "#6366f1",
    "General Merchandise": "#a855f7",
    "Travel": "#ec4899",
    "Transportation": "#f97316",
    "General Services": "#14b8a6",
    "Entertainment": "#8b5cf6",
    "Government and Non Profit": "#eab308",
    "Groceries": "#06b6d4",
    "Personal Care": "#db2777",
    "Medical": "#0d9488",
    "Rent and Utilities": "#7c3aed",
    "Loan Payments": "#ca8a04",
    "Dining": "#c084fc",
    "Home Improvement": "#0d9488",
  ]

  /// categoryColor: fixed map, else a hash of the UTF-16 code units
  /// (charCodeAt) into the palette.
  static func hex(for name: String) -> String {
    if name == "Other" || name == "Other income" { return other }
    if let hex = fixed[name] { return hex }
    var h: UInt32 = 0
    for unit in name.utf16 { h = h &* 31 &+ UInt32(unit) }
    return palette[Int(h % UInt32(palette.count))]
  }

  static func color(for name: String) -> Color { color(hex: hex(for: name)) }

  static func color(hex: String) -> Color {
    let v = UInt32(hex.dropFirst(), radix: 16) ?? 0
    return Color(
      red: Double((v >> 16) & 0xff) / 255,
      green: Double((v >> 8) & 0xff) / 255,
      blue: Double(v & 0xff) / 255)
  }
}
```

- [ ] **Step 6: Write `CategoryBreakdown`**

`ios/BudgetPhone/Support/CategoryBreakdown.swift`:
```swift
import Foundation

/// One donut slice of Spending by category.
struct CategorySlice: Equatable, Identifiable, Sendable {
  let category: String
  let amount: Double
  var id: String { category }
}

/// CategoryChart's data (../src/components/charts/CategoryChart.tsx).
enum CategoryBreakdown {
  /// Spend summed per category over the windowed months, largest first
  /// (ties keep first-seen order, as the web's stable sort does), then folded.
  static func slices(_ months: some Sequence<CashflowMonth>) -> [CategorySlice] {
    var order: [String] = []
    var totals: [String: Double] = [:]
    for month in months {
      for spend in month.spend {
        if totals[spend.category] == nil { order.append(spend.category) }
        totals[spend.category, default: 0] += spend.amount
      }
    }
    let sorted = order.enumerated()
      .map { (index: $0.offset, slice: CategorySlice(category: $0.element, amount: totals[$0.element] ?? 0)) }
      .sorted { a, b in
        a.slice.amount != b.slice.amount ? a.slice.amount > b.slice.amount : a.index < b.index
      }
      .map(\.slice)
    return fold(sorted)
  }

  /// fold: the top 8, with the long tail as one "Other" slice — added to
  /// an existing "Other" in the top 8 if there is one.
  static func fold(_ slices: [CategorySlice]) -> [CategorySlice] {
    let top = Array(slices.prefix(8))
    let rest = slices.dropFirst(8)
    guard !rest.isEmpty else { return top }
    let tail = rest.reduce(0) { $0 + $1.amount }
    if top.contains(where: { $0.category == "Other" }) {
      return top.map {
        $0.category == "Other" ? CategorySlice(category: "Other", amount: $0.amount + tail) : $0
      }
    }
    return top + [CategorySlice(category: "Other", amount: tail)]
  }

  /// The legend's share: Math.round((amount / (sum || 1)) * 100).
  static func percent(_ amount: Double, of sum: Double) -> Int {
    Int(Formatters.mathRound(amount / (sum == 0 ? 1 : sum) * 100))
  }

  /// The slice a `chartAngleSelection` value falls in (values accumulate
  /// slice by slice in chart order).
  static func slice(at value: Double, in slices: [CategorySlice]) -> CategorySlice? {
    var running = 0.0
    for slice in slices {
      running += slice.amount
      if value <= running { return slice }
    }
    return nil
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run the test command. Expected: all pass.

- [ ] **Step 8: Scrub and commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Support BudgetPhoneTests/AnalyticsSupportTests.swift
git commit -m "Port the analytics chart helpers to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `SpendingMath`

**Files:**
- Create: `ios/BudgetPhone/Support/SpendingMath.swift`
- Test: `ios/BudgetPhoneTests/SpendingMathTests.swift`

**Interfaces:**
- Consumes: `DailySpend` (Task 1); `Formatters.mathRound`, `Formatters.currency` (Task 2 / existing).
- Produces:
  - `SpendingMath.Today(year:month:day:)`, `Today(_ date: Date, calendar: Calendar = .current)`
  - `SpendingMath.Month { year; month; key; label }`
  - `SpendingMath.Compare` (`.lastMonth`, `.lastYear`; `.label`)
  - `SpendingMath.Row { day: Int; current: Double?; average: Double?; compare: Double? }`
  - `SpendingMath.Chart { rows; top; peak; days; ticks; splitFill; splitLine; spent }`
  - `SpendingMath.Prepared { months; byMonth; defaultLimit; currentKey }`
  - `SpendingMath.prepare(_ days: [DailySpend], today: Today) -> Prepared`
  - `SpendingMath.chart(_ p: Prepared, month: Month, compare: Compare, limit: Double, today: Today) -> Chart`
  - `SpendingMath.niceCeil(_:)`, `daysInMonth(_:_:)`, `status(spent:limit:) -> (text: String, over: Bool)`

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/SpendingMathTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

/// SpendingGraph's math (../src/components/charts/SpendingGraph.tsx).
struct SpendingMathTests {
  /// July 160 in total, August 240, September (the current month) 50 so far.
  let days = [
    DailySpend(date: "2026-07-01", amount: 100), DailySpend(date: "2026-07-03", amount: 50),
    DailySpend(date: "2026-07-31", amount: 10), DailySpend(date: "2026-08-02", amount: 200),
    DailySpend(date: "2026-08-15", amount: 40), DailySpend(date: "2026-09-01", amount: 30),
    DailySpend(date: "2026-09-10", amount: 20),
  ]
  let today = SpendingMath.Today(year: 2026, month: 9, day: 12)

  func month(_ p: SpendingMath.Prepared, _ key: String) throws -> SpendingMath.Month {
    try #require(p.months.first { $0.key == key })
  }

  @Test func monthsRunFromFirstToLastWithGapsFilled() {
    let p = SpendingMath.prepare(
      [DailySpend(date: "2026-07-01", amount: 1), DailySpend(date: "2026-09-01", amount: 1)],
      today: today)
    #expect(p.months.map(\.key) == ["2026-07", "2026-08", "2026-09"])
    #expect(p.months.map(\.label) == ["July 2026", "August 2026", "September 2026"])
    #expect(p.currentKey == "2026-09")
  }

  @Test func monthsCrossAYear() {
    let p = SpendingMath.prepare(
      [DailySpend(date: "2025-11-01", amount: 1), DailySpend(date: "2026-01-01", amount: 1)],
      today: today)
    #expect(p.months.map(\.key) == ["2025-11", "2025-12", "2026-01"])
  }

  @Test func defaultLimitIsThePastAverageToTheNearest250() {
    // (160 + 240) / 2 = 200 → 250, floored at 500.
    #expect(SpendingMath.prepare(days, today: today).defaultLimit == 500)
    let big = [
      DailySpend(date: "2026-07-01", amount: 1000), DailySpend(date: "2026-08-01", amount: 1250),
    ]
    // 1125 / 250 = 4.5 → Math.round → 5 → 1250.
    #expect(SpendingMath.prepare(big, today: today).defaultLimit == 1250)
    #expect(SpendingMath.prepare([], today: today).defaultLimit == 3000)
    let onlyThisMonth = [DailySpend(date: "2026-09-01", amount: 9000)]
    #expect(SpendingMath.prepare(onlyThisMonth, today: today).defaultLimit == 3000)
  }

  @Test func theCurrentMonthStopsAtToday() throws {
    let p = SpendingMath.prepare(days, today: today)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-09"), compare: .lastMonth, limit: 500, today: today)
    #expect(chart.days == 30)
    #expect(chart.rows.count == 30)
    #expect(chart.rows[0].current == 30)
    #expect(chart.rows[9].current == 50)
    #expect(chart.rows[11].current == 50)
    #expect(chart.rows[12].current == nil)
    #expect(chart.peak == 50)
    #expect(chart.spent == 50)
  }

  @Test func aPastMonthRunsToItsLastDay() throws {
    let p = SpendingMath.prepare(days, today: today)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-08"), compare: .lastMonth, limit: 500, today: today)
    #expect(chart.rows.count == 31)
    #expect(chart.rows[30].current == 240)
    #expect(chart.peak == 240)
  }

  @Test func averageUsesCompleteMonthsOnly() throws {
    let p = SpendingMath.prepare(days, today: today)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-09"), compare: .lastMonth, limit: 500, today: today)
    #expect(chart.rows[0].average == 50)  // (100 + 0) / 2
    #expect(chart.rows[1].average == 150)  // (100 + 200) / 2
    #expect(chart.rows[2].average == 175)  // (150 + 200) / 2
  }

  @Test func compareIsLastMonthOrLastYear() throws {
    let p = SpendingMath.prepare(days, today: today)
    let sep = try month(p, "2026-09")
    let lastMonth = SpendingMath.chart(p, month: sep, compare: .lastMonth, limit: 500, today: today)
    #expect(lastMonth.rows[1].compare == 200)
    #expect(lastMonth.rows[29].compare == 240)
    let lastYear = SpendingMath.chart(p, month: sep, compare: .lastYear, limit: 500, today: today)
    #expect(lastYear.rows.allSatisfy { $0.compare == 0 }, "a month with no data is a flat zero line")
  }

  @Test func lastMonthOfJanuaryIsDecember() throws {
    let janToday = SpendingMath.Today(year: 2026, month: 1, day: 20)
    let p = SpendingMath.prepare(
      [DailySpend(date: "2025-12-05", amount: 70), DailySpend(date: "2026-01-02", amount: 10)],
      today: janToday)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-01"), compare: .lastMonth, limit: 500, today: janToday)
    #expect(chart.rows[4].compare == 70)
  }

  @Test func cumulativeIsRoundedToCents() throws {
    let p = SpendingMath.prepare(
      [DailySpend(date: "2026-08-01", amount: 0.1), DailySpend(date: "2026-08-02", amount: 0.2)],
      today: today)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-08"), compare: .lastMonth, limit: 500, today: today)
    #expect(chart.rows[1].current == 0.3)
  }

  @Test func topAndSplits() throws {
    let p = SpendingMath.prepare(days, today: today)
    let sep = try month(p, "2026-09")
    let under = SpendingMath.chart(p, month: sep, compare: .lastMonth, limit: 500, today: today)
    #expect(under.top == 600)  // max 500 × 1.06 = 530 → step 100
    #expect(under.splitFill == 0)
    #expect(under.splitLine == 0)
    let over = SpendingMath.chart(p, month: sep, compare: .lastMonth, limit: 40, today: today)
    #expect(abs(over.splitFill - 0.2) < 1e-9)  // 1 − 40 / 50
    #expect(over.splitLine == 0.5)  // (50 − 40) / (50 − 30)
  }

  @Test func niceCeilSteps() {
    #expect(SpendingMath.niceCeil(0) == 500)
    #expect(SpendingMath.niceCeil(-5) == 500)
    #expect(SpendingMath.niceCeil(150) == 150)
    #expect(SpendingMath.niceCeil(201) == 300)
    #expect(SpendingMath.niceCeil(1001) == 1500)
    #expect(SpendingMath.niceCeil(4001) == 5000)
  }

  @Test func ticksEndOnTheLastDay() throws {
    for (date, last) in [("2026-02-01", 28), ("2026-04-01", 30), ("2026-05-01", 31)] {
      let p = SpendingMath.prepare([DailySpend(date: date, amount: 1)], today: today)
      let chart = SpendingMath.chart(
        p, month: try #require(p.months.first), compare: .lastMonth, limit: 500, today: today)
      #expect(chart.ticks == [1, 5, 10, 15, 20, 25, last])
    }
  }

  @Test func statusLine() {
    let under = SpendingMath.status(spent: 450, limit: 500)
    #expect(under.text == "$50.00 left of the $500.00 limit")
    #expect(!under.over)
    let over = SpendingMath.status(spent: 620, limit: 500)
    #expect(over.text == "$120.00 over the $500.00 limit")
    #expect(over.over)
  }

  @Test func todayFromADate() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let date = calendar.date(from: DateComponents(year: 2026, month: 9, day: 30))!
    #expect(SpendingMath.Today(date, calendar: calendar) == SpendingMath.Today(year: 2026, month: 9, day: 30))
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the test command. Expected: build failure, because `SpendingMath` is not defined.

- [ ] **Step 3: Write `SpendingMath`**

`ios/BudgetPhone/Support/SpendingMath.swift`:
```swift
import Foundation

/// The math behind the web's cumulative Spending graph
/// (../src/components/charts/SpendingGraph.tsx, its two useMemos and the
/// status line), with "today" passed in so tests can pin it.
enum SpendingMath {
  struct Today: Equatable, Sendable {
    let year: Int
    let month: Int
    let day: Int

    init(year: Int, month: Int, day: Int) {
      self.year = year
      self.month = month
      self.day = day
    }

    init(_ date: Date, calendar: Calendar = .current) {
      let c = calendar.dateComponents([.year, .month, .day], from: date)
      self.init(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1)
    }
  }

  struct Month: Equatable, Sendable {
    let year: Int
    let month: Int
    let key: String  // YYYY-MM
    let label: String  // "June 2026"
  }

  enum Compare: CaseIterable, Sendable {
    case lastMonth, lastYear
    var label: String { self == .lastMonth ? "Last month" : "Last year" }
  }

  struct Row: Equatable, Sendable {
    let day: Int
    let current: Double?
    let average: Double?
    let compare: Double?
  }

  struct Chart: Equatable, Sendable {
    let rows: [Row]
    /// The y axis top.
    let top: Double
    /// Cumulative spend on the last day shown.
    let peak: Double
    /// Days in the month.
    let days: Int
    let ticks: [Int]
    /// Where the area fill turns from red (above) to green, top = 0.
    let splitFill: Double
    /// The same for the line, over its own height.
    let splitLine: Double
    var spent: Double { peak }
  }

  struct Prepared: Equatable, Sendable {
    let months: [Month]
    /// Month key → day of month → spend.
    let byMonth: [String: [Int: Double]]
    let defaultLimit: Double
    let currentKey: String
  }

  private static let monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]

  static func key(_ year: Int, _ month: Int) -> String {
    String(format: "%04d-%02d", year, month)
  }

  static func daysInMonth(_ year: Int, _ month: Int) -> Int {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    guard let first = calendar.date(from: DateComponents(year: year, month: month, day: 1)),
      let days = calendar.range(of: .day, in: .month, for: first)
    else { return 30 }
    return days.count
  }

  private static func cents(_ x: Double) -> Double { Formatters.mathRound(x * 100) / 100 }

  static func niceCeil(_ n: Double) -> Double {
    if n <= 0 { return 500 }
    let step: Double = n > 4000 ? 1000 : n > 1000 ? 500 : n > 200 ? 100 : 50
    return (n / step).rounded(.up) * step
  }

  /// Calendar months, the per-day lookup and the default limit.
  static func prepare(_ days: [DailySpend], today: Today) -> Prepared {
    var byMonth: [String: [Int: Double]] = [:]
    for d in days {
      guard let day = Int(d.date.dropFirst(8).prefix(2)) else { continue }
      byMonth[String(d.date.prefix(7)), default: [:]][day, default: 0] += d.amount
    }
    let keys = byMonth.keys.sorted()
    var months: [Month] = []
    func parts(_ key: String) -> (Int, Int)? {
      let p = key.split(separator: "-").compactMap { Int($0) }
      return p.count == 2 ? (p[0], p[1]) : nil
    }
    if let first = keys.first.flatMap(parts), let last = keys.last.flatMap(parts) {
      var (y, m) = first
      while y < last.0 || (y == last.0 && m <= last.1) {
        months.append(Month(year: y, month: m, key: key(y, m), label: "\(monthNames[m - 1]) \(y)"))
        m += 1
        if m > 12 {
          m = 1
          y += 1
        }
      }
    }
    let currentKey = key(today.year, today.month)
    let totals = months.filter { $0.key < currentKey }
      .map { (byMonth[$0.key] ?? [:]).values.reduce(0, +) }
      .filter { $0 > 0 }
    let average = totals.isEmpty ? 3000 : totals.reduce(0, +) / Double(totals.count)
    return Prepared(
      months: months, byMonth: byMonth,
      defaultLimit: max(500, Formatters.mathRound(average / 250) * 250), currentKey: currentKey)
  }

  /// The selected month's rows, axis and limit split.
  static func chart(
    _ p: Prepared, month: Month, compare: Compare, limit: Double, today: Today
  ) -> Chart {
    func cumulative(_ year: Int, _ month: Int) -> [Double] {
      let spend = p.byMonth[key(year, month)]
      var running = 0.0
      return (1...daysInMonth(year, month)).map { d in
        running += spend?[d] ?? 0
        return cents(running)
      }
    }

    let days = daysInMonth(month.year, month.month)
    let elapsed = month.key == p.currentKey ? today.day : days
    let current = cumulative(month.year, month.month)

    // Long-run average over complete (past) months.
    let complete = p.months.filter { $0.key < p.currentKey }.map { cumulative($0.year, $0.month) }
    let average: [Double?] = (0..<31).map { i in
      let have = complete.filter { i < $0.count }
      return have.isEmpty ? nil : cents(have.reduce(0) { $0 + $1[i] } / Double(have.count))
    }

    var cy = month.year
    var cm = month.month
    switch compare {
    case .lastMonth:
      cm -= 1
      if cm < 1 {
        cm = 12
        cy -= 1
      }
    case .lastYear:
      cy -= 1
    }
    let comparison = cumulative(cy, cm)

    let rows = (1...days).map { d in
      Row(
        day: d,
        current: d <= elapsed ? current[d - 1] : nil,
        average: average[d - 1],
        compare: d - 1 < comparison.count ? comparison[d - 1] : nil)
    }
    let peak = (1...current.count).contains(elapsed) ? current[elapsed - 1] : 0
    let first = current.first ?? 0
    let maxValue = ([limit, peak, 0] + average.compactMap { $0 } + comparison).max() ?? 0
    let clamp01 = { (x: Double) in min(1, max(0, x)) }
    var ticks: [Int] = []
    for t in [1, 5, 10, 15, 20, 25, days] where t <= days && !ticks.contains(t) { ticks.append(t) }

    return Chart(
      rows: rows,
      top: niceCeil(maxValue * 1.06),
      peak: peak,
      days: days,
      ticks: ticks,
      splitFill: peak > 0 ? clamp01(1 - limit / peak) : 0,
      splitLine: peak > first ? clamp01((peak - limit) / (peak - first)) : (peak > limit ? 1 : 0))
  }

  /// The line under the graph.
  static func status(spent: Double, limit: Double) -> (text: String, over: Bool) {
    if spent > limit {
      return (
        "\(Formatters.currency(spent - limit)) over the \(Formatters.currency(limit)) limit", true
      )
    }
    return (
      "\(Formatters.currency(limit - spent)) left of the \(Formatters.currency(limit)) limit", false
    )
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the test command. Expected: all pass. If a floating-point comparison is off in the last digit (for example `splitFill` came out as `0.19999999999999996`), use `abs(a - b) < 1e-9` in that one expectation. Don't change the math.

- [ ] **Step 5: Scrub and commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Support/SpendingMath.swift BudgetPhoneTests/SpendingMathTests.swift
git commit -m "Port the Spending graph's math to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `AnalyticsStore`

**Files:**
- Create: `ios/BudgetPhone/Analytics/AnalyticsStore.swift`
- Test: `ios/BudgetPhoneTests/AnalyticsStoreTests.swift`

**Interfaces:**
- Consumes: `APIClient.analytics(months:)`, `cashflow()`, `spending()`, `uiState(_:)`, `putUIState(key:value:)`, `UIStateValue.number` (Task 1).
- Produces (`@MainActor @Observable final class AnalyticsStore`):
  - `init(client: @escaping @MainActor () -> APIClient?)`
  - `static let limitKey = "spendingMonthlyLimit"`, `static let ranges = [3, 6, 12]`
  - read-only: `range: Int`, `summary: AnalyticsSummary?`, `isLoadingSummary: Bool`, `cashflow: [CashflowMonth]?`, `spending: [DailySpend]?`, `limitOverride: Double?`, `error: APIError?`, `hasData: Bool`
  - `var banner: String?`
  - `func load(isPro: Bool) async`, `func refresh(isPro: Bool) async`, `func changeRange(_ months: Int) async`, `func saveLimit(_ value: Double, current: Double) async`

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/AnalyticsStoreTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

/// Mutable answers a stub handler reads at response time.
final class AnalyticsStub: @unchecked Sendable {
  var failing: Set<String> = []
  var txCount = 4
  var limit = "null"
  var cancel = false
}

extension StubbedNetworkTests {
  /// The Analytics store's loads, failures and limit saves.
  @Suite(.serialized)
  @MainActor
  struct AnalyticsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let stub = AnalyticsStub()

    nonisolated static let cashflowJSON =
      #"{"months":[{"key":"2026-08","label":"Aug 2026","income":[{"source":"Paycheck","amount":300}],"spend":[{"category":"Groceries","amount":100}]}],"currentCash":0,"cashAsOf":null}"#
    nonisolated static let spendingJSON = #"{"days":[{"date":"2026-08-03","amount":100}]}"#

    nonisolated static func answer(_ r: URLRequest, _ stub: AnalyticsStub) throws -> (Int, Data) {
      if stub.cancel { throw URLError(.cancelled) }
      let path = r.url!.path()
      if stub.failing.contains(path) {
        return (500, Data(#"{"error":"Failed to compute analytics"}"#.utf8))
      }
      switch path {
      case "/api/analytics":
        return (200, Data(
          #"{"summary":{"totalSpent":100,"totalIncome":300,"net":200,"txCount":\#(stub.txCount)},"byCategory":[],"byMonth":[],"topMerchants":[],"rangeMonths":6}"#.utf8))
      case "/api/analytics/cashflow": return (200, Data(cashflowJSON.utf8))
      case "/api/analytics/spending": return (200, Data(spendingJSON.utf8))
      case "/api/ui-state":
        return r.httpMethod == "PUT"
          ? (200, Data(#"{"ok":true}"#.utf8)) : (200, Data(#"{"value":\#(stub.limit)}"#.utf8))
      default: return (404, Data())
      }
    }

    func store(gates: [Gate] = []) -> AnalyticsStore {
      let stub = self.stub
      let c = APIClient(
        baseURL: base,
        session: StubURLProtocol.session({ try Self.answer($0, stub) }, gates: gates))
      return AnalyticsStore { c }
    }

    func paths() -> [String] { StubURLProtocol.requests.compactMap { $0.url?.path() } }

    nonisolated static func isAnalytics(_ r: URLRequest) -> Bool { r.url?.path() == "/api/analytics" }
    nonisolated static func isPUT(_ r: URLRequest) -> Bool { r.httpMethod == "PUT" }

    // MARK: Loading

    @Test func normalModeLoadsSummaryAndCashflowOnly() async {
      let s = store()
      await s.load(isPro: false)
      #expect(paths() == ["/api/analytics", "/api/analytics/cashflow"])
      #expect(TestData.query(of: StubURLProtocol.requests[0], "months") == "6")
      #expect(s.summary?.txCount == 4)
      #expect(s.cashflow?.count == 1)
      #expect(s.spending == nil)
      #expect(s.error == nil && s.banner == nil)
    }

    @Test func proModeAlsoLoadsSpendingAndTheLimit() async {
      stub.limit = "2500"
      let s = store()
      await s.load(isPro: true)
      #expect(paths() == [
        "/api/analytics", "/api/analytics/cashflow", "/api/analytics/spending", "/api/ui-state",
      ])
      #expect(TestData.query(of: StubURLProtocol.requests[3], "key") == "spendingMonthlyLimit")
      #expect(s.spending?.count == 1)
      #expect(s.limitOverride == 2500)
    }

    @Test func aNumericStringLimitIsRead() async {
      stub.limit = #""1800""#
      let s = store()
      await s.load(isPro: true)
      #expect(s.limitOverride == 1800)
    }

    @Test func anUnusableOrFailedLimitReadIsSilent() async {
      stub.limit = #""""#
      let s = store()
      await s.load(isPro: true)
      #expect(s.limitOverride == nil)
      stub.failing = ["/api/ui-state"]
      await s.load(isPro: true)
      #expect(s.limitOverride == nil)
      #expect(s.banner == nil)
    }

    @Test func withNothingLoadedAFailureIsFullScreen() async {
      stub.failing = ["/api/analytics", "/api/analytics/cashflow"]
      let s = store()
      await s.load(isPro: false)
      #expect(s.error == .server(status: 500, message: "Failed to compute analytics"))
      #expect(s.banner == nil)
      #expect(!s.hasData)
    }

    @Test func noServerIsNotConfigured() async {
      let s = AnalyticsStore { nil }
      await s.load(isPro: false)
      #expect(s.error == .notConfigured)
    }

    @Test func withDataShowingAFailureIsABannerAndTheDataStays() async {
      let s = store()
      await s.load(isPro: false)
      stub.failing = ["/api/analytics/cashflow"]
      await s.load(isPro: false)
      #expect(s.banner == "Failed to compute analytics")
      #expect(s.cashflow?.count == 1)
      #expect(s.error == nil)
    }

    @Test func aSpendingFailureInProIsABanner() async {
      let s = store()
      await s.load(isPro: false)
      stub.failing = ["/api/analytics/spending"]
      await s.load(isPro: true)
      #expect(s.banner == "Failed to compute analytics")
    }

    @Test func aSuccessfulLoadClearsTheBanner() async {
      let s = store()
      await s.load(isPro: false)
      s.banner = "Old"
      await s.load(isPro: false)
      #expect(s.banner == nil)
    }

    @Test func refreshClearsAStaleBannerBeforeItsCalls() async {
      let gate = Gate(Self.isAnalytics)
      let s = store(gates: [gate])
      s.banner = "Old"
      let task = Task { await s.refresh(isPro: false) }
      await gate.arrival()
      #expect(s.banner == nil)
      gate.open()
      await task.value
    }

    @Test func cancelledIsSilent() async {
      stub.cancel = true
      let s = store()
      await s.load(isPro: false)
      #expect(s.error == nil)
      #expect(s.banner == nil)
    }

    @Test func aStaleLoadIsDropped() async {
      let gate = Gate(Self.isAnalytics)
      let s = store(gates: [gate])
      stub.txCount = 1
      let first = Task { await s.load(isPro: false) }
      await gate.arrival()
      stub.txCount = 2
      await s.load(isPro: false)
      #expect(s.summary?.txCount == 2)
      stub.txCount = 1
      gate.open()
      await first.value
      #expect(s.summary?.txCount == 2, "the older load's answer must not win")
    }

    // MARK: Range

    @Test func changingTheRangeReloadsTheSummaryOnly() async {
      let s = store()
      await s.load(isPro: false)
      let before = StubURLProtocol.requests.count
      await s.changeRange(12)
      let sent = StubURLProtocol.requests.dropFirst(before)
      #expect(sent.map { $0.url?.path() } == ["/api/analytics"])
      #expect(TestData.query(of: sent.first!, "months") == "12")
      #expect(s.range == 12)
      #expect(!s.isLoadingSummary)
    }

    @Test func aFailedRangeChangeIsABanner() async {
      let s = store()
      await s.load(isPro: false)
      stub.failing = ["/api/analytics"]
      await s.changeRange(3)
      #expect(s.banner == "Failed to compute analytics")
      #expect(s.summary != nil)
    }

    // MARK: Limit

    @Test func savingTheLimitSendsExactlyTheKeyAndANumber() async throws {
      let s = store()
      await s.saveLimit(2500, current: 3000)
      #expect(s.limitOverride == 2500)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "PUT")
      #expect(request.url?.path() == "/api/ui-state")
      let body = try #require(StubURLProtocol.body(of: request))
      let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
      #expect(json.count == 2)
      #expect(json["key"] as? String == "spendingMonthlyLimit")
      #expect(!(json["value"] is String))
      #expect((json["value"] as? NSNumber)?.doubleValue == 2500)
    }

    @Test func anUnchangedLimitSendsNothing() async {
      let s = store()
      await s.saveLimit(3000, current: 3000)
      #expect(StubURLProtocol.requests.isEmpty)
      #expect(s.limitOverride == nil)
    }

    @Test func aNegativeLimitIsSavedAsZero() async throws {
      let s = store()
      await s.saveLimit(-50, current: 3000)
      #expect(s.limitOverride == 0)
      let body = try #require(StubURLProtocol.body(of: #require(StubURLProtocol.requests.first)))
      let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
      #expect((json["value"] as? NSNumber)?.doubleValue == 0)
    }

    @Test func aFailedSaveKeepsTheValueAndShowsABanner() async {
      stub.failing = ["/api/ui-state"]
      let s = store()
      await s.saveLimit(2000, current: 3000)
      #expect(s.limitOverride == 2000)
      #expect(s.banner == "Couldn't save the limit to the server.")
    }

    @Test func aLoadDuringASaveDoesNotOverwriteTheLimit() async {
      stub.limit = "100"
      let put = Gate(Self.isPUT)
      let s = store(gates: [put])
      let save = Task { await s.saveLimit(2000, current: 3000) }
      await put.arrival()
      await s.load(isPro: true)
      #expect(s.limitOverride == 2000)
      put.open()
      await save.value
    }
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the test command. Expected: build failure, because `AnalyticsStore` is not defined.

- [ ] **Step 3: Write the store**

`ios/BudgetPhone/Analytics/AnalyticsStore.swift`:
```swift
import Foundation
import Observation

/// What the Analytics tab shows (../src/components/AnalyticsDashboard.tsx):
/// the summary cards, the cash-flow series the category and trend charts
/// window over, and in Pro mode the daily spend and saved monthly limit.
/// Same failure rules as AccountsStore: with nothing on screen an error is
/// full-screen; with data showing it becomes a banner and the data stays.
@MainActor
@Observable
final class AnalyticsStore {
  /// SpendingGraph's LIMIT_KEY in /api/ui-state.
  static let limitKey = "spendingMonthlyLimit"
  /// AnalyticsDashboard's RANGES.
  static let ranges = [3, 6, 12]

  private(set) var range = 6
  private(set) var summary: AnalyticsSummary?
  /// True while a range change waits for its summary; the cards dim.
  private(set) var isLoadingSummary = false
  private(set) var cashflow: [CashflowMonth]?
  private(set) var spending: [DailySpend]?
  /// The saved limit; nil means the graph uses its computed default.
  private(set) var limitOverride: Double?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  /// A non-blocking message over data that is still valid.
  var banner: String?

  var hasData: Bool { summary != nil || cashflow != nil }

  private let client: @MainActor () -> APIClient?
  /// Bumped by every load; a completion applies only if it is still the
  /// latest (overlapping `.task`, `scenePhase`, pull and Pro changes).
  private var loadGeneration = 0
  /// Bumped by loads and range changes, which both write `summary`.
  private var summaryGeneration = 0
  private var limitSaves = 0
  private var limitSavesInFlight = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// The tab's GETs, one after another. The first failure decides the
  /// message; a limit read never does (the web ignores it too).
  func load(isPro: Bool) async {
    loadGeneration += 1
    summaryGeneration += 1
    let generation = loadGeneration
    let summaryGen = summaryGeneration
    guard let client = client() else {
      summary = nil
      cashflow = nil
      spending = nil
      error = .notConfigured
      return
    }
    if !hasData { error = nil }
    var failure: APIError?

    do throws(APIError) {
      let result = try await client.analytics(months: range)
      guard generation == loadGeneration else { return }
      if summaryGen == summaryGeneration { summary = result.summary }
    } catch {
      guard generation == loadGeneration else { return }
      failure = failure ?? error
    }

    do throws(APIError) {
      let result = try await client.cashflow()
      guard generation == loadGeneration else { return }
      cashflow = result.months
    } catch {
      guard generation == loadGeneration else { return }
      failure = failure ?? error
    }

    if isPro {
      do throws(APIError) {
        let result = try await client.spending()
        guard generation == loadGeneration else { return }
        spending = result.days
      } catch {
        guard generation == loadGeneration else { return }
        failure = failure ?? error
      }
      await loadLimit(client, generation: generation)
      guard generation == loadGeneration else { return }
    }

    report(failure)
  }

  /// Pull-to-refresh: clears a stale banner first, then reloads. Analytics
  /// never calls Plaid.
  func refresh(isPro: Bool) async {
    banner = nil
    await load(isPro: isPro)
  }

  /// The range picker: reloads the summary only, keeping the old cards
  /// (dimmed) until the new ones arrive.
  func changeRange(_ months: Int) async {
    range = months
    summaryGeneration += 1
    let generation = summaryGeneration
    guard let client = client() else { return }
    banner = nil
    isLoadingSummary = true
    defer { if generation == summaryGeneration { isLoadingSummary = false } }
    do throws(APIError) {
      let result = try await client.analytics(months: months)
      guard generation == summaryGeneration else { return }
      summary = result.summary
    } catch {
      guard generation == summaryGeneration else { return }
      if error == .cancelled { return }
      if hasData { banner = error.message } else { self.error = error }
    }
  }

  /// SpendingGraph's setLimit: applies at once, then saves. The web falls
  /// back silently to localStorage; the phone has nowhere else to keep the
  /// value, so a failed save shows a banner.
  func saveLimit(_ value: Double, current: Double) async {
    let value = max(0, value)
    guard value != current else { return }
    limitSaves += 1
    let mine = limitSaves
    limitOverride = value
    banner = nil
    guard let client = client() else { return }
    limitSavesInFlight += 1
    defer { limitSavesInFlight -= 1 }
    do throws(APIError) {
      try await client.putUIState(key: Self.limitKey, value: value)
    } catch {
      if error != .cancelled && mine == limitSaves {
        banner = "Couldn't save the limit to the server."
      }
    }
  }

  /// loadSynced's read. Silent on failure or an unusable value. Dropped if a
  /// save was in flight at its start or end, or one started meanwhile.
  private func loadLimit(_ client: APIClient, generation: Int) async {
    guard limitSavesInFlight == 0 else { return }
    let saves = limitSaves
    guard let stored = try? await client.uiState(Self.limitKey) else { return }
    guard generation == loadGeneration, saves == limitSaves, limitSavesInFlight == 0 else { return }
    if let value = stored.number { limitOverride = value }
  }

  /// A load's outcome: success clears both messages; a failure is
  /// full-screen with nothing to show, else a banner. `.cancelled` is silent.
  private func report(_ failure: APIError?) {
    guard let failure else {
      error = nil
      banner = nil
      return
    }
    if failure == .cancelled { return }
    if hasData { banner = failure.message } else { error = failure }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the test command. Expected: all pass, and the whole suite stays green.

- [ ] **Step 5: Scrub and commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Analytics/AnalyticsStore.swift BudgetPhoneTests/AnalyticsStoreTests.swift
git commit -m "Add the Analytics store to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Analytics tab (summary, category and trend charts)

**Files:**
- Create: `ios/BudgetPhone/Analytics/SummaryGrid.swift`, `ChartCard.swift`, `WindowNav.swift`, `CategoryChartCard.swift`, `MonthlyTrendCard.swift`, `AnalyticsView.swift`
- Modify: `ios/BudgetPhone/App/RootView.swift` (the `TabView`)
- Test: `ios/BudgetPhoneTests/SummaryTileTests.swift`

**Interfaces:**
- Consumes: `AnalyticsStore` (Task 4); `MonthWindow`, `CategoryBreakdown`, `CategoryColors`, `Formatters.compactCurrency` (Task 2); `ProMode` (existing; `isPro`, `hasLoaded`); `ErrorView` (existing, in `Accounts/AccountsView.swift`); `Banner` (existing).
- Produces:
  - `SummaryTile.tiles(_ s: AnalyticsSummary) -> [SummaryTile]`
  - `ChartCard(title:subtitle:controls:content:)`
  - `WindowNav(canEarlier:canLater:pan:canZoomIn:canZoomOut:zoom:)` and `WindowNav(window: Binding<MonthWindow>)`
  - `AnalyticsView(proMode:)`
  - Task 6 adds `SpendingGraphCard(store:)` into `AnalyticsView`.

- [ ] **Step 1: Write the failing test**

`ios/BudgetPhoneTests/SummaryTileTests.swift`:
```swift
import Testing
@testable import BudgetPhone

/// SummaryCards.tsx: labels, values and tones.
struct SummaryTileTests {
  @Test func tilesMatchTheWeb() {
    let tiles = SummaryTile.tiles(
      AnalyticsSummary(totalSpent: 1840.5, totalIncome: 3200, net: 1359.5, txCount: 42))
    #expect(tiles.map(\.label) == ["Spent", "Income", "Net", "Transactions"])
    #expect(tiles.map(\.value) == ["$1,840.50", "$3,200.00", "+$1,359.50", "42"])
    #expect(tiles.map(\.tone) == [.neutral, .income, .income, .neutral])
  }

  @Test func aNegativeNetIsRedWithoutAPlus() {
    let net = SummaryTile.tiles(
      AnalyticsSummary(totalSpent: 500, totalIncome: 200, net: -300, txCount: 3))[2]
    #expect(net.value == "-$300.00")
    #expect(net.tone == .spend)
  }

  @Test func zeroNetCountsAsIncome() {
    let net = SummaryTile.tiles(
      AnalyticsSummary(totalSpent: 0, totalIncome: 0, net: 0, txCount: 0))[2]
    #expect(net.value == "+$0.00")
    #expect(net.tone == .income)
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run the test command. Expected: build failure, because `SummaryTile` is not defined.

- [ ] **Step 3: Write `SummaryGrid`**

`ios/BudgetPhone/Analytics/SummaryGrid.swift`:
```swift
import SwiftUI

/// One summary card (../src/components/SummaryCards.tsx).
struct SummaryTile: Identifiable, Equatable {
  enum Tone { case neutral, income, spend }

  let label: String
  let value: String
  let tone: Tone
  var id: String { label }

  static func tiles(_ s: AnalyticsSummary) -> [SummaryTile] {
    [
      SummaryTile(label: "Spent", value: Formatters.currency(s.totalSpent), tone: .neutral),
      SummaryTile(label: "Income", value: Formatters.currency(s.totalIncome), tone: .income),
      SummaryTile(
        label: "Net",
        value: s.net >= 0 ? "+\(Formatters.currency(s.net))" : Formatters.currency(s.net),
        tone: s.net >= 0 ? .income : .spend),
      SummaryTile(label: "Transactions", value: String(s.txCount), tone: .neutral),
    ]
  }
}

extension SummaryTile.Tone {
  var color: Color {
    switch self {
    case .neutral: .primary
    case .income: .green
    case .spend: .red
    }
  }
}

/// Spent / Income / Net / Transactions, two across (one at accessibility
/// sizes).
struct SummaryGrid: View {
  let summary: AnalyticsSummary
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let columns = Array(
      repeating: GridItem(.flexible(), spacing: 12),
      count: dynamicTypeSize.isAccessibilitySize ? 1 : 2)
    LazyVGrid(columns: columns, spacing: 12) {
      ForEach(SummaryTile.tiles(summary)) { tile in
        VStack(alignment: .leading, spacing: 4) {
          Text(tile.label)
            .font(.caption)
            .textCase(.uppercase)
            .foregroundStyle(.secondary)
          Text(tile.value)
            .font(.title3.weight(.semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .foregroundStyle(tile.tone.color)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run the test command. Expected: `SummaryTileTests` passes.

- [ ] **Step 5: Write `ChartCard` and `WindowNav`**

`ios/BudgetPhone/Analytics/ChartCard.swift`:
```swift
import SwiftUI

/// The panel every Analytics chart sits in: title and range line, its
/// controls beside them (below at accessibility sizes), then the chart.
struct ChartCard<Controls: View, Content: View>: View {
  let title: String
  let subtitle: String
  @ViewBuilder let controls: Controls
  @ViewBuilder let content: Content
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let stacked = dynamicTypeSize.isAccessibilitySize
    let header =
      stacked
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
      : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
    VStack(alignment: .leading, spacing: 12) {
      header {
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.headline)
          Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
        if !stacked { Spacer(minLength: 0) }
        controls
      }
      content
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
  }
}
```

`ios/BudgetPhone/Analytics/WindowNav.swift`:
```swift
import SwiftUI

/// The charts' month controls (../src/components/charts/WindowNav.tsx):
/// pan ‹ › and, where the chart zooms, − +.
struct WindowNav: View {
  let canEarlier: Bool
  let canLater: Bool
  let pan: (Int) -> Void
  var canZoomIn = false
  var canZoomOut = false
  var zoom: ((Int) -> Void)?

  var body: some View {
    HStack(spacing: 8) {
      HStack(spacing: 0) {
        Button("Earlier", systemImage: "chevron.left") { pan(-1) }.disabled(!canEarlier)
        Button("Later", systemImage: "chevron.right") { pan(1) }.disabled(!canLater)
      }
      if let zoom {
        HStack(spacing: 0) {
          Button("Fewer months", systemImage: "minus") { zoom(-1) }.disabled(!canZoomIn)
          Button("More months", systemImage: "plus") { zoom(1) }.disabled(!canZoomOut)
        }
      }
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.bordered)
    .controlSize(.small)
  }
}

extension WindowNav {
  /// Pan and zoom over a `MonthWindow`.
  init(window: Binding<MonthWindow>) {
    let w = window.wrappedValue
    self.init(
      canEarlier: w.canEarlier, canLater: w.canLater, pan: { window.wrappedValue.pan($0) },
      canZoomIn: w.canZoomIn, canZoomOut: w.canZoomOut, zoom: { window.wrappedValue.zoom($0) })
  }
}
```

- [ ] **Step 6: Write `CategoryChartCard`**

`ios/BudgetPhone/Analytics/CategoryChartCard.swift`:
```swift
import Charts
import SwiftUI

/// Spending by category (../src/components/charts/CategoryChart.tsx): a
/// donut over the windowed months, opening on the latest month.
struct CategoryChartCard: View {
  let months: [CashflowMonth]
  @State private var window = MonthWindow(defaultSpan: 1)
  @State private var selectedAngle: Double?
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let shown = Array(months[window.range.clamped(to: 0..<months.count)])
    let slices = CategoryBreakdown.slices(shown)
    let sum = slices.reduce(0) { $0 + $1.amount }
    let label = MonthWindow.label(shown.map(\.label))
    // Recharts skips non-positive slices; Swift Charts can't draw them.
    let drawn = slices.filter { $0.amount > 0 }
    let selected = selectedAngle.flatMap { CategoryBreakdown.slice(at: $0, in: drawn) }

    ChartCard(
      title: "Spending by category",
      subtitle: shown.count > 1 ? "\(label) · \(shown.count) months" : label
    ) {
      WindowNav(window: $window)
    } content: {
      if slices.isEmpty {
        Text("No spending in \(label).")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, minHeight: 200)
      } else {
        Chart(drawn) { slice in
          SectorMark(
            angle: .value("Amount", slice.amount), innerRadius: .ratio(0.7), angularInset: 1.5
          )
          .foregroundStyle(CategoryColors.color(for: slice.category))
          .opacity(selected == nil || selected == slice ? 1 : 0.4)
        }
        .chartAngleSelection(value: $selectedAngle)
        .chartBackground { proxy in
          GeometryReader { geometry in
            if let plot = proxy.plotFrame {
              let frame = geometry[plot]
              VStack(spacing: 2) {
                Text(selected?.category ?? "Total")
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  .lineLimit(1)
                Text(Formatters.currency(selected?.amount ?? sum))
                  .font(.headline)
                  .monospacedDigit()
                  .lineLimit(1)
                  .minimumScaleFactor(0.6)
              }
              .frame(width: frame.width * 0.6)
              .position(x: frame.midX, y: frame.midY)
            }
          }
        }
        .frame(height: 200)

        VStack(spacing: 6) {
          ForEach(slices) { slice in legendRow(slice, sum: sum) }
        }
        .font(.subheadline)
      }
    }
    .onChange(of: months.count, initial: true) { _, count in window.setTotal(count) }
  }

  @ViewBuilder private func legendRow(_ slice: CategorySlice, sum: Double) -> some View {
    let swatch = RoundedRectangle(cornerRadius: 2)
      .fill(CategoryColors.color(for: slice.category))
      .frame(width: 10, height: 10)
    let percent = Text("\(CategoryBreakdown.percent(slice.amount, of: sum))%")
      .foregroundStyle(.secondary)
    let amount = Text(Formatters.currency(slice.amount)).monospacedDigit().lineLimit(1)
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 8) {
          swatch
          Text(slice.category)
        }
        HStack(spacing: 8) {
          percent
          amount
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      HStack(spacing: 8) {
        swatch
        Text(slice.category).lineLimit(1)
        Spacer(minLength: 4)
        percent
        amount
      }
    }
  }
}
```

- [ ] **Step 7: Write `MonthlyTrendCard`**

`ios/BudgetPhone/Analytics/MonthlyTrendCard.swift`:
```swift
import Charts
import SwiftUI

/// Monthly spending vs income (../src/components/charts/MonthlyTrendChart.tsx):
/// grouped bars over the windowed months, opening on the last six.
struct MonthlyTrendCard: View {
  let months: [CashflowMonth]
  @State private var window = MonthWindow(defaultSpan: 6)
  @State private var selectedKey: String?

  private struct Bar: Identifiable {
    let key: String
    let series: String
    let amount: Double
    var id: String { key + series }
  }

  var body: some View {
    let shown = Array(months[window.range.clamped(to: 0..<months.count)])
    let bars = shown.flatMap {
      [
        Bar(key: $0.key, series: "Income", amount: $0.totalIncome),
        Bar(key: $0.key, series: "Spent", amount: $0.totalSpent),
      ]
    }
    let short = Dictionary(
      shown.map { ($0.key, String($0.label.split(separator: " ").first ?? "")) },
      uniquingKeysWith: { a, _ in a })

    ChartCard(title: "Monthly spending vs income", subtitle: MonthWindow.label(shown.map(\.label))) {
      WindowNav(window: $window)
    } content: {
      Chart {
        ForEach(bars) { bar in
          BarMark(x: .value("Month", bar.key), y: .value("Amount", bar.amount))
            .foregroundStyle(by: .value("Series", bar.series))
            .position(by: .value("Series", bar.series))
            .cornerRadius(3)
        }
        if let key = selectedKey, let month = shown.first(where: { $0.key == key }) {
          RuleMark(x: .value("Month", key))
            .foregroundStyle(Color.secondary.opacity(0.15))
            .annotation(
              position: .top, spacing: 0,
              overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
            ) {
              VStack(alignment: .leading, spacing: 2) {
                Text(month.label).fontWeight(.semibold)
                Text("Income \(Formatters.currency(month.totalIncome))")
                Text("Spent \(Formatters.currency(month.totalSpent))")
              }
              .font(.caption)
              .monospacedDigit()
              .padding(6)
              .background(.regularMaterial, in: .rect(cornerRadius: 8))
            }
        }
      }
      .chartForegroundStyleScale([
        "Income": CategoryColors.color(hex: CategoryColors.income),
        "Spent": CategoryColors.color(hex: CategoryColors.hub),
      ])
      .chartXAxis {
        AxisMarks { value in
          AxisValueLabel {
            if let key = value.as(String.self) { Text(short[key] ?? key) }
          }
        }
      }
      .chartYAxis {
        AxisMarks { value in
          AxisGridLine()
          AxisValueLabel {
            if let amount = value.as(Double.self) { Text(Formatters.compactCurrency(amount)) }
          }
        }
      }
      .chartXSelection(value: $selectedKey)
      .chartLegend(position: .bottom)
      .frame(height: 240)
    }
    .onChange(of: months.count, initial: true) { _, count in window.setTotal(count) }
  }
}
```

- [ ] **Step 8: Write `AnalyticsView`**

`ios/BudgetPhone/Analytics/AnalyticsView.swift`:
```swift
import SwiftUI

/// The Analytics tab: the web's AnalyticsDashboard
/// (../src/components/AnalyticsDashboard.tsx) without the Cash-flow Sankey.
struct AnalyticsView: View {
  let proMode: ProMode
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var store = AnalyticsStore {
    ServerAddress.saved().map { APIClient(baseURL: $0) }
  }
  @State private var range = 6

  var body: some View {
    NavigationStack {
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Analytics")
    }
    .task { await store.load(isPro: proMode.isPro) }
    // Another device may have changed something while this one was away.
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await store.load(isPro: proMode.isPro) } }
    }
    .onChange(of: server) { Task { await store.load(isPro: proMode.isPro) } }
    .onChange(of: proMode.isPro) { _, pro in
      if pro && store.spending == nil { Task { await store.load(isPro: true) } }
    }
  }

  @ViewBuilder private var content: some View {
    if store.hasData {
      dashboard
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load(isPro: proMode.isPro) } }
    } else {
      ProgressView()
    }
  }

  private var dashboard: some View {
    ScrollView {
      VStack(spacing: 16) {
        summary
        if proMode.isPro {
          SpendingGraphCard(store: store)
        }
        CategoryChartCard(months: store.cashflow ?? [])
        MonthlyTrendCard(months: store.cashflow ?? [])
        if proMode.hasLoaded && !proMode.isPro {
          Text("Cash flow and cumulative spending are hidden in Normal mode — switch to Pro in Settings.")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
      }
      .padding()
    }
    .refreshable { await store.refresh(isPro: proMode.isPro) }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner {
        Banner(text: banner) { store.banner = nil }
      }
    }
  }

  private var summary: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Summary over the last \(store.range) months")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      Picker("Range", selection: $range) {
        ForEach(AnalyticsStore.ranges, id: \.self) { Text("\($0)m").tag($0) }
      }
      .pickerStyle(.segmented)
      .onChange(of: range) { _, months in Task { await store.changeRange(months) } }
      if let summary = store.summary {
        SummaryGrid(summary: summary)
          .opacity(store.isLoadingSummary ? 0.6 : 1)
          .animation(.default, value: store.isLoadingSummary)
      }
    }
  }
}
```
`SpendingGraphCard` arrives in Task 6. Until then, add this placeholder at the bottom of `AnalyticsView.swift` so the task builds and passes on its own. **Task 6 deletes it:**
```swift
/// Replaced in Task 6.
struct SpendingGraphCard: View {
  let store: AnalyticsStore
  var body: some View { EmptyView() }
}
```

- [ ] **Step 9: Add the tab**

In `ios/BudgetPhone/App/RootView.swift`, between the Transactions and Settings tabs:
```swift
          Tab("Analytics", systemImage: "chart.pie") {
            AnalyticsView(proMode: proMode)
          }
```

- [ ] **Step 10: Build and run the whole suite**

Run the test command. Expected: it builds, and every test passes.

- [ ] **Step 11: Scrub and commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Analytics BudgetPhone/App/RootView.swift BudgetPhoneTests/SummaryTileTests.swift
git commit -m "Add the Analytics tab to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The implementer does not run the app. The controller does the simulator check after Task 6.

---

### Task 6: The Spending graph (Pro) and limit editor

**Files:**
- Create: `ios/BudgetPhone/Analytics/SpendingGraphCard.swift`, `ios/BudgetPhone/Analytics/LimitSheet.swift`
- Modify: `ios/BudgetPhone/Analytics/AnalyticsView.swift` (delete the placeholder `SpendingGraphCard` at the bottom)

**Interfaces:**
- Consumes: `AnalyticsStore.spending`, `limitOverride`, `saveLimit(_:current:)` (Task 4); `SpendingMath` (Task 3); `ChartCard`, `WindowNav` (Task 5); `CategoryColors`, `Formatters` (Task 2).
- Produces: `SpendingGraphCard(store:)`, `LimitSheet(limit:save:)`.

All the logic here is already covered by `SpendingMathTests` and `AnalyticsStoreTests`. This task is view code, so it has no new unit test. The check is a green build and suite, then the controller's look on the simulator.

- [ ] **Step 1: Delete the placeholder**

Remove the `/// Replaced in Task 6.` `SpendingGraphCard` struct from the bottom of `ios/BudgetPhone/Analytics/AnalyticsView.swift`.

- [ ] **Step 2: Write `LimitSheet`**

`ios/BudgetPhone/Analytics/LimitSheet.swift`:
```swift
import SwiftUI

/// Edits the Spending graph's monthly limit. The web's inline number field
/// saves 0 for anything unreadable; here Save waits for a number instead.
struct LimitSheet: View {
  let save: (Double) -> Void
  @State private var text: String
  @Environment(\.dismiss) private var dismiss

  init(limit: Double, save: @escaping (Double) -> Void) {
    self.save = save
    _text = State(initialValue: Formatters.plainNumber(limit))
  }

  private var value: Double? { Double(text).flatMap { $0.isFinite ? $0 : nil } }

  var body: some View {
    NavigationStack {
      Form {
        HStack {
          Text("$")
          TextField("Limit", text: $text)
            .keyboardType(.decimalPad)
            .monospacedDigit()
        }
      }
      .navigationTitle("Monthly Limit")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            if let value { save(max(0, value)) }
            dismiss()
          }
          .disabled(value == nil)
        }
      }
    }
    .presentationDetents([.medium])
  }
}
```

- [ ] **Step 3: Write `SpendingGraphCard`**

`ios/BudgetPhone/Analytics/SpendingGraphCard.swift`:
```swift
import Charts
import SwiftUI

/// The cumulative Spending graph (../src/components/charts/SpendingGraph.tsx),
/// shown in Pro mode only: this month against its limit, the long-run
/// average, and last month or last year.
struct SpendingGraphCard: View {
  let store: AnalyticsStore
  /// nil = the latest month.
  @State private var selectedIndex: Int?
  @State private var compare: SpendingMath.Compare = .lastMonth
  @State private var editingLimit = false
  @State private var selectedDay: Int?

  private let under = CategoryColors.color(hex: CategoryColors.income)
  private let over = CategoryColors.color(hex: CategoryColors.draw)
  private let averageColor = CategoryColors.color(hex: "#94a3b8")
  private let compareColor = CategoryColors.color(hex: "#64748b")

  var body: some View {
    let today = SpendingMath.Today(.now)
    let prepared = SpendingMath.prepare(store.spending ?? [], today: today)
    let months = prepared.months
    let index = min(max(0, selectedIndex ?? months.count - 1), max(0, months.count - 1))
    let month = months.indices.contains(index) ? months[index] : nil
    let limit = store.limitOverride ?? prepared.defaultLimit

    ChartCard(title: "Spending", subtitle: month?.label ?? "—") {
      WindowNav(
        canEarlier: index > 0, canLater: index < months.count - 1,
        pan: { selectedIndex = index + $0 })
    } content: {
      HStack(spacing: 8) {
        Button("Limit \(Formatters.currency(limit))") { editingLimit = true }
          .buttonStyle(.bordered)
          .controlSize(.small)
          .monospacedDigit()
        Picker("Compare", selection: $compare) {
          ForEach(SpendingMath.Compare.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
      }
      if store.spending == nil {
        ProgressView().frame(maxWidth: .infinity, minHeight: 240)
      } else if let month,
        case let chart = SpendingMath.chart(
          prepared, month: month, compare: compare, limit: limit, today: today),
        chart.peak != 0
      {
        plot(chart, limit: limit)
        legend(chart, limit: limit)
      } else {
        Text("No spending in \(month?.label ?? "this month").")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, minHeight: 240)
      }
    }
    .sheet(isPresented: $editingLimit) {
      LimitSheet(limit: limit) { value in
        Task { await store.saveLimit(value, current: limit) }
      }
    }
  }

  /// Solid when the series stays on one side of the limit; otherwise a
  /// hard red-to-green split at `split` (top = 0), as the web's gradients.
  private func splitStyle(_ split: Double, opacity: Double) -> AnyShapeStyle {
    if split <= 0 { return AnyShapeStyle(under.opacity(opacity)) }
    if split >= 1 { return AnyShapeStyle(over.opacity(opacity)) }
    return AnyShapeStyle(
      LinearGradient(
        stops: [
          .init(color: over.opacity(opacity), location: 0),
          .init(color: over.opacity(opacity), location: split),
          .init(color: under.opacity(opacity), location: split),
          .init(color: under.opacity(opacity), location: 1),
        ], startPoint: .top, endPoint: .bottom))
  }

  private func plot(_ chart: SpendingMath.Chart, limit: Double) -> some View {
    let currentRows = chart.rows.filter { $0.current != nil }
    return Chart {
      ForEach(chart.rows, id: \.day) { row in
        if let average = row.average {
          LineMark(
            x: .value("Day", row.day), y: .value("Amount", average),
            series: .value("Series", "Average")
          )
          .foregroundStyle(averageColor)
          .lineStyle(StrokeStyle(lineWidth: 1.5))
        }
        if let compared = row.compare {
          LineMark(
            x: .value("Day", row.day), y: .value("Amount", compared),
            series: .value("Series", "Compare")
          )
          .foregroundStyle(compareColor)
          .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
        }
      }
      ForEach(currentRows, id: \.day) { row in
        AreaMark(
          x: .value("Day", row.day), y: .value("Amount", row.current ?? 0),
          series: .value("Series", "This month")
        )
        .foregroundStyle(splitStyle(chart.splitFill, opacity: 0.2))
        LineMark(
          x: .value("Day", row.day), y: .value("Amount", row.current ?? 0),
          series: .value("Series", "This month line")
        )
        .foregroundStyle(splitStyle(chart.splitLine, opacity: 1))
        .lineStyle(StrokeStyle(lineWidth: 2.5))
      }
      RuleMark(y: .value("Limit", limit))
        .foregroundStyle(Color.secondary)
        .lineStyle(StrokeStyle(lineWidth: 1, dash: [5, 4]))
        .annotation(position: .top, alignment: .trailing) {
          Text("Limit \(Formatters.compactCurrency(limit))")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      if let day = selectedDay, let row = chart.rows.first(where: { $0.day == day }) {
        RuleMark(x: .value("Day", day))
          .foregroundStyle(Color.secondary.opacity(0.3))
          .annotation(
            position: .top, spacing: 0,
            overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
          ) {
            readout(row)
          }
      }
    }
    .chartXScale(domain: 1...chart.days)
    .chartYScale(domain: 0...chart.top)
    .chartXAxis { AxisMarks(values: chart.ticks) }
    .chartYAxis {
      AxisMarks { value in
        AxisGridLine()
        AxisValueLabel {
          if let amount = value.as(Double.self) { Text(Formatters.compactCurrency(amount)) }
        }
      }
    }
    .chartXSelection(value: $selectedDay)
    .chartLegend(.hidden)
    .frame(height: 240)
  }

  private func readout(_ row: SpendingMath.Row) -> some View {
    func line(_ name: String, _ value: Double?) -> Text {
      Text("\(name) \(value.map(Formatters.currency) ?? "—")")
    }
    return VStack(alignment: .leading, spacing: 2) {
      Text("Day \(row.day)").fontWeight(.semibold)
      line("This month", row.current)
      line("Average", row.average)
      line(compare.label, row.compare)
    }
    .font(.caption)
    .monospacedDigit()
    .padding(6)
    .background(.regularMaterial, in: .rect(cornerRadius: 8))
  }

  private func legend(_ chart: SpendingMath.Chart, limit: Double) -> some View {
    let status = SpendingMath.status(spent: chart.spent, limit: limit)
    return VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Capsule()
          .fill(LinearGradient(colors: [under, over], startPoint: .leading, endPoint: .trailing))
          .frame(width: 16, height: 6)
        Text("This month \(Formatters.currency(chart.spent))").monospacedDigit()
      }
      HStack(spacing: 6) {
        Capsule().fill(averageColor).frame(width: 16, height: 2)
        Text("Average")
      }
      HStack(spacing: 6) {
        Path { p in
          p.move(to: CGPoint(x: 0, y: 1))
          p.addLine(to: CGPoint(x: 16, y: 1))
        }
        .stroke(compareColor, style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
        .frame(width: 16, height: 2)
        Text(compare.label)
      }
      Text(status.text)
        .monospacedDigit()
        .foregroundStyle(status.over ? Color.red : Color.green)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}
```
If `case let chart = …` inside the `if` chain doesn't compile, compute `chart` in a small `@ViewBuilder` helper that takes `month` and switches on `chart.peak`. The behaviour must stay the same.

- [ ] **Step 4: Build and run the whole suite**

Run the test command. Expected: it builds, and every test passes.

- [ ] **Step 5: Scrub and commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Analytics
git commit -m "Add the Pro Spending graph and limit editor to the iPhone Analytics tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks (controller only)

1. **Simulator look, GET only.** Build and launch on the iPhone 17 Pro simulator, open the Analytics tab, and take screenshots in light mode, dark mode and at an accessibility text size. Tapping the range picker, the pan/zoom buttons and chart selection is fine, because those only GET. **Never** pull to refresh on Accounts or the Ledger. Never change Pro Mode, and never tap Save on the limit. If the live server is in Normal mode, the Pro graph can't be seen without a write, so that look is left to the owner.
2. **The split colours.** If the server is already in Pro and the month crosses the limit, check that the line turns red above the limit line, not at some other height. If it is visibly wrong, Swift Charts is applying the gradient over the plot area rather than the mark's bounds. In that case, use `1 - limit / chart.top` as the split for both styles.
3. Check the diff for real values (names, merchants, amounts), run `bash ../scripts/test-scrub.sh`, then finish the branch with superpowers:finishing-a-development-branch.
4. Leave the write check to the owner: editing the limit on the phone should show the new value on the web.
