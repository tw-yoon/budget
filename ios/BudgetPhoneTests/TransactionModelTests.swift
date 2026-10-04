import Foundation
import Testing
@testable import BudgetPhone

struct TransactionModelTests {
  @Test func decodesALedgerPage() throws {
    let page = try TestData.transactions()
    #expect(page.transactions.count == 7)
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
    // A single, fully-allocated split reads "Split 1 way", singular, and
    // isn't amber since nothing has shrunk below it.
    #expect(try texts("tx-split-one") == ["Split 1 way"])
    #expect(try TestData.transaction("tx-split-one").badges[0].tone == .slate)
    #expect(try texts("tx-fee") == ["Fee"])
  }

  @Test func splitLeftToAllocateFollowsTheWeb() throws {
    // Unsplit: the whole amount is left.
    #expect(try TestData.transaction("tx-purchase").splitLeftToAllocate == 60)
    // A remainder from the server wins even when it's negative (shrunk).
    #expect(try TestData.transaction("tx-split").splitLeftToAllocate == -10)
    // Already fully allocated (has parts, no remainder sent): nothing left.
    #expect(try TestData.transaction("tx-split-one").splitLeftToAllocate == 0)
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
