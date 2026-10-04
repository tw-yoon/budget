# iPhone Settings → Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the web's Settings → Rules page to the phone with full parity: list with outcomes, add, on/off, change category, delete, Apply Now, Use Rule for These.

**Architecture:**
- Task 1: models, a fixture, and `RuleText` (labels and every user-facing string). Pure code, no network.
- Task 2: `APIClient+Rules.swift`.
- Task 3: `RulesStore`, which runs writes through a `RuleWrite` enum.
- Task 4: the SwiftUI screens (`RulesView`, `RuleRow`, `RuleDetailView`, `AddRuleSheet`) and the Settings row.

**Tech Stack:** Swift 6, SwiftUI, iOS 26, Swift Testing, `StubURLProtocol`.

**Spec:** `docs/superpowers/specs/2026-10-01-ios-settings-rules-design.md`

## Global Constraints

- Work in `ios/` on branch `ios-settings-rules`. Read `ios/CLAUDE.md` first. It is binding.
- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. Files under `BudgetPhone/` and `BudgetPhoneTests/` join their targets automatically, and `.json` under `BudgetPhoneTests/Fixtures/` becomes a test resource. **Never overwrite an existing fixture.** `rules.json` is new; if it already exists, stop and report.
- Test command, run from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Run `bash ../scripts/test-scrub.sh` before every commit.
- Every suite that uses `StubURLProtocol` nests as `extension StubbedNetworkTests { @Suite(.serialized) … }`.
- Inside `Task { }`, use `do throws(APIError) { … }`. Route writes through `RuleWrite`; never pass typed-throws closures around. Never pass an `@MainActor @Sendable` closure into `Binding(set:)`; have `set:` call a private method, as `SettingsView.choosePro` does.
- Wording comes verbatim from `../src/components/RulesDashboard.tsx`, except where the spec says otherwise (the button names are title case: "Apply Now", "Use Rule for These").
- Non-ASCII characters (→ “ ” · …): some edit tools turn them into ASCII. In Swift string literals, write them as `\u{…}` escapes. In comments either form is fine.
- **The live server holds real money data.** Implementers never run the app. Tests use `StubURLProtocol` only, and fixtures use invented values only.
- `../.gitignore` and `../../dashboardv1/` are unrelated; never stage them.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Models and wording

**Files:**
- Create: `ios/BudgetPhone/Models/RuleModels.swift`
- Create: `ios/BudgetPhone/Support/RuleText.swift`
- Create: `ios/BudgetPhoneTests/Fixtures/rules.json`
- Test: `ios/BudgetPhoneTests/RuleTextTests.swift`

**Interfaces (produces):**
- `RuleDTO: Identifiable { id, field, matchType, pattern, category: String; priority: Int; enabled: Bool; outcome: Outcome? }`, `RuleDTO.Outcome { applied, pending, handSet: Int }`
- `RulesResponse { rules: [RuleDTO] }`
- `NewRule: Encodable { field, matchType, pattern, category: String }`
- `ApplyResult { updated, kept: Int }`, `TakeOverResult { updated: Int }`
- `enum RuleText`: `fields`, `matchTypes`, `fieldLabel(_:)`, `matchLabel(_:)`, `plural(_:_:)`, `outcomeLine(_:)`, `applyNotice(_:)`, `takeOverTitle(count:pattern:category:)`, `takeOverMessage`, `takeOverNotice(pattern:updated:)`, `updateFailed`, `footer`, `categoryOptions(_:current:)`

- [ ] **Step 1: Fixture** (invented values only; confirm `BudgetPhoneTests/Fixtures/rules.json` does not exist first)

`ios/BudgetPhoneTests/Fixtures/rules.json`:
```json
{
  "rules": [
    { "id": "r1", "field": "EITHER", "matchType": "CONTAINS", "pattern": "Sample Mart",
      "category": "Sample Groceries", "priority": 0, "enabled": true,
      "createdAt": "2026-09-01T00:00:00.000Z",
      "outcome": { "applied": 6, "pending": 0, "handSet": 3 } },
    { "id": "r2", "field": "MERCHANT", "matchType": "STARTS_WITH", "pattern": "Example Transit",
      "category": "Transportation > Transit", "priority": 1, "enabled": false,
      "createdAt": "2026-09-02T00:00:00.000Z", "outcome": null }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`ios/BudgetPhoneTests/RuleTextTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

/// Settings → Rules: labels and wording (../src/components/RulesDashboard.tsx),
/// with no network.
struct RuleTextTests {
  func rules() throws -> [RuleDTO] {
    try JSONDecoder().decode(RulesResponse.self, from: TestData.fixture("rules")).rules
  }

  @Test func decodesTheFixture() throws {
    let r = try rules()
    #expect(r.map(\.id) == ["r1", "r2"])
    #expect(r[0].outcome == RuleDTO.Outcome(applied: 6, pending: 0, handSet: 3))
    #expect(r[1].outcome == nil, "a rule that is off has no outcome")
    #expect(r[1].enabled == false)
    #expect(r[1].category == "Transportation > Transit")
  }

  @Test func labelsMatchTheWeb() {
    #expect(RuleText.fields == ["MERCHANT", "NAME", "EITHER"])
    #expect(RuleText.matchTypes == ["CONTAINS", "EQUALS", "STARTS_WITH", "REGEX"])
    #expect(RuleText.fieldLabel("MERCHANT") == "Merchant")
    #expect(RuleText.fieldLabel("NAME") == "Description")
    #expect(RuleText.fieldLabel("EITHER") == "Merchant or description")
    #expect(RuleText.matchLabel("CONTAINS") == "contains")
    #expect(RuleText.matchLabel("EQUALS") == "equals")
    #expect(RuleText.matchLabel("STARTS_WITH") == "starts with")
    #expect(RuleText.matchLabel("REGEX") == "matches regex")
    #expect(RuleText.fieldLabel("OTHER") == "OTHER", "an unknown code shows as itself")
    #expect(RuleText.matchLabel("FUZZY") == "FUZZY")
  }

  @Test func plural() {
    #expect(RuleText.plural(1, "transaction") == "1 transaction")
    #expect(RuleText.plural(0, "transaction") == "0 transactions")
    #expect(RuleText.plural(2, "transaction") == "2 transactions")
  }

  @Test func outcomeLine() {
    #expect(RuleText.outcomeLine(.init(applied: 0, pending: 0, handSet: 0)) == "No matching transactions yet")
    #expect(RuleText.outcomeLine(.init(applied: 4, pending: 0, handSet: 0)) == "Matches 4: 4 set by this rule")
    #expect(RuleText.outcomeLine(.init(applied: 6, pending: 0, handSet: 3))
      == "Matches 9: 6 set by this rule \u{00B7} 3 set by hand (kept)")
    #expect(RuleText.outcomeLine(.init(applied: 1, pending: 2, handSet: 3))
      == "Matches 6: 1 set by this rule \u{00B7} 2 waiting for Apply Now \u{00B7} 3 set by hand (kept)")
  }

  @Test func applyNotice() {
    #expect(RuleText.applyNotice(ApplyResult(updated: 12, kept: 0)) == "Re-categorized 12 transactions.")
    #expect(RuleText.applyNotice(ApplyResult(updated: 1, kept: 1))
      == "Re-categorized 1 transaction. 1 matching transaction set by hand was kept.")
    #expect(RuleText.applyNotice(ApplyResult(updated: 0, kept: 2))
      == "Re-categorized 0 transactions. 2 matching transactions set by hand were kept.")
  }

  @Test func takeOverWording() {
    #expect(RuleText.takeOverTitle(count: 3, pattern: "Sample Mart", category: "Sample Groceries")
      == "Replace the category you set by hand on 3 transactions matching \"Sample Mart\" with \"Sample Groceries\"?")
    #expect(RuleText.takeOverMessage == "They'll follow this rule from then on.")
    #expect(RuleText.takeOverNotice(pattern: "Sample Mart", updated: 1) == "\"Sample Mart\" now sets 1 more transaction.")
    #expect(RuleText.takeOverNotice(pattern: "Sample Mart", updated: 3) == "\"Sample Mart\" now sets 3 more transactions.")
  }

  @Test func fixedStrings() {
    #expect(RuleText.updateFailed == "Failed to update the rule.")
    #expect(RuleText.footer
      == "Rules run top-to-bottom on each sync; the first match wins. They never overwrite a category you set by hand or one from Venmo, unless you tap Use Rule for These on a rule. Set a rule's category to Transfer to exclude matching transactions from spending. Tap Apply Now to run them over existing transactions.")
  }

  @Test func categoryOptionsKeepAMissingCurrentCategoryFirst() {
    #expect(RuleText.categoryOptions(["A", "B"], current: "B") == ["A", "B"])
    #expect(RuleText.categoryOptions(["A", "B"], current: "Gone") == ["Gone", "A", "B"])
    #expect(RuleText.categoryOptions(["A", "B"], current: "") == ["A", "B"])
  }
}
```

- [ ] **Step 3: Run the tests and confirm they fail to compile**

Expected: build failure, because `RuleDTO` and `RuleText` don't exist yet.

- [ ] **Step 4: Models**

`ios/BudgetPhone/Models/RuleModels.swift`:
```swift
import Foundation

// Mirrors of the rules routes (../src/app/api/rules/**).

/// GET /api/rules — one rule, in evaluation order, with how the rows it is
/// the first match for stand. `outcome` is null for a rule that is off.
struct RuleDTO: Decodable, Equatable, Sendable, Identifiable {
  struct Outcome: Decodable, Equatable, Sendable {
    let applied: Int
    let pending: Int
    let handSet: Int
  }
  let id: String
  let field: String
  let matchType: String
  let pattern: String
  let category: String
  let priority: Int
  let enabled: Bool
  let outcome: Outcome?
}

struct RulesResponse: Decodable, Equatable, Sendable {
  let rules: [RuleDTO]
}

/// POST /api/rules — the four fields RuleForm sends.
struct NewRule: Encodable, Equatable, Sendable {
  let field: String
  let matchType: String
  let pattern: String
  let category: String
}

/// POST /api/rules/apply.
struct ApplyResult: Decodable, Equatable, Sendable {
  let updated: Int
  let kept: Int
}

/// POST /api/rules/:id/take-over.
struct TakeOverResult: Decodable, Equatable, Sendable {
  let updated: Int
}
```

- [ ] **Step 5: `RuleText`**

`ios/BudgetPhone/Support/RuleText.swift`:
```swift
import Foundation

/// Settings → Rules' labels and wording, ported from
/// ../src/components/RulesDashboard.tsx and ../src/lib/rules.ts. The phone
/// names its buttons in title case ("Apply Now", "Use Rule for These"), so
/// the strings that mention them do too.
enum RuleText {
  /// RULE_FIELDS and RULE_MATCH_TYPES, in the web's order.
  static let fields = ["MERCHANT", "NAME", "EITHER"]
  static let matchTypes = ["CONTAINS", "EQUALS", "STARTS_WITH", "REGEX"]

  /// FIELD_LABELS; an unknown code shows as itself.
  static func fieldLabel(_ field: String) -> String {
    switch field {
    case "MERCHANT": "Merchant"
    case "NAME": "Description"
    case "EITHER": "Merchant or description"
    default: field
    }
  }

  /// MATCH_TYPE_LABELS; an unknown code shows as itself.
  static func matchLabel(_ matchType: String) -> String {
    switch matchType {
    case "CONTAINS": "contains"
    case "EQUALS": "equals"
    case "STARTS_WITH": "starts with"
    case "REGEX": "matches regex"
    default: matchType
    }
  }

  /// plural — "1 transaction", "2 transactions".
  static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

  /// The row's outcome line.
  static func outcomeLine(_ o: RuleDTO.Outcome) -> String {
    let matched = o.applied + o.pending + o.handSet
    if matched == 0 { return "No matching transactions yet" }
    var parts: [String] = []
    if o.applied > 0 { parts.append("\(o.applied) set by this rule") }
    if o.pending > 0 { parts.append("\(o.pending) waiting for Apply Now") }
    if o.handSet > 0 { parts.append("\(o.handSet) set by hand (kept)") }
    return "Matches \(matched): " + parts.joined(separator: " \u{00B7} ")
  }

  /// applyNow's message.
  static func applyNotice(_ r: ApplyResult) -> String {
    var s = "Re-categorized \(plural(r.updated, "transaction"))."
    if r.kept > 0 {
      s += " \(plural(r.kept, "matching transaction")) set by hand \(r.kept == 1 ? "was" : "were") kept."
    }
    return s
  }

  /// takeOver's confirm(), split at its blank line into title and message.
  static func takeOverTitle(count: Int, pattern: String, category: String) -> String {
    "Replace the category you set by hand on \(plural(count, "transaction")) matching \"\(pattern)\" with \"\(category)\"?"
  }

  static let takeOverMessage = "They'll follow this rule from then on."

  static func takeOverNotice(pattern: String, updated: Int) -> String {
    "\"\(pattern)\" now sets \(plural(updated, "more transaction"))."
  }

  /// Row.patch's failure notice.
  static let updateFailed = "Failed to update the rule."

  /// The web's amber explainer, as the list's footer.
  static let footer =
    "Rules run top-to-bottom on each sync; the first match wins. They never overwrite a category you set by hand or one from Venmo, unless you tap Use Rule for These on a rule. Set a rule's category to Transfer to exclude matching transactions from spending. Tap Apply Now to run them over existing transactions."

  /// TargetPicker's names: a category the rule already names stays
  /// selectable even if it has since left the list, so opening the editor
  /// never silently changes it.
  static func categoryOptions(_ names: [String], current: String) -> [String] {
    current.isEmpty || names.contains(current) ? names : [current] + names
  }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run the test command. Expected: `RuleTextTests` passes, and every earlier suite still passes.

- [ ] **Step 7: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Models/RuleModels.swift BudgetPhone/Support/RuleText.swift BudgetPhoneTests/Fixtures/rules.json BudgetPhoneTests/RuleTextTests.swift
git commit -m "Add the rule models and the web's rule wording to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Networking

**Files:**
- Create: `ios/BudgetPhone/Networking/APIClient+Rules.swift`
- Test: `ios/BudgetPhoneTests/RulesAPITests.swift`

**Interfaces:**
- Consumes (Task 1): `RulesResponse`, `NewRule`, `ApplyResult`, `TakeOverResult`.
- Produces: `rules() -> RulesResponse`, `createRule(_:)`, `setRuleCategory(id:_:)`, `setRuleEnabled(id:_:)`, `deleteRule(id:)`, `applyRules() -> ApplyResult`, `takeOverRule(id:) -> TakeOverResult`. All are `async throws(APIError)`.

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/RulesAPITests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Rules: each call's method, path and exact body.
  @Suite(.serialized)
  struct RulesAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    func only() throws -> URLRequest {
      #expect(StubURLProtocol.requests.count == 1)
      return try #require(StubURLProtocol.requests.first)
    }

    /// The body as an NSDictionary, so the comparison covers every key.
    func body(_ r: URLRequest) throws -> NSDictionary {
      let data = try #require(StubURLProtocol.body(of: r))
      return try #require(try JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    @Test func getDecodesTheFixture() async throws {
      let c = client { _ in (200, try TestData.fixture("rules")) }
      let r = try await c.rules()
      #expect(r.rules.count == 2)
      let req = try only()
      #expect(req.httpMethod == "GET")
      #expect(req.url?.path() == "/api/rules")
    }

    @Test func createSendsTheFourFields() async throws {
      let c = client { _ in (201, Data(#"{"rule":{"id":"r9"}}"#.utf8)) }
      try await c.createRule(NewRule(
        field: "EITHER", matchType: "CONTAINS", pattern: "Sample Mart", category: "Sample Groceries > Snacks"))
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/rules")
      #expect(try body(r) == [
        "field": "EITHER", "matchType": "CONTAINS", "pattern": "Sample Mart",
        "category": "Sample Groceries > Snacks",
      ] as NSDictionary)
    }

    @Test func setCategorySendsOnlyTheCategory() async throws {
      let c = client { _ in (200, Data(#"{"rule":{"id":"r1"}}"#.utf8)) }
      try await c.setRuleCategory(id: "r1", "Example Dining")
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/rules/r1")
      #expect(try body(r) == ["category": "Example Dining"] as NSDictionary)
    }

    @Test func setEnabledSendsOnlyEnabled() async throws {
      let c = client { _ in (200, Data(#"{"rule":{"id":"r1"}}"#.utf8)) }
      try await c.setRuleEnabled(id: "r1", false)
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/rules/r1")
      #expect(try body(r) == ["enabled": false] as NSDictionary)
    }

    @Test func deleteSendsNoBody() async throws {
      let c = client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      try await c.deleteRule(id: "r1")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/rules/r1")
      #expect(StubURLProtocol.body(of: r) == nil)
    }

    @Test func applyPostsAnEmptyObject() async throws {
      let c = client { _ in (200, Data(#"{"updated":12,"kept":3}"#.utf8)) }
      let result = try await c.applyRules()
      #expect(result == ApplyResult(updated: 12, kept: 3))
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/rules/apply")
      #expect(try body(r) == [:] as NSDictionary)
    }

    @Test func takeOverPostsAnEmptyObject() async throws {
      let c = client { _ in (200, Data(#"{"updated":3}"#.utf8)) }
      let result = try await c.takeOverRule(id: "r1")
      #expect(result == TakeOverResult(updated: 3))
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/rules/r1/take-over")
      #expect(try body(r) == [:] as NSDictionary)
    }

    @Test func takeOverOfARuleThatIsOffCarriesTheServerMessage() async throws {
      let c = client { _ in (404, Data(#"{"error":"That rule is off or gone"}"#.utf8)) }
      await #expect(throws: APIError.server(status: 404, message: "That rule is off or gone")) {
        try await c.takeOverRule(id: "r2")
      }
    }
  }
}
```

- [ ] **Step 2: Run the tests and confirm they fail to compile**

Expected: build failure, because the rule calls don't exist yet.

- [ ] **Step 3: The calls**

`ios/BudgetPhone/Networking/APIClient+Rules.swift`:
```swift
import Foundation

// Settings → Rules (../src/app/api/rules/**). Each body carries only its
// own fields, exactly as RulesDashboard.tsx sends them.

private struct CategoryPatch: Encodable { let category: String }
private struct EnabledPatch: Encodable { let enabled: Bool }

extension APIClient {
  /// GET /api/rules — all rules in evaluation order, with outcomes.
  func rules() async throws(APIError) -> RulesResponse {
    try decode(await send("GET", "api/rules", timeout: 15))
  }

  /// POST /api/rules — `{ field, matchType, pattern, category }`.
  func createRule(_ rule: NewRule) async throws(APIError) {
    _ = try await send("POST", "api/rules", body: encode(rule), timeout: 15)
  }

  /// PATCH /api/rules/:id — `{ category }` only.
  func setRuleCategory(id: String, _ category: String) async throws(APIError) {
    _ = try await send(
      "PATCH", "api/rules/\(id)", body: encode(CategoryPatch(category: category)), timeout: 15)
  }

  /// PATCH /api/rules/:id — `{ enabled }` only.
  func setRuleEnabled(id: String, _ enabled: Bool) async throws(APIError) {
    _ = try await send(
      "PATCH", "api/rules/\(id)", body: encode(EnabledPatch(enabled: enabled)), timeout: 15)
  }

  /// DELETE /api/rules/:id.
  func deleteRule(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/rules/\(id)", timeout: 15)
  }

  /// POST /api/rules/apply — re-runs every enabled rule over existing
  /// transactions, hence the long timeout.
  func applyRules() async throws(APIError) -> ApplyResult {
    try decode(await send("POST", "api/rules/apply", body: Data("{}".utf8), timeout: 60))
  }

  /// POST /api/rules/:id/take-over — the rule replaces the hand-set
  /// categories on the rows it is the first match for.
  func takeOverRule(id: String) async throws(APIError) -> TakeOverResult {
    try decode(
      await send("POST", "api/rules/\(id)/take-over", body: Data("{}".utf8), timeout: 30))
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run the test command. Expected: `RulesAPITests` passes, and every existing suite still passes.

- [ ] **Step 5: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Networking/APIClient+Rules.swift BudgetPhoneTests/RulesAPITests.swift
git commit -m "Add the rule API calls to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `RulesStore`

**Files:**
- Create: `ios/BudgetPhone/Settings/RulesStore.swift`
- Test: `ios/BudgetPhoneTests/RulesStoreTests.swift`

**Interfaces:**
- Consumes (Tasks 1–2): models, `RuleText`, the rule calls.
- Produces:
  - `enum RuleWrite: Equatable, Sendable { setCategory(id:category:), setEnabled(id:enabled:), delete(id:), takeOver(id:) }`
  - `@MainActor @Observable final class RulesStore`: `init(client: @escaping @MainActor () -> APIClient?)`
  - Read-only state (`private(set)`): `data: RulesResponse?`, `error: APIError?`, `isLoading`, `isSaving`, `isApplying`
  - Settable: `var banner: String?`, `var notice: String?`
  - Methods: `rule(id:) -> RuleDTO?`, `load() async`, `perform(_:) async`, `apply() async`, `add(_ rule: NewRule) async throws(APIError)`

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/RulesStoreTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Rules: the store's failure rules and its writes.
  @Suite(.serialized)
  @MainActor
  struct RulesStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func store(
      gates: [Gate] = [], _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> RulesStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler, gates: gates))
      return RulesStore { c }
    }

    nonisolated static func fixture() -> (Int, Data) { (200, (try? TestData.fixture("rules")) ?? Data()) }
    nonisolated static let fail: (Int, Data) = (500, Data(#"{"error":"Failed to load rules"}"#.utf8))
    nonisolated static func isGET(_ r: URLRequest) -> Bool { r.httpMethod == "GET" }
    nonisolated static func isWrite(_ r: URLRequest) -> Bool { r.httpMethod != "GET" }

    /// Answers GETs with the fixture and everything else with `write`.
    nonisolated static func answering(_ write: (Int, Data)) -> (URLRequest) -> (Int, Data) {
      { r in r.httpMethod == "GET" ? fixture() : write }
    }

    func methods() -> [String] { StubURLProtocol.requests.compactMap(\.httpMethod) }

    // MARK: Loading

    @Test func aFirstLoadFailureIsFullScreen() async {
      let s = store { _ in Self.fail }
      await s.load()
      #expect(s.data == nil)
      #expect(s.error == .server(status: 500, message: "Failed to load rules"))
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
      #expect(s.rule(id: "r1")?.pattern == "Sample Mart")
      #expect(s.error == nil)
      #expect(s.banner == "Failed to load rules")
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

    // MARK: Writes

    @Test func aFailedToggleShowsTheWebsMessageAndReloads() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to update rule"}"#.utf8))))
      await s.load()
      await s.perform(.setEnabled(id: "r1", enabled: false))
      #expect(s.banner == "Failed to update the rule.")
      #expect(methods() == ["GET", "PATCH", "GET"], "the reload puts the switch back")
      #expect(!s.isSaving)
    }

    @Test func aFailedCategorySaveShowsTheWebsMessage() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to update rule"}"#.utf8))))
      await s.load()
      await s.perform(.setCategory(id: "r1", category: "Example Dining"))
      #expect(s.banner == "Failed to update the rule.")
    }

    @Test func aFailedDeleteShowsTheServerMessage() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to delete rule"}"#.utf8))))
      await s.load()
      await s.perform(.delete(id: "r1"))
      #expect(s.banner == "Failed to delete rule")
    }

    @Test func takeOverShowsTheWebsNoticeAfterItsReload() async {
      let s = store(Self.answering((200, Data(#"{"updated":3}"#.utf8))))
      await s.load()
      await s.perform(.takeOver(id: "r1"))
      #expect(s.notice == "\"Sample Mart\" now sets 3 more transactions.")
      #expect(s.banner == nil)
      #expect(methods() == ["GET", "POST", "GET"])
    }

    @Test func aWriteClearsStaleMessagesBeforeItsRequest() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"rule":{"id":"r1"}}"#.utf8))))
      await s.load()
      s.banner = "stale"
      s.notice = "stale"
      let running = Task { await s.perform(.setEnabled(id: "r1", enabled: false)) }
      await write.arrival()
      #expect(s.banner == nil)
      #expect(s.notice == nil)
      #expect(s.isSaving)
      write.open()
      await running.value
      #expect(!s.isSaving)
    }

    @Test func aSecondWriteWhileOneIsInFlightSendsNothing() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      let first = Task { await s.perform(.delete(id: "r1")) }
      await write.arrival()
      await s.perform(.delete(id: "r2"))
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
      await s.perform(.delete(id: "r1"))
      #expect(s.banner == nil)
      #expect(s.notice == nil)
    }

    // MARK: Apply

    @Test func applyShowsTheWebsNoticeAfterItsReload() async {
      let s = store(Self.answering((200, Data(#"{"updated":12,"kept":1}"#.utf8))))
      await s.load()
      await s.apply()
      #expect(s.notice == "Re-categorized 12 transactions. 1 matching transaction set by hand was kept.")
      #expect(methods() == ["GET", "POST", "GET"])
      #expect(!s.isApplying)
    }

    @Test func aFailedApplyIsABannerWithNoReload() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to apply rules"}"#.utf8))))
      await s.load()
      await s.apply()
      #expect(s.banner == "Failed to apply rules")
      #expect(methods() == ["GET", "POST"])
    }

    @Test func aSecondApplyWhileOneIsInFlightSendsNothing() async {
      let apply = Gate(Self.isWrite)
      let s = store(gates: [apply], Self.answering((200, Data(#"{"updated":0,"kept":0}"#.utf8))))
      await s.load()
      let first = Task { await s.apply() }
      await apply.arrival()
      #expect(s.isApplying)
      await s.apply()
      apply.open()
      await first.value
      #expect(methods().filter { $0 == "POST" }.count == 1)
    }

    // MARK: Add

    @Test func addThrowsTheServerMessageToTheSheet() async {
      let s = store(Self.answering((400, Data(#"{"error":"Pattern is required"}"#.utf8))))
      await s.load()
      await #expect(throws: APIError.server(status: 400, message: "Pattern is required")) {
        try await s.add(NewRule(field: "EITHER", matchType: "CONTAINS", pattern: " ", category: "Sample Groceries"))
      }
    }

    @Test func addReloadsOnSuccess() async throws {
      let s = store(Self.answering((201, Data(#"{"rule":{"id":"r9"}}"#.utf8))))
      await s.load()
      try await s.add(NewRule(field: "EITHER", matchType: "CONTAINS", pattern: "Sample Mart", category: "Sample Groceries"))
      #expect(methods() == ["GET", "POST", "GET"])
    }
  }
}
```

- [ ] **Step 2: Run the tests and confirm they fail to compile**

Expected: build failure, because `RulesStore` and `RuleWrite` don't exist yet.

- [ ] **Step 3: The store**

`ios/BudgetPhone/Settings/RulesStore.swift`:
```swift
import Foundation
import Observation

/// One Settings → Rules write. An enum rather than a closure, so the store
/// keeps the typed error (see TransactionDetailView.Write).
enum RuleWrite: Equatable, Sendable {
  case setCategory(id: String, category: String)
  case setEnabled(id: String, enabled: Bool)
  case delete(id: String)
  case takeOver(id: String)
}

/// What Settings → Rules shows (../src/components/RulesDashboard.tsx),
/// shared by the list, the detail screen and the Add sheet. Same failure
/// rules as the other stores: with nothing on screen an error is
/// full-screen; with data showing it becomes a banner and the data stays.
@MainActor
@Observable
final class RulesStore {
  private(set) var data: RulesResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// One write at a time.
  private(set) var isSaving = false
  private(set) var isApplying = false
  var banner: String?
  var notice: String?

  private let client: @MainActor () -> APIClient?
  private var loadGeneration = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  func rule(id: String) -> RuleDTO? {
    data?.rules.first { $0.id == id }
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
      let result = try await client.rules()
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

  /// Runs one write. Stale messages clear before the request. Success or
  /// failure, the list then reloads — the web reloads after a failed toggle
  /// too, which puts the switch back — and this write's own notice or
  /// banner is applied after the reload so the reload doesn't wipe it.
  func perform(_ write: RuleWrite) async {
    guard !isSaving else { return }
    guard let client = client() else {
      banner = APIError.notConfigured.message
      return
    }
    isSaving = true
    defer { isSaving = false }
    banner = nil
    notice = nil
    var ownNotice: String?
    var ownBanner: String?
    do throws(APIError) {
      switch write {
      case .setCategory(let id, let category):
        try await client.setRuleCategory(id: id, category)
      case .setEnabled(let id, let enabled):
        try await client.setRuleEnabled(id: id, enabled)
      case .delete(let id):
        try await client.deleteRule(id: id)
      case .takeOver(let id):
        let pattern = rule(id: id)?.pattern ?? ""
        let r = try await client.takeOverRule(id: id)
        ownNotice = RuleText.takeOverNotice(pattern: pattern, updated: r.updated)
      }
    } catch {
      if error == .cancelled { return }
      switch write {
      case .setCategory, .setEnabled: ownBanner = RuleText.updateFailed
      case .delete, .takeOver: ownBanner = error.message
      }
    }
    await load()
    if let ownNotice { notice = ownNotice }
    if let ownBanner { banner = ownBanner }
  }

  /// Apply Now. One at a time; stale messages clear first. The web reloads
  /// only after a successful apply.
  func apply() async {
    guard !isApplying else { return }
    guard let client = client() else {
      banner = APIError.notConfigured.message
      return
    }
    isApplying = true
    defer { isApplying = false }
    banner = nil
    notice = nil
    do throws(APIError) {
      let r = try await client.applyRules()
      await load()
      notice = RuleText.applyNotice(r)
    } catch {
      if error != .cancelled { banner = error.message }
    }
  }

  /// The Add sheet's submit. Throws so the sheet keeps its fields and shows why.
  func add(_ rule: NewRule) async throws(APIError) {
    guard let client = client() else { throw .notConfigured }
    try await client.createRule(rule)
    await load()
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run the test command. Expected: `RulesStoreTests` passes, and so does everything else.

- [ ] **Step 5: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Settings/RulesStore.swift BudgetPhoneTests/RulesStoreTests.swift
git commit -m "Add the Rules store to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Screens and wiring

**Files:**
- Create: `ios/BudgetPhone/Settings/RulesView.swift` (`RulesView`, `RuleRow`, `RuleMessages`)
- Create: `ios/BudgetPhone/Settings/RuleDetailView.swift`
- Create: `ios/BudgetPhone/Settings/AddRuleSheet.swift`
- Modify: `ios/BudgetPhone/Settings/SettingsView.swift`
- Modify: `ios/README.md` (the Settings line and the spec list)

**Interfaces:**
- Consumes: `RulesStore`, `RuleWrite`, `RuleText`, `NewRule`, `CategoryPath.split/join` (`Support/LedgerRules.swift`), `CategoryFields(options:knownSubs:category:subcategory:)` (`Transactions/CategoryFields.swift`), `CategoryCatalog.names` and `.subcategories(of:)`, `Banner`, `Notice`, `ErrorView(error:server:retry:)`.
- Produces: `RulesView(store:catalog:)`, `RuleDetailView(id:store:catalog:)`, `AddRuleSheet(store:catalog:)`.

There are no unit tests for views. Verification is the build plus the full test run. Implementers do **not** run the app.

- [ ] **Step 1: The list**

`ios/BudgetPhone/Settings/RulesView.swift`:
```swift
import SwiftUI

/// Settings → Rules (../src/components/RulesDashboard.tsx) as an iPhone
/// list: Apply Now on top, then the rules in evaluation order with an on/off
/// switch each. + adds, swipe deletes, tap opens the rule. Pull down to
/// reload (GET only; Apply is its own button).
struct RulesView: View {
  let store: RulesStore
  let catalog: CategoryCatalog
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false
  @State private var selected: String?

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Rules")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Add Rule", systemImage: "plus") { adding = true }
            .disabled(store.data == nil)
        }
      }
      .sheet(isPresented: $adding) { AddRuleSheet(store: store, catalog: catalog) }
      .navigationDestination(item: $selected) { id in
        RuleDetailView(id: id, store: store, catalog: catalog)
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

  private func list(_ data: RulesResponse) -> some View {
    List {
      Section {
        Button { Task { await store.apply() } } label: {
          if store.isApplying {
            HStack(spacing: 8) {
              ProgressView()
              Text("Applying\u{2026}")
            }
          } else {
            Text("Apply Now")
          }
        }
        .disabled(store.isApplying)
      }
      Section {
        ForEach(data.rules) { rule in
          RuleRow(rule: rule, store: store) { selected = rule.id }
            .swipeActions {
              Button("Delete", systemImage: "trash", role: .destructive) {
                Task { await store.perform(.delete(id: rule.id)) }
              }
              .disabled(store.isSaving)
            }
        }
      } footer: {
        Text(RuleText.footer)
      }
    }
    .listStyle(.insetGrouped)
    .overlay {
      if data.rules.isEmpty {
        ContentUnavailableView(
          "No Rules", systemImage: "wand.and.stars", description: Text("Tap + to add one."))
          .allowsHitTesting(false)
      }
    }
    .refreshable {
      store.banner = nil
      await store.load()
    }
    .safeAreaInset(edge: .top) { RuleMessages(store: store) }
  }
}

/// One rule: what it matches, what it sets, how its matches stand, and an
/// on/off switch. The text opens the rule; the switch only toggles.
struct RuleRow: View {
  let rule: RuleDTO
  let store: RulesStore
  let open: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        Text(
          "\(Text(RuleText.fieldLabel(rule.field) + " " + RuleText.matchLabel(rule.matchType) + " ").foregroundStyle(.secondary))\(Text("\u{201C}\(rule.pattern)\u{201D}").monospaced())"
        )
        Text("\u{2192} \(rule.category)").font(.footnote)
        if let outcome = rule.outcome {
          Text(RuleText.outcomeLine(outcome)).font(.footnote).foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(.rect)
      .onTapGesture(perform: open)
      .accessibilityAddTraits(.isButton)
      Toggle("On", isOn: Binding(get: { rule.enabled }, set: { setEnabled($0) }))
        .labelsHidden()
        .disabled(store.isSaving)
    }
    .opacity(rule.enabled ? 1 : 0.5)
  }

  private func setEnabled(_ on: Bool) {
    Task { await store.perform(.setEnabled(id: rule.id, enabled: on)) }
  }
}

/// The store's notice and banner, over every Rules screen.
struct RuleMessages: View {
  let store: RulesStore

  var body: some View {
    VStack(spacing: 8) {
      if let notice = store.notice { Notice(text: notice) { store.notice = nil } }
      if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
    }
  }
}
```

- [ ] **Step 2: The detail screen**

`ios/BudgetPhone/Settings/RuleDetailView.swift`:
```swift
import SwiftUI

/// One rule: what it matches (read-only, as on the web), the category it
/// sets, on/off, how its matches stand with Use Rule for These, and delete.
/// Reads the rule from the store by id and pops once it is gone.
struct RuleDetailView: View {
  let id: String
  let store: RulesStore
  let catalog: CategoryCatalog
  @Environment(\.dismiss) private var dismiss
  @State private var category = ""
  @State private var subcategory = ""
  @State private var confirmingTakeOver = false

  private var rule: RuleDTO? { store.rule(id: id) }

  var body: some View {
    Group {
      if let rule { form(rule) } else { Color.clear }
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle("Rule")
    .navigationBarTitleDisplayMode(.inline)
    .onChange(of: rule == nil) { _, gone in if gone { dismiss() } }
  }

  private func form(_ r: RuleDTO) -> some View {
    Form {
      Section("Match") {
        LabeledContent("Field", value: RuleText.fieldLabel(r.field))
        LabeledContent("Match", value: RuleText.matchLabel(r.matchType))
        LabeledContent("Pattern") { Text(r.pattern).monospaced() }
      }
      Section("Category") {
        CategoryFields(
          options: RuleText.categoryOptions(catalog.names, current: CategoryPath.split(r.category).parent),
          knownSubs: { catalog.subcategories(of: $0) },
          category: $category, subcategory: $subcategory)
        if !category.isEmpty && CategoryPath.join(category, subcategory) != r.category {
          Button("Save") { save(r) }.disabled(store.isSaving)
        }
      }
      Section {
        Toggle("On", isOn: Binding(get: { r.enabled }, set: { setEnabled(r, $0) }))
          .disabled(store.isSaving)
      }
      if let o = r.outcome {
        Section("Matches") {
          LabeledContent("Set by this rule", value: "\(o.applied)")
          LabeledContent("Waiting for Apply Now", value: "\(o.pending)")
          LabeledContent("Set by hand (kept)", value: "\(o.handSet)")
          if o.handSet > 0 {
            Button("Use Rule for These") { confirmingTakeOver = true }.disabled(store.isSaving)
          }
        }
      }
      Section {
        Button("Delete Rule", role: .destructive) {
          Task { await store.perform(.delete(id: r.id)) }
        }
        .disabled(store.isSaving)
      }
    }
    .safeAreaInset(edge: .top) { RuleMessages(store: store) }
    .onAppear { seed(r) }
    .onChange(of: r.category) { _, _ in seed(r) }
    .alert(
      RuleText.takeOverTitle(count: r.outcome?.handSet ?? 0, pattern: r.pattern, category: r.category),
      isPresented: $confirmingTakeOver
    ) {
      Button("Use Rule") { Task { await store.perform(.takeOver(id: r.id)) } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(RuleText.takeOverMessage)
    }
  }

  /// The pickers start from the rule's own "Parent > Sub" (splitCategory).
  private func seed(_ r: RuleDTO) {
    let (parent, sub) = CategoryPath.split(r.category)
    category = parent
    subcategory = sub ?? ""
  }

  private func save(_ r: RuleDTO) {
    let next = CategoryPath.join(category, subcategory)
    guard next != r.category else { return }
    Task { await store.perform(.setCategory(id: r.id, category: next)) }
  }

  private func setEnabled(_ r: RuleDTO, _ on: Bool) {
    Task { await store.perform(.setEnabled(id: r.id, enabled: on)) }
  }
}
```

- [ ] **Step 3: The Add sheet**

`ios/BudgetPhone/Settings/AddRuleSheet.swift`:
```swift
import SwiftUI

/// RulesDashboard's RuleForm as a sheet. Add waits for a pattern and a
/// category; the server's own message shows in the form, which keeps its
/// fields.
struct AddRuleSheet: View {
  let store: RulesStore
  let catalog: CategoryCatalog
  @Environment(\.dismiss) private var dismiss
  @State private var field = "EITHER"
  @State private var matchType = "CONTAINS"
  @State private var pattern = ""
  @State private var category = ""
  @State private var subcategory = ""
  @State private var saving = false
  @State private var errorMessage: String?

  private var trimmedPattern: String { pattern.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Field", selection: $field) {
            ForEach(RuleText.fields, id: \.self) { Text(RuleText.fieldLabel($0)).tag($0) }
          }
          Picker("Match", selection: $matchType) {
            ForEach(RuleText.matchTypes, id: \.self) { Text(RuleText.matchLabel($0)).tag($0) }
          }
          TextField("Pattern (e.g. Starbucks)", text: $pattern)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        Section("Category") {
          CategoryFields(
            options: catalog.names,
            knownSubs: { catalog.subcategories(of: $0) },
            category: $category, subcategory: $subcategory)
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Add Rule")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save).disabled(trimmedPattern.isEmpty || category.isEmpty)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
    .onAppear(perform: seedCategory)
    .onChange(of: catalog.names) { seedCategory() }
  }

  /// The web defaults to the first category, even one that loads after the
  /// form opens.
  private func seedCategory() {
    if category.isEmpty { category = catalog.names.first ?? "" }
  }

  private func save() {
    let rule = NewRule(
      field: field, matchType: matchType, pattern: trimmedPattern,
      category: CategoryPath.join(category, subcategory))
    saving = true
    errorMessage = nil
    Task {
      do throws(APIError) {
        try await store.add(rule)
        dismiss()
      } catch {
        saving = false
        if error != .cancelled { errorMessage = error.message }
      }
    }
  }
}
```

- [ ] **Step 4: The Settings row**

In `ios/BudgetPhone/Settings/SettingsView.swift`:
- Add `@State private var rules = RulesStore(client: RootView.client)` next to the `categories` store.
- In the section that holds the Categories `NavigationLink`, add this directly under it:
```swift
          NavigationLink("Rules") { RulesView(store: rules, catalog: catalog) }
```

- [ ] **Step 5: README**

In `ios/README.md`, change the Settings bullet to also list Rules:
```markdown
- **Settings** — the Pro Mode switch, Categories (add, rename, merge, delete,
  Plaid labels, subcategories), Rules (add, on/off, category, delete, Apply
  Now, Use Rule for These), and the server address.
```
Add `../docs/superpowers/specs/2026-10-01-ios-settings-rules-design.md` to the README's list of iOS specs, after the Categories spec.

- [ ] **Step 6: Build and run every test**

Run the test command. Expected: it builds with no new warnings in the touched files, and every suite passes. If the `Text` interpolation in `RuleRow` doesn't compile, build the line from a `Text` with an `AttributedString` instead, keep the same look, and note the change in your report.

- [ ] **Step 7: Self-check the diff for live data**

Run `git diff main -- . ../docs | grep -n -i -E "bank|card|\\\$[0-9]"` and read the hits. Only invented values and the web's own placeholder ("Starbucks", already in `RulesDashboard.tsx`) are allowed.

- [ ] **Step 8: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Settings README.md
git commit -m "Add Settings → Rules to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
