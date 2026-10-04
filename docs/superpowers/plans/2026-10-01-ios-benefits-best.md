# iPhone Benefits → Best Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Benefits tab whose first page is the web's Best card: for each bonus category, the card that earns the most, and the next two.

**Architecture:**
- **Task 1:** models and calls.
- **Task 2:** pure ports of the web's ranking and card colours.
- **Task 3:** a `@MainActor @Observable` store.
- **Task 4:** SwiftUI views and the new tab in `RootView`.

**Tech Stack:** Swift 6, SwiftUI, iOS 26, Swift Testing, `StubURLProtocol`.

**Spec:** `docs/superpowers/specs/2026-10-01-ios-benefits-best-design.md`

## Global Constraints

- Work in `ios/` on branch `ios-benefits-best`. Read `ios/CLAUDE.md` first; it is binding.
- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. New files under `BudgetPhone/` or `BudgetPhoneTests/` join their targets automatically, and `.json` files under `BudgetPhoneTests/Fixtures/` become test resources.
- Test command, run from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Run `bash ../scripts/test-scrub.sh` before every commit.
- Stubbed suites nest as `extension StubbedNetworkTests { @Suite(.serialized) … }`.
- Each port names its web source in a comment. Copy wording verbatim unless the spec says otherwise.
- **The live server holds real money data.** Implementers never run the app. Tests use `StubURLProtocol` only, and fixtures use invented values only.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Models and calls

**Files:**
- Create: `ios/BudgetPhone/Models/UserCardModels.swift`, `ios/BudgetPhone/Networking/APIClient+Benefits.swift`, `ios/BudgetPhoneTests/Fixtures/user-cards.json`
- Test: `ios/BudgetPhoneTests/UserCardModelTests.swift`

**Interfaces (produces):**
- `UserCardsResponse { cards: [UserCardDTO] }`
- `UserCardDTO { id, issuer, name: String?, last4, displayName: String?, artUrl: String?, rewardRates: [RewardRateDTO] }` (also `Identifiable`)
- `RewardRateDTO { category, multiplier: Double, unit }`
- `APIClient.userCards() async throws(APIError) -> UserCardsResponse`
- `APIClient.cardArtURL(_ path: String) -> URL`

- [ ] **Step 1: Write the fixture.** It includes extra fields the phone ignores, and all values are invented.

`ios/BudgetPhoneTests/Fixtures/user-cards.json`:
```json
{ "cards": [
  { "id": "c1", "issuer": "AMEX", "name": "Gold", "last4": "0001", "membershipStartYear": 2024,
    "membershipStartMonth": 2, "annualFee": 250, "pointValueCents": 1, "artUrl": "/api/card-art/c1.png",
    "linked": true, "linkedAccountName": "Example Bank Gold", "displayName": "Example Bank Gold",
    "benefits": [], "benefitCount": 0, "benefitsUsedCount": 0, "creditsYtd": 0, "creditsAnnualMax": 0,
    "rewardRates": [
      { "id": "r1", "category": "DINING", "categoryLabel": "Dining", "multiplier": 4, "unit": "X", "display": "4x", "notes": null },
      { "id": "r2", "category": "OTHER", "categoryLabel": "Everything else", "multiplier": 1, "unit": "X", "display": "1x", "notes": null }
    ],
    "earnings": null, "earningsPeriodLabel": "Feb 2026 – Jan 2027" },
  { "id": "c2", "issuer": "CHASE", "name": null, "last4": "0002", "membershipStartYear": 2023,
    "membershipStartMonth": null, "annualFee": 0, "pointValueCents": 1, "artUrl": null,
    "linked": false, "linkedAccountName": null, "displayName": null,
    "benefits": [], "benefitCount": 0, "benefitsUsedCount": 0, "creditsYtd": 0, "creditsAnnualMax": 0,
    "rewardRates": [
      { "id": "r3", "category": "OTHER", "categoryLabel": "Everything else", "multiplier": 1.5, "unit": "PERCENT", "display": "1.5%", "notes": null }
    ],
    "earnings": null, "earningsPeriodLabel": "Jan 2026 – Dec 2026" }
] }
```

- [ ] **Step 2: Write the failing tests.**

`ios/BudgetPhoneTests/UserCardModelTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

struct UserCardModelTests {
  @Test func decodesWhatBestCardNeeds() throws {
    let r = try JSONDecoder().decode(UserCardsResponse.self, from: TestData.fixture("user-cards"))
    #expect(r.cards.map(\.id) == ["c1", "c2"])
    let gold = r.cards[0]
    #expect(gold.issuer == "AMEX" && gold.name == "Gold" && gold.last4 == "0001")
    #expect(gold.displayName == "Example Bank Gold")
    #expect(gold.artUrl == "/api/card-art/c1.png")
    #expect(gold.rewardRates == [
      RewardRateDTO(category: "DINING", multiplier: 4, unit: "X"),
      RewardRateDTO(category: "OTHER", multiplier: 1, unit: "X"),
    ])
    #expect(r.cards[1].name == nil && r.cards[1].artUrl == nil && r.cards[1].displayName == nil)
  }

  @Test func cardArtResolvesAgainstTheServer() {
    let c = APIClient(baseURL: URL(string: "http://budget-mac.local:3000")!)
    #expect(c.cardArtURL("/api/card-art/c1.png").absoluteString == "http://budget-mac.local:3000/api/card-art/c1.png")
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  struct UserCardAPITests {
    @Test func userCardsIsAGet() async throws {
      let c = APIClient(
        baseURL: URL(string: "http://budget-mac.local:3000")!,
        session: StubURLProtocol.session { _ in (200, Data(#"{"cards":[]}"#.utf8)) })
      _ = try await c.userCards()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "GET")
      #expect(request.url?.path() == "/api/user-cards")
    }
  }
}
```

- [ ] **Step 3: Run the tests. Expect them to fail** with a build error, because the types don't exist yet.

- [ ] **Step 4: Write the models.**

`ios/BudgetPhone/Models/UserCardModels.swift`:
```swift
import Foundation

// Mirrors of UserCardDTO / RewardRateDTO in ../src/types/index.ts. Only what
// Benefits → Best card reads is decoded; Cards and Flights will add fields.

struct RewardRateDTO: Decodable, Equatable, Sendable {
  let category: String
  let multiplier: Double
  let unit: String  // "X" | "PERCENT"
}

struct UserCardDTO: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let issuer: String
  let name: String?
  let last4: String
  /// The linked account's name from Accounts, shown over `name`.
  let displayName: String?
  /// "/api/card-art/<file>", or nil while the card has no image.
  let artUrl: String?
  let rewardRates: [RewardRateDTO]
}

struct UserCardsResponse: Decodable, Equatable, Sendable {
  let cards: [UserCardDTO]
}
```

- [ ] **Step 5: Write the calls.**

`ios/BudgetPhone/Networking/APIClient+Benefits.swift`:
```swift
import Foundation

extension APIClient {
  /// GET /api/user-cards — the cards Benefits shows, in the user's order.
  func userCards() async throws(APIError) -> UserCardsResponse {
    try decode(await send("GET", "api/user-cards", timeout: 15))
  }

  /// A card's `artUrl` is a server path ("/api/card-art/x.png"); this is the
  /// full URL for it.
  func cardArtURL(_ path: String) -> URL {
    baseURL.appending(path: path.hasPrefix("/") ? String(path.dropFirst()) : path)
  }
}
```

- [ ] **Step 6: Run the tests. Expect them to pass**, along with the full suite.
- [ ] **Step 7: Scrub and commit** with the message "Add the user-card models and calls to the iPhone app".

---

### Task 2: Ranking and card colours

**Files:**
- Create: `ios/BudgetPhone/Support/Rewards.swift`, `ios/BudgetPhone/Support/CardArtColors.swift`
- Test: `ios/BudgetPhoneTests/RewardsTests.swift`

**Interfaces (produces):**
- `Rewards.bonusCategories: [String]`
- `Rewards.label(for:) -> String`
- `Rewards.effectiveRate(_ rates: [RewardRateDTO], _ category: String) -> EffectiveRate` (fields: `multiplier`, `unit`, `isBonus`; also `formatted`)
- `Rewards.formatRate(_:_:) -> String`
- `Rewards.issuerLabel(_:) -> String`
- `Rewards.shortLabel(_ card: UserCardDTO) -> String`
- `Rewards.hasRates(_ cards:) -> Bool`
- `Rewards.bestByCategory(_ cards:) -> [CategoryRanking]`
- `CategoryRanking { category, label, ranked: [RankedCard] }`
- `RankedCard { card: UserCardDTO, rate: EffectiveRate }`
- `CardArtColors.hexes(issuer:seed:) -> (from: String, to: String)`
- `CardArtColors.colors(issuer:seed:) -> (from: Color, to: Color)`

- [ ] **Step 1: Write the failing tests.**

`ios/BudgetPhoneTests/RewardsTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

/// Ports of ../src/lib/rewards.ts, BestCards.tsx and cardArtColors.
struct RewardsTests {
  func card(_ id: String, issuer: String = "AMEX", name: String? = nil, display: String? = nil,
            _ rates: [(String, Double, String)]) -> UserCardDTO {
    UserCardDTO(
      id: id, issuer: issuer, name: name, last4: "000\(id.suffix(1))", displayName: display,
      artUrl: nil, rewardRates: rates.map { RewardRateDTO(category: $0.0, multiplier: $0.1, unit: $0.2) })
  }

  @Test func categoriesAndLabels() {
    #expect(Rewards.bonusCategories == [
      "DINING", "GROCERIES", "TRAVEL", "GAS", "TRANSIT", "ENTERTAINMENT", "ONLINE_SHOPPING", "DRUGSTORES", "ROTATING",
    ])
    #expect(Rewards.bonusCategories.map(Rewards.label(for:)) == [
      "Dining", "Groceries", "Travel", "Gas", "Transit", "Streaming", "Online Shopping", "Drugstores",
      "Rotating (quarterly)",
    ])
  }

  @Test func effectiveRateFallsBackToBaseThenOneX() {
    let rates = [RewardRateDTO(category: "DINING", multiplier: 4, unit: "X"),
                 RewardRateDTO(category: "OTHER", multiplier: 2, unit: "PERCENT")]
    #expect(Rewards.effectiveRate(rates, "DINING") == EffectiveRate(multiplier: 4, unit: "X", isBonus: true))
    #expect(Rewards.effectiveRate(rates, "GAS") == EffectiveRate(multiplier: 2, unit: "PERCENT", isBonus: false))
    #expect(Rewards.effectiveRate([], "GAS") == EffectiveRate(multiplier: 1, unit: "X", isBonus: false))
  }

  @Test func formatRatePrintsNumbersLikeJavaScript() {
    #expect(Rewards.formatRate(4, "X") == "4x")
    #expect(Rewards.formatRate(3, "PERCENT") == "3%")
    #expect(Rewards.formatRate(1.5, "X") == "1.5x")
    #expect(Rewards.formatRate(2.25, "PERCENT") == "2.25%")
  }

  @Test func shortLabel() {
    #expect(Rewards.shortLabel(card("c1", display: "Example Bank Gold", [])) == "Example Bank Gold")
    #expect(Rewards.shortLabel(card("c1", issuer: "AMEX", name: "Gold", [])) == "Amex Gold")
    #expect(Rewards.shortLabel(card("c1", issuer: "CHASE", [])) == "Chase")
    #expect(Rewards.shortLabel(card("c1", issuer: "SAMPLE", name: "One", [])) == "SAMPLE One")
  }

  @Test func ranksEachCategoryBestFirst() throws {
    let a = card("a", [("DINING", 4, "X"), ("OTHER", 1, "X")])
    let b = card("b", [("OTHER", 2, "PERCENT")])
    let c = card("c", [("DINING", 3, "X"), ("GROCERIES", 6, "PERCENT")])
    let rows = Rewards.bestByCategory([a, b, c])
    #expect(rows.map(\.category) == Rewards.bonusCategories)
    let dining = try #require(rows.first { $0.category == "DINING" })
    #expect(dining.label == "Dining")
    #expect(dining.ranked.map(\.card.id) == ["a", "c", "b"])
    #expect(dining.ranked[0].rate.isBonus)
    #expect(!dining.ranked[2].rate.isBonus)
    let groceries = try #require(rows.first { $0.category == "GROCERIES" })
    #expect(groceries.ranked.map(\.card.id) == ["c", "b", "a"])
  }

  @Test func tiesKeepServerOrder() throws {
    let a = card("a", [("OTHER", 3, "PERCENT")])
    let b = card("b", [("OTHER", 3, "X")])
    let gas = try #require(Rewards.bestByCategory([a, b]).first { $0.category == "GAS" })
    #expect(gas.ranked.map(\.card.id) == ["a", "b"])
  }

  @Test func hasRates() {
    #expect(!Rewards.hasRates([]))
    #expect(!Rewards.hasRates([card("a", [])]))
    #expect(Rewards.hasRates([card("a", []), card("b", [("OTHER", 1, "X")])]))
  }

  /// Expected pairs computed with the web's cardArtColors.
  @Test func cardColoursMatchTheWeb() {
    #expect(CardArtColors.hexes(issuer: "AMEX", seed: "AMEX-Gold-0001") == ("#5b7fa6", "#2b3f52"))
    #expect(CardArtColors.hexes(issuer: "CHASE", seed: "CHASE--0002") == ("#0f766e", "#0a3b37"))
    #expect(CardArtColors.hexes(issuer: "DISCOVER", seed: "DISCOVER-It-0003") == ("#c2703a", "#5f3417"))
    #expect(CardArtColors.hexes(issuer: "CITI", seed: "CITI-Sample-0004") == ("#57534e", "#1c1917"))
  }
}
```

- [ ] **Step 2: Run the tests. Expect them to fail** with a build error.

- [ ] **Step 3: Write the ranking port.**

`ios/BudgetPhone/Support/Rewards.swift`:
```swift
import Foundation

/// A card's rate for one category (effectiveRate in ../src/lib/rewards.ts).
struct EffectiveRate: Equatable, Sendable {
  let multiplier: Double
  let unit: String
  let isBonus: Bool

  var formatted: String { Rewards.formatRate(multiplier, unit) }
}

struct RankedCard: Equatable, Sendable {
  let card: UserCardDTO
  let rate: EffectiveRate
}

/// One row of Best card: a category and every card, best first.
struct CategoryRanking: Equatable, Identifiable, Sendable {
  let category: String
  let label: String
  let ranked: [RankedCard]
  var id: String { category }
}

/// Ports of ../src/lib/rewards.ts, ISSUER_LABELS (../src/lib/categories.ts)
/// and BestCards.tsx's ranking.
enum Rewards {
  /// BONUS_CATEGORIES: REWARD_CATEGORIES without OTHER, in order.
  static let bonusCategories = [
    "DINING", "GROCERIES", "TRAVEL", "GAS", "TRANSIT", "ENTERTAINMENT", "ONLINE_SHOPPING", "DRUGSTORES",
    "ROTATING",
  ]

  private static let labels: [String: String] = [
    "DINING": "Dining", "GROCERIES": "Groceries", "TRAVEL": "Travel", "GAS": "Gas",
    "TRANSIT": "Transit", "ENTERTAINMENT": "Streaming", "ONLINE_SHOPPING": "Online Shopping",
    "DRUGSTORES": "Drugstores", "ROTATING": "Rotating (quarterly)", "OTHER": "Everything else",
  ]

  private static let issuers = ["AMEX": "Amex", "CHASE": "Chase", "DISCOVER": "Discover"]

  /// REWARD_CATEGORY_LABELS.
  static func label(for category: String) -> String { labels[category] ?? category }

  /// ISSUER_LABELS, falling back to the raw value as the web does.
  static func issuerLabel(_ issuer: String) -> String { issuers[issuer] ?? issuer }

  /// effectiveRate: the card's bonus for the category, else its OTHER rate,
  /// else 1x.
  static func effectiveRate(_ rates: [RewardRateDTO], _ category: String) -> EffectiveRate {
    if let exact = rates.first(where: { $0.category == category }) {
      return EffectiveRate(multiplier: exact.multiplier, unit: exact.unit, isBonus: true)
    }
    if let base = rates.first(where: { $0.category == "OTHER" }) {
      return EffectiveRate(multiplier: base.multiplier, unit: base.unit, isBonus: false)
    }
    return EffectiveRate(multiplier: 1, unit: "X", isBonus: false)
  }

  /// formatRate: "4x" or "6%", the number printed as JavaScript prints it.
  static func formatRate(_ multiplier: Double, _ unit: String) -> String {
    let n = Formatters.plainNumber(multiplier)
    return unit == "PERCENT" ? "\(n)%" : "\(n)x"
  }

  /// BestCards' shortLabel.
  static func shortLabel(_ card: UserCardDTO) -> String {
    if let display = card.displayName { return display }
    let issuer = issuerLabel(card.issuer)
    if let name = card.name, !name.isEmpty { return "\(issuer) \(name)" }
    return issuer
  }

  /// BestCards renders only when some card has rates.
  static func hasRates(_ cards: [UserCardDTO]) -> Bool {
    cards.contains { !$0.rewardRates.isEmpty }
  }

  /// Every card ranked per bonus category, highest multiplier first. The sort
  /// is stable, so ties keep the server's card order, as the web's does.
  static func bestByCategory(_ cards: [UserCardDTO]) -> [CategoryRanking] {
    bonusCategories.map { category in
      let ranked = cards.enumerated()
        .map { (index: $0.offset, item: RankedCard(card: $0.element, rate: effectiveRate($0.element.rewardRates, category))) }
        .sorted { a, b in
          a.item.rate.multiplier != b.item.rate.multiplier
            ? a.item.rate.multiplier > b.item.rate.multiplier : a.index < b.index
        }
        .map(\.item)
      return CategoryRanking(category: category, label: label(for: category), ranked: ranked)
    }
  }
}
```

- [ ] **Step 4: Write the colours port.**

`ios/BudgetPhone/Support/CardArtColors.swift`:
```swift
import SwiftUI

/// cardArtColors (../src/lib/colors.ts): a card's placeholder gradient,
/// picked from its issuer's family by a hash of its own identity, so a card
/// always looks the same and reordering never repaints it.
enum CardArtColors {
  private static let palettes: [String: [(String, String)]] = [
    "AMEX": [("#4b6cb7", "#25355f"), ("#5b7fa6", "#2b3f52"), ("#8d99ae", "#434a55")],
    "CHASE": [("#1e4f8a", "#0f2747"), ("#2563eb", "#132f66"), ("#0f766e", "#0a3b37")],
    "DISCOVER": [("#e08a3c", "#7a451a"), ("#c2703a", "#5f3417")],
  ]
  private static let fallback = [("#3f3f46", "#18181b"), ("#475569", "#1e293b"), ("#57534e", "#1c1917")]

  static func hexes(issuer: String, seed: String) -> (from: String, to: String) {
    let family = palettes[issuer] ?? fallback
    var h: UInt32 = 0
    for unit in seed.utf16 { h = h &* 31 &+ UInt32(unit) }
    let pair = family[Int(h % UInt32(family.count))]
    return (pair.0, pair.1)
  }

  static func colors(issuer: String, seed: String) -> (from: Color, to: Color) {
    let pair = hexes(issuer: issuer, seed: seed)
    return (CategoryColors.color(hex: pair.from), CategoryColors.color(hex: pair.to))
  }
}
```

- [ ] **Step 5: Run the tests. Expect them to pass**, along with the full suite. If the labelled tuples don't compare in `#expect`, compare `.from` and `.to` separately.
- [ ] **Step 6: Scrub and commit** with the message "Port the Best card ranking and card colours to the iPhone app".

---

### Task 3: `BenefitsStore`

**Files:**
- Create: `ios/BudgetPhone/Benefits/BenefitsStore.swift`
- Test: `ios/BudgetPhoneTests/BenefitsStoreTests.swift`

**Interfaces (produces):** `@MainActor @Observable final class BenefitsStore` with:
- `init(client: @escaping @MainActor () -> APIClient?)`
- read-only `cards: [UserCardDTO]?`, `error: APIError?`, `isLoading: Bool`
- `var banner: String?`
- `func load() async`
- `func artURL(_ path: String) -> URL?` (resolves through the current client)

- [ ] **Step 1: Write the failing tests.**

`ios/BudgetPhoneTests/BenefitsStoreTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

final class BenefitsStub: @unchecked Sendable {
  var fail = false
  var cancel = false
  var last4 = "0001"
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct BenefitsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let stub = BenefitsStub()

    nonisolated static func answer(_ r: URLRequest, _ stub: BenefitsStub) throws -> (Int, Data) {
      if stub.cancel { throw URLError(.cancelled) }
      if stub.fail { return (500, Data(#"{"error":"Failed to load cards"}"#.utf8)) }
      return (200, Data(#"{"cards":[{"id":"c1","issuer":"AMEX","name":"Gold","last4":"\#(stub.last4)","displayName":null,"artUrl":null,"rewardRates":[]}]}"#.utf8))
    }

    func store(gates: [Gate] = []) -> BenefitsStore {
      let stub = self.stub
      let c = APIClient(baseURL: base, session: StubURLProtocol.session({ try Self.answer($0, stub) }, gates: gates))
      return BenefitsStore { c }
    }

    nonisolated static func any(_ r: URLRequest) -> Bool { true }

    @Test func loads() async {
      let s = store()
      await s.load()
      #expect(s.cards?.map(\.id) == ["c1"])
      #expect(s.error == nil && s.banner == nil && !s.isLoading)
    }

    @Test func withNothingLoadedAFailureIsFullScreen() async {
      stub.fail = true
      let s = store()
      await s.load()
      #expect(s.error == .server(status: 500, message: "Failed to load cards"))
      #expect(s.banner == nil)
    }

    @Test func noServerIsNotConfigured() async {
      let s = BenefitsStore { nil }
      await s.load()
      #expect(s.error == .notConfigured)
    }

    @Test func withDataAFailureIsABannerAndTheDataStays() async {
      let s = store()
      await s.load()
      stub.fail = true
      await s.load()
      #expect(s.banner == "Failed to load cards")
      #expect(s.cards != nil && s.error == nil)
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
      let gate = Gate(Self.any)
      let s = store(gates: [gate])
      stub.last4 = "1111"
      let first = Task { await s.load() }
      await gate.arrival()
      stub.last4 = "2222"
      await s.load()
      #expect(s.cards?.first?.last4 == "2222")
      stub.last4 = "1111"
      gate.open()
      await first.value
      #expect(s.cards?.first?.last4 == "2222")
    }

    @Test func artURLUsesTheCurrentServer() {
      #expect(store().artURL("/api/card-art/c1.png")?.absoluteString
        == "http://budget-mac.local:3000/api/card-art/c1.png")
      #expect(BenefitsStore { nil }.artURL("/api/card-art/c1.png") == nil)
    }
  }
}
```

- [ ] **Step 2: Run the tests. Expect them to fail.**

- [ ] **Step 3: Write the store.**

`ios/BudgetPhone/Benefits/BenefitsStore.swift`:
```swift
import Foundation
import Observation

/// The cards Benefits shows (useUserCards in
/// ../src/components/benefits/useUserCards.ts). Same failure rules as
/// AccountsStore: with nothing on screen an error is full-screen; with data
/// showing it becomes a banner and the data stays.
@MainActor
@Observable
final class BenefitsStore {
  private(set) var cards: [UserCardDTO]?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
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
      cards = nil
      error = .notConfigured
      return
    }
    if cards == nil { error = nil }
    isLoading = true
    defer { if generation == loadGeneration { isLoading = false } }
    do throws(APIError) {
      let result = try await client.userCards()
      guard generation == loadGeneration else { return }
      cards = result.cards
      error = nil
      banner = nil
    } catch {
      guard generation == loadGeneration else { return }
      if error == .cancelled { return }
      if cards == nil { self.error = error } else { banner = error.message }
    }
  }

  /// A card image's full URL on the current server.
  func artURL(_ path: String) -> URL? { client()?.cardArtURL(path) }
}
```

- [ ] **Step 4: Run the tests. Expect them to pass**, along with the full suite.
- [ ] **Step 5: Scrub and commit** with the message "Add the Benefits store to the iPhone app".

---

### Task 4: Views and the tab

**Files:**
- Create: `ios/BudgetPhone/Benefits/CardArtView.swift`, `BestCardsView.swift`, `BenefitsView.swift`
- Modify: `ios/BudgetPhone/App/RootView.swift`

**Interfaces:**
- Consumes: `BenefitsStore` (Task 3), `Rewards` and `CardArtColors` (Task 2), and the existing `ErrorView`, `Banner` and `ServerAddress`.
- Produces: `BenefitsView()`, `BestCardsView(store:)`, `CardArtView(card:artURL:width:)`.

Task 2 already covers the logic, so this task's checks are a clean build and a green suite. The controller looks at the screens on the simulator.

- [ ] **Step 1: Write the card face.**

`ios/BudgetPhone/Benefits/CardArtView.swift`:
```swift
import SwiftUI

/// A card's face (../src/components/benefits/CardArt.tsx). The uploaded image when
/// there is one; otherwise, and while it loads or if it fails, a gradient seeded
/// on the card's identity, which carries the issuer and last four when there's room.
struct CardArtView: View {
  let card: UserCardDTO
  let artURL: URL?
  let width: CGFloat

  /// ISO/IEC 7810 ID-1, the ratio every bank card is cut to.
  private static let ratio: CGFloat = 1.586

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: width * 0.06)
    Group {
      if let artURL {
        AsyncImage(url: artURL) { phase in
          if let image = phase.image {
            image.resizable().scaledToFill()
          } else {
            fallback
          }
        }
      } else {
        fallback
      }
    }
    .frame(width: width, height: width / Self.ratio)
    .clipShape(shape)
    .accessibilityElement()
    .accessibilityLabel(Rewards.shortLabel(card))
  }

  private var fallback: some View {
    let colors = CardArtColors.colors(
      issuer: card.issuer, seed: "\(card.issuer)-\(card.name ?? "")-\(card.last4)")
    return ZStack(alignment: .topLeading) {
      LinearGradient(colors: [colors.from, colors.to], startPoint: .topLeading, endPoint: .bottomTrailing)
      // A band of light across the face, so it reads as a card, not a swatch.
      LinearGradient(
        stops: [
          .init(color: .clear, location: 0.38), .init(color: .white.opacity(0.16), location: 0.5),
          .init(color: .clear, location: 0.62),
        ], startPoint: .topLeading, endPoint: .bottomTrailing)
      if width >= 60 {
        VStack(alignment: .leading) {
          Text(Rewards.issuerLabel(card.issuer))
            .font(.system(size: 9, weight: .semibold))
            .textCase(.uppercase)
            .foregroundStyle(.white.opacity(0.8))
          Spacer(minLength: 0)
          Text("··\(card.last4)")
            .font(.system(size: 10).monospacedDigit())
            .foregroundStyle(.white.opacity(0.7))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
      }
    }
  }
}
```

- [ ] **Step 2: Write the list.**

`ios/BudgetPhone/Benefits/BestCardsView.swift`:
```swift
import SwiftUI

/// Benefits → Best card (../src/components/benefits/BestCards.tsx): for each
/// bonus category, the card that earns most, and the next two.
struct BestCardsView: View {
  let store: BenefitsStore
  @AppStorage(ServerAddress.storageKey) private var server = ""

  var body: some View {
    if let cards = store.cards {
      list(cards)
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func list(_ cards: [UserCardDTO]) -> some View {
    let showTable = !cards.isEmpty && Rewards.hasRates(cards)
    return List {
      if showTable {
        Section {
          ForEach(Rewards.bestByCategory(cards)) { row in
            BestCardRow(row: row, artURL: { $0.artUrl.flatMap(store.artURL) })
          }
        } header: {
          Text("Best card by category")
        } footer: {
          Text("Ranked by raw rate · points and cashback aren't directly comparable.")
        }
        Section {
        } footer: {
          Text("Earning rates are pre-filled from a ~2025 snapshot and statement credits are whatever you enter. Always verify current terms with your issuer.")
        }
      }
    }
    .listStyle(.insetGrouped)
    .overlay {
      if !showTable {
        ContentUnavailableView(
          "No Cards", systemImage: "creditcard",
          description: Text("Add a card under Benefits → Cards in Budget on the web to see which one earns most where."))
          .allowsHitTesting(false)
      }
    }
    .refreshable { await store.load() }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
    }
  }
}

/// One category: the label, the winner's face, name and rate, and the
/// runners-up. The name and rate stack at accessibility sizes.
private struct BestCardRow: View {
  let row: CategoryRanking
  let artURL: (UserCardDTO) -> URL?
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(row.label).font(.caption).textCase(.uppercase).foregroundStyle(.secondary)
      if let best = row.ranked.first {
        HStack(alignment: .top, spacing: 12) {
          CardArtView(card: best.card, artURL: artURL(best.card), width: 80)
          VStack(alignment: .leading, spacing: 6) {
            winner(best)
            runners
          }
        }
      }
    }
    .padding(.vertical, 2)
  }

  @ViewBuilder private func winner(_ best: RankedCard) -> some View {
    let name = Text(Rewards.shortLabel(best.card)).fontWeight(.medium)
    let rate = (Text(best.rate.formatted)
      + Text(best.rate.isBonus ? "" : " base").foregroundStyle(.secondary))
      .monospacedDigit()
      .lineLimit(1)
      .fixedSize()
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) { name; rate }
    } else {
      HStack(alignment: .firstTextBaseline) {
        name.lineLimit(1)
        Spacer(minLength: 8)
        rate
      }
    }
  }

  private var runners: some View {
    let others = Array(row.ranked.dropFirst().prefix(2))
    return HStack(spacing: 12) {
      ForEach(others, id: \.card.id) { runner in
        HStack(spacing: 6) {
          CardArtView(card: runner.card, artURL: artURL(runner.card), width: 28)
          Text(runner.rate.formatted).monospacedDigit().lineLimit(1).fixedSize()
        }
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}
```
If `Text + Text` with `.foregroundStyle` doesn't compile on this SDK, build the rate as an `HStack(spacing: 0)` of two `Text`s instead, keeping `.fixedSize()`.

- [ ] **Step 3: Write the tab root.**

`ios/BudgetPhone/Benefits/BenefitsView.swift`:
```swift
import SwiftUI

/// The Benefits tab (../src/app/benefits). Best card for now; Cards and
/// Flights will join it as a segmented control, as Transactions does.
struct BenefitsView: View {
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var store = BenefitsStore {
    ServerAddress.saved().map { APIClient(baseURL: $0) }
  }

  var body: some View {
    NavigationStack {
      BestCardsView(store: store)
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Card Benefits")
    }
    .task { await store.load() }
    // Another device may have changed something while this one was away.
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await store.load() } }
    }
    .onChange(of: server) { Task { await store.load() } }
  }
}
```

- [ ] **Step 4: Add the tab.** In `ios/BudgetPhone/App/RootView.swift`, add this between the Analytics and Settings tabs:
```swift
          Tab("Benefits", systemImage: "creditcard") {
            BenefitsView()
          }
```

- [ ] **Step 5: Build and run the full suite.** It should pass with no new warnings.
- [ ] **Step 6: Scrub and commit** with the message "Add the Benefits tab with Best card to the iPhone app".

---

## After the tasks (controller only)

1. Check on the simulator, **GET only**: open the Benefits tab and look at it in light mode, dark mode and an accessibility size. Check both card faces (an uploaded image and the gradient).
2. Update `ios/README.md` (the screens list and spec links) and the `ios/CLAUDE.md` layout table (add `Benefits/`).
3. Run the whole-branch review, then finish the branch.
