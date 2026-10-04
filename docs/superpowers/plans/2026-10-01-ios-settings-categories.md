# iPhone Settings → Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the web's Settings → Categories editor to the phone with full parity: add, rename, merge, delete, Plaid-primary mapping, and subcategories (add, rename, merge, delete, reset).

**Architecture:**
- Task 1: Codable models, a fixture, and `CategoryRules` (the web's helpers and every user-facing string) plus `Formatters.humanizePfc`. Pure code with no network.
- Task 2: `APIClient.sendRaw` (so 409 bodies can be read), a fix for `+` in query values, and `APIClient+Categories.swift`.
- Task 3: `CategoriesStore`, a `@MainActor @Observable` store that runs every write through one `CategoryWrite` enum.
- Task 4: the SwiftUI screens (`CategoriesView`, `CategoryDetailView`), the Settings row, and moving `CategoryCatalog` up to `RootView` so a write reloads the ledger's pickers.

**Tech Stack:** Swift 6, SwiftUI, iOS 26, Swift Testing, `StubURLProtocol`.

**Spec:** `docs/superpowers/specs/2026-10-01-ios-settings-categories-design.md`

## Global Constraints

- Work in `ios/` on branch `ios-settings-categories`. Read `ios/CLAUDE.md` first. It is binding.
- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. Files under `BudgetPhone/` and `BudgetPhoneTests/` join their targets automatically, and `.json` under `BudgetPhoneTests/Fixtures/` becomes a test resource.
- Test command, run from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Run `bash ../scripts/test-scrub.sh` before every commit.
- Every suite that uses `StubURLProtocol` nests as `extension StubbedNetworkTests { @Suite(.serialized) … }`.
- Inside `Task { }`, use `do throws(APIError) { … }`. Don't pass typed-throws closures around; route writes through an enum (`CategoryWrite`). Never pass an `@MainActor @Sendable` closure into `Binding(set:)`.
- Ports name their web source in a comment. Wording is copied from the web verbatim (`../src/components/SettingsCategories.tsx`), except where the spec says otherwise.
- **The live server holds real money data.** Implementers never run the app against it. Tests use `StubURLProtocol` only, and fixtures use invented values only.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Models, rules and wording

**Files:**
- Create: `ios/BudgetPhone/Models/CategoryModels.swift`
- Create: `ios/BudgetPhone/Support/CategoryRules.swift`
- Modify: `ios/BudgetPhone/Support/Formatters.swift` (add `humanizePfc`)
- Create: `ios/BudgetPhoneTests/Fixtures/categories-admin.json`
- Test: `ios/BudgetPhoneTests/CategoryRulesTests.swift`

**Interfaces (produces):**
- `CategoriesAdminResponse { categories: [AdminCategory], primaries: [String], unmappedPrimaries: [UnmappedPrimary] }`
- `AdminCategory: Identifiable { id, name, plaidPrimaries, transactionCount, ruleCount, resolvedTransactionCount, subcategories: [AdminSubcategory], splitCount }`
- `AdminSubcategory: Identifiable { name, declared, transactionCount, ruleCount, plaidLabels: [PlaidLabel], plaidTransactionCount, renamed; id == name }`, `AdminSubcategory.PlaidLabel { code, name }`
- `UnmappedPrimary { pfcPrimary, transactionCount }`
- `RenameResult { merged, movedTransactions, movedSplits }`
- `MergePrompt { targetName, movingTransactions, movingRules, movingResolved: Int?, movingSplits: Int? }`
- `RenameOutcome { case done(RenameResult), needsMerge(MergePrompt) }`
- `SubcategoryDeleteResult { movedTransactions, movedSplits, resetPlaidLabels }`
- `Formatters.humanizePfc(_:) -> String`
- `enum CategoryRules`: `reservedNote`, `unmappedDetail`, `isReserved(_:)`, `isResetOnly(_:)`, `isDeletable(_:)`, `cleanName(_:) -> String?`, `usage(_ c: AdminCategory)`, `usage(_ s: AdminSubcategory)`, `plaidBadge(_:) -> String?`, `unmappedHeadline(_:)`, `deleteTitle(_:)`, `deleteMessage(_:) -> String?`, `deleteSubTitle(category:sub:)`, `deleteSubMessage(category:_:) -> String?`, `stillUsed(transactions:rules:mappings:splits:)`, `renameNotice(_:to:)`, `subDeleteNotice(_:category:) -> String?`, `mergeTitle(from:_:)`, `mergeMessage(from:_:)`, `subMergeMessage(category:_:)`

- [ ] **Step 1: Fixture** (invented values only)

`ios/BudgetPhoneTests/Fixtures/categories-admin.json`:
```json
{
  "categories": [
    {
      "id": "c1", "name": "Sample Groceries", "plaidPrimaries": ["FOOD_AND_DRINK"],
      "transactionCount": 4, "ruleCount": 1, "resolvedTransactionCount": 9, "splitCount": 1,
      "subcategories": [
        { "name": "Snacks", "declared": true, "transactionCount": 2, "ruleCount": 0,
          "plaidLabels": [], "plaidTransactionCount": 0, "renamed": false },
        { "name": "Corner Store", "declared": false, "transactionCount": 0, "ruleCount": 0,
          "plaidLabels": [{ "code": "FOOD_AND_DRINK_GROCERIES", "name": "Groceries" }],
          "plaidTransactionCount": 5, "renamed": true },
        { "name": "Coffee", "declared": false, "transactionCount": 0, "ruleCount": 0,
          "plaidLabels": [{ "code": "FOOD_AND_DRINK_COFFEE", "name": "Coffee" }],
          "plaidTransactionCount": 3, "renamed": false }
      ]
    },
    {
      "id": "c2", "name": "Transfer", "plaidPrimaries": ["TRANSFER_IN", "TRANSFER_OUT"],
      "transactionCount": 0, "ruleCount": 0, "resolvedTransactionCount": 0, "splitCount": 0,
      "subcategories": []
    }
  ],
  "primaries": ["BANK_FEES", "FOOD_AND_DRINK", "TRANSFER_IN", "TRANSFER_OUT"],
  "unmappedPrimaries": [{ "pfcPrimary": "BANK_FEES", "transactionCount": 2 }]
}
```

- [ ] **Step 2: Write the failing tests**

`ios/BudgetPhoneTests/CategoryRulesTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

/// Settings → Categories: the web's helpers and wording
/// (../src/components/SettingsCategories.tsx), with no network.
struct CategoryRulesTests {
  func data() throws -> CategoriesAdminResponse {
    try JSONDecoder().decode(CategoriesAdminResponse.self, from: TestData.fixture("categories-admin"))
  }
  func groceries() throws -> AdminCategory { try #require(data().categories.first { $0.id == "c1" }) }
  func transfer() throws -> AdminCategory { try #require(data().categories.first { $0.id == "c2" }) }
  func sub(_ name: String) throws -> AdminSubcategory {
    try #require(groceries().subcategories.first { $0.name == name })
  }

  @Test func decodesTheFixture() throws {
    let d = try data()
    #expect(d.categories.map(\.name) == ["Sample Groceries", "Transfer"])
    #expect(d.primaries.count == 4)
    #expect(d.unmappedPrimaries == [UnmappedPrimary(pfcPrimary: "BANK_FEES", transactionCount: 2)])
    #expect(try sub("Corner Store").plaidLabels.first?.name == "Groceries")
  }

  @Test func aMissingUnmappedListDecodesAsEmpty() throws {
    let json = #"{"categories":[],"primaries":[]}"#
    let d = try JSONDecoder().decode(CategoriesAdminResponse.self, from: Data(json.utf8))
    #expect(d.unmappedPrimaries.isEmpty)
  }

  @Test func humanizePfcMatchesTheWeb() {
    #expect(Formatters.humanizePfc("FOOD_AND_DRINK") == "Food and Drink")
    #expect(Formatters.humanizePfc("BANK_FEES") == "Bank Fees")
    #expect(Formatters.humanizePfc("ATM_FEES") == "ATM Fees")
    #expect(Formatters.humanizePfc("BNPL") == "BNPL")
    #expect(Formatters.humanizePfc("AND_MORE") == "And More", "only a non-first joiner stays lowercase")
  }

  @Test func onlyTransferIsReserved() throws {
    #expect(CategoryRules.isReserved(try transfer()))
    #expect(!CategoryRules.isReserved(try groceries()))
  }

  @Test func resetAndDeleteFollowTheWeb() throws {
    #expect(!CategoryRules.isResetOnly(try sub("Snacks")))
    #expect(CategoryRules.isResetOnly(try sub("Corner Store")))
    #expect(!CategoryRules.isResetOnly(try sub("Coffee")))
    #expect(CategoryRules.isDeletable(try sub("Snacks")))
    #expect(CategoryRules.isDeletable(try sub("Corner Store")))
    #expect(!CategoryRules.isDeletable(try sub("Coffee")), "Plaid's own label can be renamed, not removed")
  }

  @Test func cleanNameTrimsAndRejectsBlank() {
    #expect(CategoryRules.cleanName("  Sample Pets \n") == "Sample Pets")
    #expect(CategoryRules.cleanName("   ") == nil)
  }

  @Test func usageLinesCopyTheWebsUsedByCell() throws {
    #expect(CategoryRules.usage(try groceries()) == "9 tx (4 direct) · 1 rule · 1 split")
    #expect(CategoryRules.usage(try transfer()) == "0 tx · 0 rules · 0 splits")
    #expect(CategoryRules.usage(try sub("Snacks")) == "2 tx · 0 rules")
    #expect(CategoryRules.usage(try sub("Corner Store")) == "5 tx · 0 rules")
  }

  @Test func subUsageShowsDirectOnlyWhenBothPartsArePositive() {
    let s = AdminSubcategory(
      name: "Mixed", declared: true, transactionCount: 2, ruleCount: 1, plaidLabels: [],
      plaidTransactionCount: 3, renamed: false)
    #expect(CategoryRules.usage(s) == "5 tx (2 direct) · 1 rule")
  }

  @Test func plaidBadge() throws {
    #expect(CategoryRules.plaidBadge(try sub("Snacks")) == nil)
    #expect(CategoryRules.plaidBadge(try sub("Corner Store")) == "Plaid: Groceries")
    #expect(CategoryRules.plaidBadge(try sub("Coffee")) == "Plaid")
  }

  @Test func unmappedHeadline() {
    #expect(
      CategoryRules.unmappedHeadline([UnmappedPrimary(pfcPrimary: "BANK_FEES", transactionCount: 2)])
        == "1 Plaid label not mapped to a category: Bank Fees (2).")
    #expect(
      CategoryRules.unmappedHeadline([
        UnmappedPrimary(pfcPrimary: "BANK_FEES", transactionCount: 2),
        UnmappedPrimary(pfcPrimary: "FOOD_AND_DRINK", transactionCount: 7),
      ]) == "2 Plaid labels not mapped to a category: Bank Fees (2), Food and Drink (7).")
  }

  @Test func deleteConfirmations() throws {
    #expect(CategoryRules.deleteTitle("Sample Groceries") == #"Delete "Sample Groceries"?"#)
    #expect(CategoryRules.deleteMessage(try groceries()) == "Its 1 subcategory will go too.")
    #expect(CategoryRules.deleteMessage(try transfer()) == nil)
    #expect(CategoryRules.deleteSubTitle(category: "Sample Groceries", sub: "Snacks")
      == #"Delete "Sample Groceries > Snacks"?"#)
    #expect(CategoryRules.deleteSubMessage(category: "Sample Groceries", try sub("Snacks"))
      == #"2 transaction(s) and 0 rule(s) using it will fall back to "Sample Groceries"."#)
    let renamedInUse = AdminSubcategory(
      name: "Corner Store", declared: true, transactionCount: 1, ruleCount: 0,
      plaidLabels: [], plaidTransactionCount: 0, renamed: true)
    #expect(CategoryRules.deleteSubMessage(category: "Sample Groceries", renamedInUse)
      == #"1 transaction(s) and 0 rule(s) using it will fall back to "Sample Groceries"."#
        + "\n\n" + #"Plaid labels renamed to "Corner Store" go back to Plaid's name."#)
  }

  @Test func pluralSubcategoriesInTheDeleteMessage() throws {
    var c = try groceries()
    c = AdminCategory(
      id: c.id, name: c.name, plaidPrimaries: c.plaidPrimaries, transactionCount: 0, ruleCount: 0,
      resolvedTransactionCount: 0,
      subcategories: [try sub("Snacks"), try sub("Snacks")], splitCount: 0)
    #expect(CategoryRules.deleteMessage(c) == "Its 2 subcategories will go too.")
  }

  @Test func stillUsed() {
    #expect(CategoryRules.stillUsed(transactions: 3, rules: 1, mappings: 2, splits: 0)
      == "Still used by 3 transaction(s), 1 rule(s), 2 Plaid label(s) and 0 split(s) — rename this category onto another one to merge them first.")
  }

  @Test func renameNotices() {
    #expect(CategoryRules.renameNotice(RenameResult(merged: false, movedTransactions: 4, movedSplits: 0), to: "X")
      == "Renamed — 4 transaction(s) updated.")
    #expect(CategoryRules.renameNotice(RenameResult(merged: false, movedTransactions: 4, movedSplits: 2), to: "X")
      == "Renamed — 4 transaction(s) and 2 split(s) updated.")
    #expect(CategoryRules.renameNotice(RenameResult(merged: true, movedTransactions: 4, movedSplits: 0), to: "Example Dining")
      == #"Merged into "Example Dining" — 4 transaction(s) moved."#)
    #expect(CategoryRules.renameNotice(RenameResult(merged: true, movedTransactions: 4, movedSplits: 1), to: "Example Dining")
      == #"Merged into "Example Dining" — 4 transaction(s) and 1 split(s) moved."#)
  }

  @Test func subDeleteNotices() {
    #expect(CategoryRules.subDeleteNotice(
      SubcategoryDeleteResult(movedTransactions: 2, movedSplits: 0, resetPlaidLabels: 0), category: "Sample Groceries")
      == #"Deleted — 2 transaction(s) moved back to "Sample Groceries"."#)
    #expect(CategoryRules.subDeleteNotice(
      SubcategoryDeleteResult(movedTransactions: 0, movedSplits: 1, resetPlaidLabels: 0), category: "Sample Groceries")
      == #"Deleted — 0 transaction(s) and 1 split(s) moved back to "Sample Groceries"."#)
    #expect(CategoryRules.subDeleteNotice(
      SubcategoryDeleteResult(movedTransactions: 0, movedSplits: 0, resetPlaidLabels: 1), category: "Sample Groceries")
      == "Back to Plaid's name.")
    #expect(CategoryRules.subDeleteNotice(
      SubcategoryDeleteResult(movedTransactions: 0, movedSplits: 0, resetPlaidLabels: 0), category: "Sample Groceries")
      == nil)
  }

  @Test func mergeAlerts() {
    let category = MergePrompt(
      targetName: "Example Dining", movingTransactions: 2, movingRules: 1, movingResolved: 6, movingSplits: 0)
    #expect(CategoryRules.mergeTitle(from: "Sample Food", category) == #"Merge "Sample Food" into "Example Dining"?"#)
    #expect(CategoryRules.mergeMessage(from: "Sample Food", category)
      == #"6 transaction(s) will report as "Example Dining" instead, and "Sample Food" will be removed."#)
    let withSplits = MergePrompt(
      targetName: "Example Dining", movingTransactions: 0, movingRules: 0, movingResolved: 0, movingSplits: 3)
    #expect(CategoryRules.mergeMessage(from: "Sample Food", withSplits)
      == #"0 transaction(s) and 3 split(s) will report as "Example Dining" instead, and "Sample Food" will be removed."#)
    let sub = MergePrompt(
      targetName: "Snacks", movingTransactions: 2, movingRules: 1, movingResolved: nil, movingSplits: nil)
    #expect(CategoryRules.subMergeMessage(category: "Sample Groceries", sub)
      == #"2 transaction(s) and 1 rule(s) will move to "Sample Groceries > Snacks"."#)
  }
}
```

- [ ] **Step 3: Run the tests and confirm they fail to compile**

Run the test command from Global Constraints.
Expected: build failure, because `CategoriesAdminResponse`, `CategoryRules` and `humanizePfc` don't exist yet.

- [ ] **Step 4: Models**

`ios/BudgetPhone/Models/CategoryModels.swift`:
```swift
import Foundation

// Mirrors of GET /api/categories and the category write routes
// (../src/app/api/categories/**). The ledger's pickers keep their own slim
// `CategoriesResponse`; these carry what Settings → Categories edits.

struct CategoriesAdminResponse: Decodable, Equatable, Sendable {
  let categories: [AdminCategory]
  let primaries: [String]
  /// Real Plaid primaries in use that no category maps. The web reads it
  /// with `?? []`, so a server without it decodes as empty.
  let unmappedPrimaries: [UnmappedPrimary]

  init(categories: [AdminCategory], primaries: [String], unmappedPrimaries: [UnmappedPrimary]) {
    self.categories = categories
    self.primaries = primaries
    self.unmappedPrimaries = unmappedPrimaries
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    categories = try c.decode([AdminCategory].self, forKey: .categories)
    primaries = try c.decode([String].self, forKey: .primaries)
    unmappedPrimaries = try c.decodeIfPresent([UnmappedPrimary].self, forKey: .unmappedPrimaries) ?? []
  }

  private enum CodingKeys: String, CodingKey { case categories, primaries, unmappedPrimaries }
}

struct AdminCategory: Decodable, Equatable, Sendable, Identifiable {
  let id: String
  let name: String
  let plaidPrimaries: [String]
  let transactionCount: Int
  let ruleCount: Int
  let resolvedTransactionCount: Int
  let subcategories: [AdminSubcategory]
  let splitCount: Int
}

struct AdminSubcategory: Decodable, Equatable, Sendable, Identifiable {
  struct PlaidLabel: Decodable, Equatable, Sendable {
    let code: String
    let name: String
  }
  let name: String
  let declared: Bool
  let transactionCount: Int
  let ruleCount: Int
  let plaidLabels: [PlaidLabel]
  let plaidTransactionCount: Int
  let renamed: Bool

  /// Unique within its category; the routes address a sub by name too.
  var id: String { name }
}

struct UnmappedPrimary: Decodable, Equatable, Sendable {
  let pfcPrimary: String
  let transactionCount: Int
}

/// A rename's 2xx body (category or subcategory).
struct RenameResult: Decodable, Equatable, Sendable {
  let merged: Bool
  let movedTransactions: Int
  let movedSplits: Int
}

/// A rename's 409 `merge: true` body: the server found the new name taken
/// and asks before moving anything. Only the category route sends
/// `movingResolved` and `movingSplits`.
struct MergePrompt: Decodable, Equatable, Sendable {
  let targetName: String
  let movingTransactions: Int
  let movingRules: Int
  let movingResolved: Int?
  let movingSplits: Int?
}

enum RenameOutcome: Equatable, Sendable {
  case done(RenameResult)
  case needsMerge(MergePrompt)
}

struct SubcategoryDeleteResult: Decodable, Equatable, Sendable {
  let movedTransactions: Int
  let movedSplits: Int
  let resetPlaidLabels: Int
}
```

- [ ] **Step 5: `humanizePfc`**

Add inside `enum Formatters` in `ios/BudgetPhone/Support/Formatters.swift`, after `relative`:
```swift
  private static let lowercaseWords: Set<String> = ["and", "or", "of", "the", "to"]
  private static let acronyms: Set<String> = ["atm", "bnpl", "tv"]

  /// "FOOD_AND_DRINK" → "Food and Drink" — humanizePfc.
  static func humanizePfc(_ pfc: String) -> String {
    pfc.lowercased()
      .split(separator: "_", omittingEmptySubsequences: false)
      .enumerated()
      .map { i, part in
        let word = String(part)
        if acronyms.contains(word) { return word.uppercased() }
        if i > 0 && lowercaseWords.contains(word) { return word }
        return word.prefix(1).uppercased() + word.dropFirst()
      }
      .joined(separator: " ")
  }
```

- [ ] **Step 6: `CategoryRules`**

`ios/BudgetPhone/Support/CategoryRules.swift`:
```swift
import Foundation

/// Settings → Categories' rules and wording, ported from
/// ../src/components/SettingsCategories.tsx. Strings are the web's, word for
/// word; `confirm()` texts are split into an alert title and message at the
/// web's first blank line.
enum CategoryRules {
  static let reservedNote =
    "\"Transfer\" controls how transactions are excluded from spending — it cannot be renamed or deleted"

  static let unmappedDetail =
    "Those transactions report under Plaid’s own wording instead of one of your categories, and won’t follow if you rename a category later."

  /// The web's `isReserved`: Transfer can't be renamed or deleted.
  static func isReserved(_ c: AdminCategory) -> Bool { c.name == "Transfer" }

  /// isResetOnly — nothing but renamed Plaid labels, so deleting it only
  /// resets their names.
  static func isResetOnly(_ s: AdminSubcategory) -> Bool {
    s.renamed && !s.declared && s.transactionCount + s.ruleCount == 0
  }

  /// isDeletable — a Plaid label under Plaid's own name can be renamed,
  /// not removed.
  static func isDeletable(_ s: AdminSubcategory) -> Bool {
    s.declared || s.renamed || s.transactionCount + s.ruleCount > 0
  }

  /// The web's `.trim()`, with blank meaning "send nothing".
  static func cleanName(_ raw: String) -> String? {
    let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : t
  }

  private static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

  /// The "Used by" cell: "9 tx (4 direct) · 1 rule · 1 split".
  static func usage(_ c: AdminCategory) -> String {
    var tx = "\(c.resolvedTransactionCount) tx"
    if c.resolvedTransactionCount != c.transactionCount { tx += " (\(c.transactionCount) direct)" }
    return "\(tx) · \(plural(c.ruleCount, "rule")) · \(plural(c.splitCount, "split"))"
  }

  /// A subcategory row's "Used by" cell: "5 tx (2 direct) · 1 rule".
  static func usage(_ s: AdminSubcategory) -> String {
    var tx = "\(s.transactionCount + s.plaidTransactionCount) tx"
    if s.plaidTransactionCount > 0 && s.transactionCount > 0 { tx += " (\(s.transactionCount) direct)" }
    return "\(tx) · \(plural(s.ruleCount, "rule"))"
  }

  /// The sky-blue badge: nil, "Plaid", or "Plaid: Groceries, …" once renamed.
  static func plaidBadge(_ s: AdminSubcategory) -> String? {
    guard !s.plaidLabels.isEmpty else { return nil }
    return s.renamed ? "Plaid: " + s.plaidLabels.map(\.name).joined(separator: ", ") : "Plaid"
  }

  static func unmappedHeadline(_ u: [UnmappedPrimary]) -> String {
    let list = u.map { "\(Formatters.humanizePfc($0.pfcPrimary)) (\($0.transactionCount))" }
      .joined(separator: ", ")
    return "\(u.count) Plaid label\(u.count == 1 ? "" : "s") not mapped to a category: \(list)."
  }

  static func deleteTitle(_ name: String) -> String { "Delete \"\(name)\"?" }

  static func deleteMessage(_ c: AdminCategory) -> String? {
    let declared = c.subcategories.filter(\.declared).count
    guard declared > 0 else { return nil }
    return "Its \(declared) subcategor\(declared == 1 ? "y" : "ies") will go too."
  }

  static func deleteSubTitle(category: String, sub: String) -> String {
    "Delete \"\(category) > \(sub)\"?"
  }

  static func deleteSubMessage(category: String, _ s: AdminSubcategory) -> String? {
    var parts: [String] = []
    if s.transactionCount + s.ruleCount > 0 {
      parts.append(
        "\(s.transactionCount) transaction(s) and \(s.ruleCount) rule(s) using it will fall back to \"\(category)\".")
    }
    if s.renamed { parts.append("Plaid labels renamed to \"\(s.name)\" go back to Plaid's name.") }
    return parts.isEmpty ? nil : parts.joined(separator: "\n\n")
  }

  /// A delete refused because the category is in use.
  static func stillUsed(transactions: Int, rules: Int, mappings: Int, splits: Int) -> String {
    "Still used by \(transactions) transaction(s), \(rules) rule(s), \(mappings) Plaid label(s) and \(splits) split(s) — rename this category onto another one to merge them first."
  }

  private static func splitsNote(_ n: Int?) -> String {
    guard let n, n > 0 else { return "" }
    return " and \(n) split(s)"
  }

  /// A rename's notice, for a category or a subcategory.
  static func renameNotice(_ r: RenameResult, to name: String) -> String {
    r.merged
      ? "Merged into \"\(name)\" — \(r.movedTransactions) transaction(s)\(splitsNote(r.movedSplits)) moved."
      : "Renamed — \(r.movedTransactions) transaction(s)\(splitsNote(r.movedSplits)) updated."
  }

  static func subDeleteNotice(_ r: SubcategoryDeleteResult, category: String) -> String? {
    if r.movedTransactions > 0 || r.movedSplits > 0 {
      return "Deleted — \(r.movedTransactions) transaction(s)\(splitsNote(r.movedSplits)) moved back to \"\(category)\"."
    }
    return r.resetPlaidLabels > 0 ? "Back to Plaid's name." : nil
  }

  static func mergeTitle(from name: String, _ p: MergePrompt) -> String {
    "Merge \"\(name)\" into \"\(p.targetName)\"?"
  }

  /// A category merge. `movingResolved` already includes the direct count.
  static func mergeMessage(from name: String, _ p: MergePrompt) -> String {
    "\(p.movingResolved ?? p.movingTransactions) transaction(s)\(splitsNote(p.movingSplits)) will report as \"\(p.targetName)\" instead, and \"\(name)\" will be removed."
  }

  static func subMergeMessage(category: String, _ p: MergePrompt) -> String {
    "\(p.movingTransactions) transaction(s) and \(p.movingRules) rule(s) will move to \"\(category) > \(p.targetName)\"."
  }
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run the test command. Expected: all `CategoryRulesTests` pass, and every earlier suite still passes.

- [ ] **Step 8: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Models/CategoryModels.swift BudgetPhone/Support/CategoryRules.swift BudgetPhone/Support/Formatters.swift BudgetPhoneTests/Fixtures/categories-admin.json BudgetPhoneTests/CategoryRulesTests.swift
git commit -m "Add the category models and the web's category wording to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Networking

**Files:**
- Modify: `ios/BudgetPhone/Networking/APIClient.swift` (split out `sendRaw`, add `serverError`, encode `+` in queries)
- Create: `ios/BudgetPhone/Networking/APIClient+Categories.swift`
- Test: `ios/BudgetPhoneTests/CategoriesAPITests.swift`

**Interfaces:**
- Consumes (Task 1): the models, `CategoryRules.stillUsed`.
- Produces:
  - `APIClient.sendRaw(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, timeout: TimeInterval) async throws(APIError) -> (status: Int, data: Data)`
  - `static APIClient.serverError(status: Int, data: Data) -> APIError`
  - `categoriesAdmin() -> CategoriesAdminResponse`, `createCategory(name:)`, `renameCategory(id:name:allowMerge:) -> RenameOutcome`, `setPlaidPrimaries(id:_:)`, `deleteCategory(id:)`, `createSubcategory(categoryId:name:)`, `renameSubcategory(categoryId:from:to:allowMerge:) -> RenameOutcome`, `deleteSubcategory(categoryId:name:) -> SubcategoryDeleteResult`. All `async throws(APIError)`.

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/CategoriesAPITests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Categories: each call's method, path and exact body, and
  /// how the 409 bodies are read.
  @Suite(.serialized)
  struct CategoriesAPITests {
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

    static let renamed = #"{"ok":true,"merged":false,"movedTransactions":3,"movedRules":0,"movedResolved":3,"movedSplits":0}"#

    @Test func getDecodesTheFixture() async throws {
      let c = client { _ in (200, try TestData.fixture("categories-admin")) }
      let d = try await c.categoriesAdmin()
      #expect(d.categories.count == 2)
      let r = try only()
      #expect(r.httpMethod == "GET")
      #expect(r.url?.path() == "/api/categories")
    }

    @Test func createSendsOnlyTheName() async throws {
      let c = client { _ in (200, Data(#"{"category":{"id":"c9","name":"Sample Pets"}}"#.utf8)) }
      try await c.createCategory(name: "Sample Pets")
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/categories")
      #expect(try body(r) == ["name": "Sample Pets"] as NSDictionary)
    }

    @Test func renameSendsNameAndAllowMerge() async throws {
      let c = client { _ in (200, Data(Self.renamed.utf8)) }
      let outcome = try await c.renameCategory(id: "c1", name: "Sample Food", allowMerge: false)
      #expect(outcome == .done(RenameResult(merged: false, movedTransactions: 3, movedSplits: 0)))
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/categories/c1")
      #expect(try body(r) == ["name": "Sample Food", "allowMerge": false] as NSDictionary)
    }

    @Test func aMerge409BecomesAPrompt() async throws {
      let json = #"{"error":"Merge not confirmed","merge":true,"targetName":"Example Dining","movingTransactions":2,"movingRules":1,"movingResolved":6,"movingSplits":0}"#
      let c = client { _ in (409, Data(json.utf8)) }
      let outcome = try await c.renameCategory(id: "c1", name: "Example Dining", allowMerge: false)
      #expect(outcome == .needsMerge(MergePrompt(
        targetName: "Example Dining", movingTransactions: 2, movingRules: 1, movingResolved: 6, movingSplits: 0)))
    }

    @Test func aPlain409StaysAServerError() async throws {
      let json = #"{"error":"\"Transfer\" cannot be renamed"}"#
      let c = client { _ in (409, Data(json.utf8)) }
      await #expect(throws: APIError.server(status: 409, message: "\"Transfer\" cannot be renamed")) {
        try await c.renameCategory(id: "c2", name: "Moves", allowMerge: false)
      }
    }

    @Test func setPlaidPrimariesSendsOnlyTheList() async throws {
      let c = client { _ in (200, Data(Self.renamed.utf8)) }
      try await c.setPlaidPrimaries(id: "c1", ["FOOD_AND_DRINK", "BANK_FEES"])
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/categories/c1")
      #expect(try body(r) == ["plaidPrimaries": ["FOOD_AND_DRINK", "BANK_FEES"]] as NSDictionary)
    }

    @Test func deleteSendsNoBody() async throws {
      let c = client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      try await c.deleteCategory(id: "c1")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/categories/c1")
      #expect(r.url?.query() == nil, "the web never sends reassignTo")
      #expect(StubURLProtocol.body(of: r) == nil)
    }

    @Test func aDeleteRefusedInUseCarriesTheWebsMessage() async throws {
      let json = #"{"error":"Still in use","transactionCount":3,"ruleCount":1,"mappingCount":2,"splitCount":0}"#
      let c = client { _ in (409, Data(json.utf8)) }
      await #expect(throws: APIError.server(
        status: 409,
        message: CategoryRules.stillUsed(transactions: 3, rules: 1, mappings: 2, splits: 0))) {
        try await c.deleteCategory(id: "c1")
      }
    }

    @Test func createSubcategorySendsOnlyTheName() async throws {
      let c = client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      try await c.createSubcategory(categoryId: "c1", name: "Snacks")
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/categories/c1/subcategories")
      #expect(try body(r) == ["name": "Snacks"] as NSDictionary)
    }

    @Test func renameSubcategorySendsFromToAndAllowMerge() async throws {
      let c = client { _ in (200, Data(#"{"ok":true,"merged":true,"movedTransactions":2,"movedRules":0,"movedSplits":1}"#.utf8)) }
      let outcome = try await c.renameSubcategory(categoryId: "c1", from: "Snacks", to: "Treats", allowMerge: true)
      #expect(outcome == .done(RenameResult(merged: true, movedTransactions: 2, movedSplits: 1)))
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/categories/c1/subcategories")
      #expect(try body(r) == ["from": "Snacks", "to": "Treats", "allowMerge": true] as NSDictionary)
    }

    @Test func aSubcategoryMerge409BecomesAPrompt() async throws {
      let json = #"{"error":"Merge not confirmed","merge":true,"targetName":"Treats","movingTransactions":2,"movingRules":1}"#
      let c = client { _ in (409, Data(json.utf8)) }
      let outcome = try await c.renameSubcategory(categoryId: "c1", from: "Snacks", to: "Treats", allowMerge: false)
      #expect(outcome == .needsMerge(MergePrompt(
        targetName: "Treats", movingTransactions: 2, movingRules: 1, movingResolved: nil, movingSplits: nil)))
    }

    @Test func deleteSubcategoryPutsTheNameInTheQueryEncodingPlus() async throws {
      let c = client { _ in (200, Data(#"{"ok":true,"movedTransactions":0,"movedRules":0,"movedSplits":0,"resetPlaidLabels":1}"#.utf8)) }
      let result = try await c.deleteSubcategory(categoryId: "c1", name: "Snacks + Treats & More")
      #expect(result == SubcategoryDeleteResult(movedTransactions: 0, movedSplits: 0, resetPlaidLabels: 1))
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/categories/c1/subcategories")
      // The server reads the query with URLSearchParams, which turns a bare "+" into a space.
      #expect(r.url?.query(percentEncoded: true) == "name=Snacks%20%2B%20Treats%20%26%20More")
      #expect(TestData.query(of: r, "name") == "Snacks + Treats & More")
    }
  }
}
```

- [ ] **Step 2: Run the tests and confirm they fail to compile**

Expected: build failure, because the `APIClient` category calls don't exist yet.

- [ ] **Step 3: Split `send` into `sendRaw`, and encode `+`**

In `ios/BudgetPhone/Networking/APIClient.swift`, replace the whole `func send(...)` with the code below. Make `ErrorBody` non-private only if the compiler needs it; `serverError` is a static on the same type, so `private` still works.
```swift
  /// The request itself: any HTTP status comes back with its body, for the
  /// few routes whose non-2xx bodies carry more than `{ error }` (a
  /// category merge prompt, a delete refused in use).
  func sendRaw(
    _ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
    timeout: TimeInterval
  ) async throws(APIError) -> (status: Int, data: Data) {
    var url = baseURL.appending(path: path)
    if !query.isEmpty {
      url.append(queryItems: query)
      // URLComponents leaves "+" bare, and the server's URLSearchParams reads
      // a bare "+" as a space ("Snacks + Treats" would arrive as "Snacks   Treats").
      if var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
        components.percentEncodedQuery = components.percentEncodedQuery?
          .replacingOccurrences(of: "+", with: "%2B")
        url = components.url ?? url
      }
    }
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
    return (http.statusCode, data)
  }

  func send(
    _ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
    timeout: TimeInterval
  ) async throws(APIError) -> Data {
    let (status, data) = try await sendRaw(method, path, query: query, body: body, timeout: timeout)
    guard (200..<300).contains(status) else { throw Self.serverError(status: status, data: data) }
    return data
  }

  /// A non-2xx answer as `.server`, with the route's `{ error }` when it sent one.
  static func serverError(status: Int, data: Data) -> APIError {
    let message =
      (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
      ?? HTTPURLResponse.localizedString(forStatusCode: status)
    return .server(status: status, message: message)
  }
```

- [ ] **Step 4: The category calls**

`ios/BudgetPhone/Networking/APIClient+Categories.swift`:
```swift
import Foundation

// Settings → Categories (../src/app/api/categories/**). Each body carries
// only its own fields, exactly as SettingsCategories.tsx sends them.

private struct NameBody: Encodable { let name: String }
private struct RenameBody: Encodable {
  let name: String
  let allowMerge: Bool
}
private struct PrimariesBody: Encodable { let plaidPrimaries: [String] }
private struct SubRenameBody: Encodable {
  let from: String
  let to: String
  let allowMerge: Bool
}
private struct MergeFlag: Decodable { let merge: Bool? }
private struct InUseBody: Decodable {
  let transactionCount: Int
  let ruleCount: Int
  let mappingCount: Int
  let splitCount: Int
}

extension APIClient {
  /// GET /api/categories — the list with counts, Plaid's primaries, and
  /// the primaries no category maps.
  func categoriesAdmin() async throws(APIError) -> CategoriesAdminResponse {
    try decode(await send("GET", "api/categories", timeout: 15))
  }

  /// POST /api/categories — `{ name }`.
  func createCategory(name: String) async throws(APIError) {
    _ = try await send("POST", "api/categories", body: encode(NameBody(name: name)), timeout: 15)
  }

  /// PATCH /api/categories/:id — `{ name, allowMerge }`. Renaming onto an
  /// existing name is answered with a merge prompt until `allowMerge` is true.
  func renameCategory(id: String, name: String, allowMerge: Bool) async throws(APIError) -> RenameOutcome {
    try await rename(
      "api/categories/\(id)", body: encode(RenameBody(name: name, allowMerge: allowMerge)))
  }

  /// PATCH /api/categories/:id — `{ plaidPrimaries }`, the full new list.
  func setPlaidPrimaries(id: String, _ primaries: [String]) async throws(APIError) {
    _ = try await send(
      "PATCH", "api/categories/\(id)", body: encode(PrimariesBody(plaidPrimaries: primaries)),
      timeout: 15)
  }

  /// DELETE /api/categories/:id — refused while in use, with the counts
  /// that explain why.
  func deleteCategory(id: String) async throws(APIError) {
    let (status, data) = try await sendRaw("DELETE", "api/categories/\(id)", timeout: 30)
    if (200..<300).contains(status) { return }
    if status == 409, let u = try? JSONDecoder().decode(InUseBody.self, from: data) {
      throw .server(
        status: 409,
        message: CategoryRules.stillUsed(
          transactions: u.transactionCount, rules: u.ruleCount, mappings: u.mappingCount,
          splits: u.splitCount))
    }
    throw Self.serverError(status: status, data: data)
  }

  /// POST /api/categories/:id/subcategories — `{ name }`.
  func createSubcategory(categoryId: String, name: String) async throws(APIError) {
    _ = try await send(
      "POST", "api/categories/\(categoryId)/subcategories", body: encode(NameBody(name: name)),
      timeout: 15)
  }

  /// PATCH /api/categories/:id/subcategories — `{ from, to, allowMerge }`,
  /// the same merge handshake as a category rename.
  func renameSubcategory(
    categoryId: String, from: String, to: String, allowMerge: Bool
  ) async throws(APIError) -> RenameOutcome {
    try await rename(
      "api/categories/\(categoryId)/subcategories",
      body: encode(SubRenameBody(from: from, to: to, allowMerge: allowMerge)))
  }

  /// DELETE /api/categories/:id/subcategories?name=… — what used it falls
  /// back to the bare category; renamed Plaid labels get Plaid's name back.
  func deleteSubcategory(categoryId: String, name: String) async throws(APIError) -> SubcategoryDeleteResult {
    try decode(
      await send(
        "DELETE", "api/categories/\(categoryId)/subcategories",
        query: [URLQueryItem(name: "name", value: name)], timeout: 30))
  }

  private func rename(_ path: String, body: Data) async throws(APIError) -> RenameOutcome {
    let (status, data) = try await sendRaw("PATCH", path, body: body, timeout: 30)
    if (200..<300).contains(status) { return .done(try decode(data)) }
    if status == 409, (try? JSONDecoder().decode(MergeFlag.self, from: data))?.merge == true {
      return .needsMerge(try decode(data))
    }
    throw Self.serverError(status: status, data: data)
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run the test command. Expected: `CategoriesAPITests` passes, and every existing suite, including `NetworkTests` and its `send` error-message tests, still passes.

- [ ] **Step 6: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Networking/APIClient.swift BudgetPhone/Networking/APIClient+Categories.swift BudgetPhoneTests/CategoriesAPITests.swift
git commit -m "Add the category API calls to the iPhone app

sendRaw returns non-2xx bodies so a rename's merge prompt and a delete's
in-use counts can be read. Query values now encode \"+\", which the
server's URLSearchParams would otherwise read as a space.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `CategoriesStore`

**Files:**
- Create: `ios/BudgetPhone/Settings/CategoriesStore.swift`
- Test: `ios/BudgetPhoneTests/CategoriesStoreTests.swift`

**Interfaces:**
- Consumes (Tasks 1–2): models, `CategoryRules`, every `APIClient` category call.
- Produces:
  - `enum CategoryWrite: Equatable, Sendable { create(name:), rename(id:name:allowMerge:), setPrimaries(id:primaries:), delete(id:), createSub(categoryId:name:), renameSub(categoryId:from:to:allowMerge:), deleteSub(categoryId:name:) }`
  - `@MainActor @Observable final class CategoriesStore`: `init(client: @escaping @MainActor () -> APIClient?)`; `data: CategoriesAdminResponse?`, `error: APIError?`, `isLoading`, `isSaving`, `writeCount: Int` (all `private(set)`); `var banner: String?`, `var notice: String?`; `func category(id:) -> AdminCategory?`; `func load() async`; `@discardableResult func perform(_ write: CategoryWrite) async -> MergePrompt?`

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/CategoriesStoreTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Categories: the store's failure rules and its writes.
  @Suite(.serialized)
  @MainActor
  struct CategoriesStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func store(
      gates: [Gate] = [], _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> CategoriesStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler, gates: gates))
      return CategoriesStore { c }
    }

    nonisolated static func fixture() -> (Int, Data) { (200, (try? TestData.fixture("categories-admin")) ?? Data()) }
    nonisolated static let fail: (Int, Data) = (500, Data(#"{"error":"Failed to load categories"}"#.utf8))
    nonisolated static func isGET(_ r: URLRequest) -> Bool { r.httpMethod == "GET" }
    nonisolated static func isWrite(_ r: URLRequest) -> Bool { r.httpMethod != "GET" }

    /// Answers GETs with the fixture and writes with `write`.
    nonisolated static func answering(_ write: (Int, Data)) -> (URLRequest) -> (Int, Data) {
      { r in r.httpMethod == "GET" ? fixture() : write }
    }

    func methods() -> [String] { StubURLProtocol.requests.compactMap(\.httpMethod) }

    // MARK: Loading

    @Test func aFirstLoadFailureIsFullScreen() async {
      let s = store { _ in Self.fail }
      await s.load()
      #expect(s.data == nil)
      #expect(s.error == .server(status: 500, message: "Failed to load categories"))
      #expect(s.banner == nil)
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
      #expect(s.data != nil)
      #expect(s.error == nil)
      #expect(s.banner == "Failed to load categories")
      #expect(s.category(id: "c1")?.name == "Sample Groceries")
    }

    @Test func aSuccessfulLoadClearsTheBanner() async {
      let s = store { _ in Self.fixture() }
      s.banner = "old"
      await s.load()
      #expect(s.banner == nil)
    }

    @Test func anOlderLoadFinishingLastIsIgnored() async {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let first = Gate(Self.isGET)
      let s = store(gates: [first]) { _ in
        count.n += 1
        return count.n == 1 ? Self.fixture() : Self.fail  // the held, older load answers last
      }
      let older = Task { await s.load() }
      await first.arrival()
      await s.load()
      first.open()
      await older.value
      #expect(s.data != nil)
      #expect(s.banner == nil, "the stale failure must not show")
    }

    // MARK: Writes

    @Test func aRenameShowsTheWebsNoticeAfterItsReload() async {
      let s = store(Self.answering(
        (200, Data(#"{"ok":true,"merged":false,"movedTransactions":3,"movedRules":0,"movedResolved":3,"movedSplits":0}"#.utf8))))
      await s.load()
      let prompt = await s.perform(.rename(id: "c1", name: "Sample Food", allowMerge: false))
      #expect(prompt == nil)
      #expect(s.notice == "Renamed — 3 transaction(s) updated.")
      #expect(s.writeCount == 1)
      #expect(methods() == ["GET", "PATCH", "GET"])
    }

    @Test func aMergePromptIsReturnedWithoutReloading() async {
      let json = #"{"error":"x","merge":true,"targetName":"Example Dining","movingTransactions":2,"movingRules":1,"movingResolved":6,"movingSplits":0}"#
      let s = store(Self.answering((409, Data(json.utf8))))
      await s.load()
      let prompt = await s.perform(.rename(id: "c1", name: "Example Dining", allowMerge: false))
      #expect(prompt?.targetName == "Example Dining")
      #expect(s.writeCount == 0)
      #expect(s.banner == nil)
      #expect(!s.isSaving)
      #expect(methods() == ["GET", "PATCH"])
    }

    @Test func aFailedWriteIsABanner() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to create category"}"#.utf8))))
      await s.load()
      await s.perform(.create(name: "Sample Pets"))
      #expect(s.banner == "Failed to create category")
      #expect(s.notice == nil)
      #expect(s.writeCount == 0)
      #expect(methods() == ["GET", "POST"], "a failed write doesn't reload")
    }

    @Test func aWriteClearsStaleMessagesBeforeItsRequest() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      s.banner = "stale"
      s.notice = "stale"
      let running = Task { await s.perform(.createSub(categoryId: "c1", name: "Treats")) }
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
      let first = Task { await s.perform(.delete(id: "c1")) }
      await write.arrival()
      await s.perform(.delete(id: "c1"))
      write.open()
      await first.value
      #expect(methods().filter { $0 == "DELETE" }.count == 1)
    }

    @Test func deletingASubNamesItsCategoryInTheNotice() async {
      let s = store(Self.answering(
        (200, Data(#"{"ok":true,"movedTransactions":2,"movedRules":0,"movedSplits":0,"resetPlaidLabels":0}"#.utf8))))
      await s.load()
      await s.perform(.deleteSub(categoryId: "c1", name: "Snacks"))
      #expect(s.notice == #"Deleted — 2 transaction(s) moved back to "Sample Groceries"."#)
    }

    @Test func togglingAPrimaryShowsNoNotice() async throws {
      let s = store(Self.answering(
        (200, Data(#"{"ok":true,"merged":false,"movedTransactions":0,"movedRules":0,"movedResolved":0,"movedSplits":0}"#.utf8))))
      await s.load()
      await s.perform(.setPrimaries(id: "c1", primaries: ["FOOD_AND_DRINK", "BANK_FEES"]))
      #expect(s.notice == nil)
      #expect(s.writeCount == 1)
      let patch = try #require(StubURLProtocol.requests.first { $0.httpMethod == "PATCH" })
      let body = try #require(StubURLProtocol.body(of: patch))
      #expect(try JSONSerialization.jsonObject(with: body) as? NSDictionary
        == ["plaidPrimaries": ["FOOD_AND_DRINK", "BANK_FEES"]] as NSDictionary)
    }

    @Test func noServerIsABannerForAWrite() async {
      let s = CategoriesStore { nil }
      await s.perform(.create(name: "Sample Pets"))
      #expect(s.banner == APIError.notConfigured.message)
    }
  }
}
```

- [ ] **Step 2: Run the tests and confirm they fail to compile**

Expected: build failure, because `CategoriesStore` and `CategoryWrite` don't exist yet.

- [ ] **Step 3: The store**

`ios/BudgetPhone/Settings/CategoriesStore.swift`:
```swift
import Foundation
import Observation

/// One Settings → Categories write. An enum rather than a closure, so the
/// store keeps the typed error (see TransactionDetailView.Write).
enum CategoryWrite: Equatable, Sendable {
  case create(name: String)
  case rename(id: String, name: String, allowMerge: Bool)
  case setPrimaries(id: String, primaries: [String])
  case delete(id: String)
  case createSub(categoryId: String, name: String)
  case renameSub(categoryId: String, from: String, to: String, allowMerge: Bool)
  case deleteSub(categoryId: String, name: String)
}

/// What Settings → Categories shows (../src/components/SettingsCategories.tsx),
/// shared by the list and the detail screen. Same failure rules as the
/// other stores: with nothing on screen an error is full-screen; with data
/// showing it becomes a banner and the data stays.
@MainActor
@Observable
final class CategoriesStore {
  private(set) var data: CategoriesAdminResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// One write at a time; also stands in for the web's double-save guard.
  private(set) var isSaving = false
  /// Bumped by every successful write, so the ledger's pickers can reload.
  private(set) var writeCount = 0
  var banner: String?
  var notice: String?

  private let client: @MainActor () -> APIClient?
  private var loadGeneration = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  func category(id: String) -> AdminCategory? {
    data?.categories.first { $0.id == id }
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
      let result = try await client.categoriesAdmin()
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

  /// Runs one write. Stale messages clear before the request; on success
  /// the list reloads (keeping its rows) and the web's notice, if it shows
  /// one, is applied after the reload so the reload doesn't wipe it.
  /// Returns the server's merge prompt when a rename needs confirming; the
  /// caller asks, then performs the same rename with `allowMerge: true`.
  @discardableResult
  func perform(_ write: CategoryWrite) async -> MergePrompt? {
    guard !isSaving else { return nil }
    guard let client = client() else {
      banner = APIError.notConfigured.message
      return nil
    }
    isSaving = true
    defer { isSaving = false }
    banner = nil
    notice = nil
    var ownNotice: String?
    do throws(APIError) {
      switch write {
      case .create(let name):
        try await client.createCategory(name: name)
      case .rename(let id, let name, let allowMerge):
        switch try await client.renameCategory(id: id, name: name, allowMerge: allowMerge) {
        case .done(let r): ownNotice = CategoryRules.renameNotice(r, to: name)
        case .needsMerge(let prompt): return prompt
        }
      case .setPrimaries(let id, let primaries):
        try await client.setPlaidPrimaries(id: id, primaries)
      case .delete(let id):
        try await client.deleteCategory(id: id)
      case .createSub(let categoryId, let name):
        try await client.createSubcategory(categoryId: categoryId, name: name)
      case .renameSub(let categoryId, let from, let to, let allowMerge):
        switch try await client.renameSubcategory(
          categoryId: categoryId, from: from, to: to, allowMerge: allowMerge)
        {
        case .done(let r): ownNotice = CategoryRules.renameNotice(r, to: to)
        case .needsMerge(let prompt): return prompt
        }
      case .deleteSub(let categoryId, let name):
        let categoryName = category(id: categoryId)?.name ?? ""
        let r = try await client.deleteSubcategory(categoryId: categoryId, name: name)
        ownNotice = CategoryRules.subDeleteNotice(r, category: categoryName)
      }
    } catch {
      if error != .cancelled { banner = error.message }
      return nil
    }
    writeCount += 1
    await load()
    if let ownNotice { notice = ownNotice }
    return nil
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run the test command. Expected: `CategoriesStoreTests` passes, and so does everything else.

- [ ] **Step 5: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Settings/CategoriesStore.swift BudgetPhoneTests/CategoriesStoreTests.swift
git commit -m "Add the Categories store to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Screens and wiring

**Files:**
- Create: `ios/BudgetPhone/Settings/CategoriesView.swift`
- Create: `ios/BudgetPhone/Settings/CategoryDetailView.swift`
- Modify: `ios/BudgetPhone/Settings/SettingsView.swift`
- Modify: `ios/BudgetPhone/App/RootView.swift`
- Modify: `ios/BudgetPhone/Transactions/TransactionsView.swift` (take `catalog` as a parameter)
- Modify: `ios/README.md` (the Settings line)

**Interfaces:**
- Consumes: `CategoriesStore`, `CategoryWrite`, `CategoryRules`, `CategoryCatalog.load()`, `Banner`, `Notice`, `ErrorView(error:server:retry:)` (as used in `SubscriptionsView`).
- Produces: `CategoriesView(store:catalog:)`, `CategoryDetailView(id:store:)`, `SettingsView(proMode:catalog:)`, `TransactionsView(proMode:catalog:)`.

There are no unit tests for views. Verification is the build plus the full test run. The implementer does **not** run the app against the live server; the owner checks it on the simulator.

- [ ] **Step 1: Move `CategoryCatalog` up to `RootView`**

In `ios/BudgetPhone/Transactions/TransactionsView.swift`, replace
```swift
  @State private var catalog = CategoryCatalog(client: Self.client)
  let proMode: ProMode
```
with
```swift
  let proMode: ProMode
  /// Owned by RootView, so a change in Settings → Categories reaches the pickers.
  let catalog: CategoryCatalog
```
Leave its `.task` and `scenePhase` reloads as they are.

In `ios/BudgetPhone/App/RootView.swift`, add under `proMode`:
```swift
  /// The ledger's category pickers, shared with Settings → Categories, which
  /// reloads it after every change.
  @State private var catalog = CategoryCatalog(client: Self.client)
```
and change the two call sites to `TransactionsView(proMode: proMode, catalog: catalog)` and `SettingsView(proMode: proMode, catalog: catalog)`. Then run `grep -rn "TransactionsView(\|SettingsView(" BudgetPhone` and update any `#Preview` it finds the same way.

- [ ] **Step 2: Shared message strip and delete alert**

Put these at the bottom of `ios/BudgetPhone/Settings/CategoriesView.swift`. Step 3 has the top of the file.
```swift
/// The store's notice and banner, over both Categories screens.
struct CategoryMessages: View {
  let store: CategoriesStore

  var body: some View {
    VStack(spacing: 8) {
      if let notice = store.notice { Notice(text: notice) { store.notice = nil } }
      if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
    }
  }
}

/// The web's `confirm("Delete …?")` for a category, as an alert.
struct CategoryDeleteAlert: ViewModifier {
  @Binding var target: AdminCategory?
  let store: CategoriesStore

  func body(content: Content) -> some View {
    content.alert(
      target.map { CategoryRules.deleteTitle($0.name) } ?? "",
      isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }),
      presenting: target
    ) { c in
      Button("Delete", role: .destructive) { Task { await store.perform(.delete(id: c.id)) } }
      Button("Cancel", role: .cancel) {}
    } message: { c in
      if let message = CategoryRules.deleteMessage(c) { Text(message) }
    }
  }
}
```

- [ ] **Step 3: The list**

Top of `ios/BudgetPhone/Settings/CategoriesView.swift`:
```swift
import SwiftUI

/// Settings → Categories (../src/components/SettingsCategories.tsx) as an
/// iPhone list: + adds, swipe deletes, tap opens the category. Pull down to
/// reload (GET only; nothing here calls Plaid).
struct CategoriesView: View {
  let store: CategoriesStore
  let catalog: CategoryCatalog
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false
  @State private var newName = ""
  @State private var deleting: AdminCategory?

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Categories")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Add Category", systemImage: "plus") {
            newName = ""
            adding = true
          }
          .disabled(store.data == nil || store.isSaving)
        }
      }
      .alert("New Category", isPresented: $adding) {
        TextField("New category", text: $newName)
        Button("Cancel", role: .cancel) {}
        Button("Add") { add() }
      }
      .modifier(CategoryDeleteAlert(target: $deleting, store: store))
      .task { await store.load() }
      // The ledger's pickers offer the same list.
      .onChange(of: store.writeCount) { Task { await catalog.load() } }
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

  private func list(_ data: CategoriesAdminResponse) -> some View {
    List {
      if !data.unmappedPrimaries.isEmpty {
        Section {
          Label {
            VStack(alignment: .leading, spacing: 4) {
              Text(CategoryRules.unmappedHeadline(data.unmappedPrimaries))
                .font(.subheadline.weight(.medium))
              Text(CategoryRules.unmappedDetail).font(.footnote).foregroundStyle(.secondary)
            }
          } icon: {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
          }
        }
      }
      Section {
        ForEach(data.categories) { c in
          NavigationLink {
            CategoryDetailView(id: c.id, store: store)
          } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(c.name)
              Text(CategoryRules.usage(c)).font(.footnote).foregroundStyle(.secondary)
            }
          }
          .swipeActions {
            if !CategoryRules.isReserved(c) {
              Button("Delete", systemImage: "trash", role: .destructive) { deleting = c }
            }
          }
        }
      }
    }
    .listStyle(.insetGrouped)
    .refreshable { await store.load() }
    .safeAreaInset(edge: .top) { CategoryMessages(store: store) }
  }

  private func add() {
    guard let name = CategoryRules.cleanName(newName) else { return }
    Task { await store.perform(.create(name: name)) }
  }
}
```

- [ ] **Step 4: The detail screen**

`ios/BudgetPhone/Settings/CategoryDetailView.swift`:
```swift
import SwiftUI

/// One category: its name, subcategories, Plaid labels and delete
/// (../src/components/SettingsCategories.tsx, one table row and its sub
/// rows). Reads the category from the store by id, so it follows every
/// reload, and pops itself once a merge or delete removes it.
struct CategoryDetailView: View {
  let id: String
  let store: CategoriesStore
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var merge: PendingMerge?
  @State private var deleting: AdminCategory?
  @State private var deletingSub: AdminSubcategory?
  @State private var renamingSub: AdminSubcategory?
  @State private var addingSub = false
  @State private var subName = ""

  /// A rename the server wants confirmed, and the write that confirms it.
  struct PendingMerge {
    let title: String
    let message: String
    let confirm: CategoryWrite
  }

  private var category: AdminCategory? { store.category(id: id) }

  var body: some View {
    Group {
      if let c = category { form(c) } else { Color.clear }
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle(category?.name ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .onChange(of: category == nil) { _, gone in if gone { dismiss() } }
  }

  private func form(_ c: AdminCategory) -> some View {
    Form {
      nameSection(c)
      subcategorySection(c)
      Section("Plaid Labels") {
        ForEach(store.data?.primaries ?? [], id: \.self) { p in
          Button { toggle(c, p) } label: {
            HStack {
              Text(p).font(.footnote.monospaced())
              Spacer()
              if c.plaidPrimaries.contains(p) {
                Image(systemName: "checkmark").foregroundStyle(.tint)
              }
            }
          }
          .foregroundStyle(.primary)
          .disabled(store.isSaving)
        }
      }
      Section {
        Button("Delete Category", role: .destructive) { deleting = c }
          .disabled(CategoryRules.isReserved(c) || store.isSaving)
      }
    }
    .safeAreaInset(edge: .top) { CategoryMessages(store: store) }
    .onAppear { name = c.name }
    .onChange(of: c.name) { _, new in name = new }
    .modifier(CategoryDeleteAlert(target: $deleting, store: store))
    .alert(
      merge?.title ?? "",
      isPresented: Binding(get: { merge != nil }, set: { if !$0 { merge = nil } }),
      presenting: merge
    ) { m in
      Button("Merge") { Task { await store.perform(m.confirm) } }
      Button("Cancel", role: .cancel) { name = c.name }
    } message: { m in
      Text(m.message)
    }
    .alert("Rename Subcategory", isPresented: Binding(get: { renamingSub != nil }, set: { if !$0 { renamingSub = nil } }), presenting: renamingSub) { s in
      TextField("Name", text: $subName)
      Button("Cancel", role: .cancel) {}
      Button("Save") { renameSub(c, s) }
    }
    .alert("New Subcategory", isPresented: $addingSub) {
      TextField("New subcategory of \(c.name)", text: $subName)
      Button("Cancel", role: .cancel) {}
      Button("Add") { addSub(c) }
    }
    .alert(
      deletingSub.map { CategoryRules.deleteSubTitle(category: c.name, sub: $0.name) } ?? "",
      isPresented: Binding(get: { deletingSub != nil }, set: { if !$0 { deletingSub = nil } }),
      presenting: deletingSub
    ) { s in
      Button("Delete", role: .destructive) {
        Task { await store.perform(.deleteSub(categoryId: c.id, name: s.name)) }
      }
      Button("Cancel", role: .cancel) {}
    } message: { s in
      if let message = CategoryRules.deleteSubMessage(category: c.name, s) { Text(message) }
    }
  }

  @ViewBuilder private func nameSection(_ c: AdminCategory) -> some View {
    if CategoryRules.isReserved(c) {
      Section {
        Text(c.name)
      } header: {
        Text("Name")
      } footer: {
        Text(CategoryRules.reservedNote)
      }
    } else {
      Section("Name") {
        TextField("Name", text: $name)
          .submitLabel(.done)
          .onSubmit { rename(c) }
          .disabled(store.isSaving)
      }
    }
  }

  private func subcategorySection(_ c: AdminCategory) -> some View {
    Section("Subcategories") {
      ForEach(c.subcategories) { s in
        Button {
          subName = s.name
          renamingSub = s
        } label: {
          VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
              Text(s.name)
              if let badge = CategoryRules.plaidBadge(s) {
                Text(badge)
                  .font(.caption2.weight(.medium))
                  .padding(.horizontal, 6)
                  .padding(.vertical, 2)
                  .background(.blue.opacity(0.15), in: .rect(cornerRadius: 4))
                  .foregroundStyle(.blue)
              }
            }
            Text(CategoryRules.usage(s)).font(.footnote).foregroundStyle(.secondary)
          }
        }
        .foregroundStyle(.primary)
        .swipeActions {
          if CategoryRules.isResetOnly(s) {
            Button("Reset") { Task { await store.perform(.deleteSub(categoryId: c.id, name: s.name)) } }
          } else if CategoryRules.isDeletable(s) {
            Button("Delete", systemImage: "trash", role: .destructive) { deletingSub = s }
          }
        }
      }
      Button("Add Subcategory") {
        subName = ""
        addingSub = true
      }
      .disabled(store.isSaving)
    }
  }

  private func rename(_ c: AdminCategory) {
    guard let to = CategoryRules.cleanName(name), to != c.name else {
      name = c.name
      return
    }
    Task {
      if let prompt = await store.perform(.rename(id: c.id, name: to, allowMerge: false)) {
        merge = PendingMerge(
          title: CategoryRules.mergeTitle(from: c.name, prompt),
          message: CategoryRules.mergeMessage(from: c.name, prompt),
          confirm: .rename(id: c.id, name: to, allowMerge: true))
      } else {
        // Saved (the reload brought the new name) or failed (a banner says why).
        name = store.category(id: c.id)?.name ?? name
      }
    }
  }

  private func renameSub(_ c: AdminCategory, _ s: AdminSubcategory) {
    guard let to = CategoryRules.cleanName(subName), to != s.name else { return }
    Task {
      if let prompt = await store.perform(
        .renameSub(categoryId: c.id, from: s.name, to: to, allowMerge: false))
      {
        merge = PendingMerge(
          title: CategoryRules.mergeTitle(from: s.name, prompt),
          message: CategoryRules.subMergeMessage(category: c.name, prompt),
          confirm: .renameSub(categoryId: c.id, from: s.name, to: to, allowMerge: true))
      }
    }
  }

  private func addSub(_ c: AdminCategory) {
    guard let new = CategoryRules.cleanName(subName) else { return }
    Task { await store.perform(.createSub(categoryId: c.id, name: new)) }
  }

  private func toggle(_ c: AdminCategory, _ primary: String) {
    let next =
      c.plaidPrimaries.contains(primary)
      ? c.plaidPrimaries.filter { $0 != primary }
      : c.plaidPrimaries + [primary]
    Task { await store.perform(.setPrimaries(id: c.id, primaries: next)) }
  }
}
```

- [ ] **Step 5: The Settings row**

In `ios/BudgetPhone/Settings/SettingsView.swift`:
- Add `let catalog: CategoryCatalog` under `let proMode: ProMode`, and `@State private var categories = CategoriesStore(client: RootView.client)` under it.
- Insert this section between the Pro Mode section and `ServerForm()`:
```swift
        Section {
          NavigationLink("Categories") { CategoriesView(store: categories, catalog: catalog) }
        }
```

- [ ] **Step 6: README**

In `ios/README.md`, change the Settings bullet to:
```markdown
- **Settings** — the Pro Mode switch, Categories (add, rename, merge, delete,
  Plaid labels, subcategories), and the server address.
```
Add `../docs/superpowers/specs/2026-10-01-ios-settings-categories-design.md` wherever that README lists the other iOS specs (line ~24).

- [ ] **Step 7: Build and run every test**

Run the test command. Expected: it builds with no new warnings in the touched files, and every suite passes.

- [ ] **Step 8: Self-check the diff for live data**

Run `git diff main -- . ../docs | grep -n -i -E "bank|card|\\\$[0-9]"` and read the hits. Only invented values (`Sample …`, `Example …`) and Plaid's public codes are allowed.

- [ ] **Step 9: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Settings BudgetPhone/App/RootView.swift BudgetPhone/Transactions/TransactionsView.swift README.md
git commit -m "Add Settings → Categories to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
