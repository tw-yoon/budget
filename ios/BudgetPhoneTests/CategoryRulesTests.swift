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

  @Test func unmappedDetailMatchesTheWeb() {
    #expect(CategoryRules.unmappedDetail
      == "Those transactions report under Plaid\u{2019}s own wording instead of one of your categories, and won\u{2019}t follow if you rename a category later.")
    #expect(CategoryRules.unmappedDetail.contains("\u{2019}"))
    #expect(!CategoryRules.unmappedDetail.contains("'"))
  }

  @Test func reservedNoteMatchesBrief() {
    #expect(CategoryRules.reservedNote
      == "\"Transfer\" controls how transactions are excluded from spending — it cannot be renamed or deleted")
  }
}
