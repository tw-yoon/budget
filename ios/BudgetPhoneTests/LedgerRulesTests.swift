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

  @Test func splitFitsWhatIsLeftAllowsAHalfCentOver() {
    #expect(Ledger.splitFitsWhatIsLeft(10, left: 10))
    #expect(Ledger.splitFitsWhatIsLeft(10.005, left: 10))
    #expect(!Ledger.splitFitsWhatIsLeft(10.01, left: 10))
    #expect(!Ledger.splitFitsWhatIsLeft(1, left: 0))
  }

  @Test func categoryOptionsAddTheRowsOwnAndSort() {
    #expect(
      Ledger.categoryOptions(["Groceries", "Dining"], current: "Travel", plaid: "Dining")
        == ["Dining", "Groceries", "Travel"])
  }

  // F1: a programmatic adopt() sets `category` to the same value the picker
  // already showed — that must not look like a user pick.
  @Test func subcategoryResetsOnlyWhenTheCategoryActuallyChanges() {
    #expect(!CategoryFields.subcategoryShouldReset(from: "Shopping", to: "Shopping"))
    #expect(CategoryFields.subcategoryShouldReset(from: "Shopping", to: "Groceries"))
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
