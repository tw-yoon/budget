import Foundation
import Testing
@testable import BudgetPhone

struct AccountPatchTests {
  func json(_ patch: AccountPatch) throws -> [String: Any] {
    let data = try JSONEncoder().encode(patch)
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  @Test func unchangedKeysAreOmittedClearedAreNullSetArePresent() throws {
    var patch = AccountPatch()
    patch.displayName = .set("Groceries")
    patch.manualDueDay = .clear
    let body = try json(patch)
    #expect(body["displayName"] as? String == "Groceries")
    #expect(body["manualDueDay"] is NSNull)
    #expect(body.keys.contains("manualCreditLimit") == false)
  }

  @Test func anUntouchedFormProducesAnEmptyPatch() throws {
    let card = try TestData.accounts().groups[1].accounts[0]
    let patch = AccountEditForm(account: card).patch(against: card)
    #expect(patch.isEmpty)
    #expect(try json(patch).isEmpty)
  }

  @Test func onlyTheEditedFieldIsSent() throws {
    let card = try TestData.accounts().groups[1].accounts[0]
    var form = AccountEditForm(account: card)
    form.creditLimitText = "6000"
    #expect(form.patch(against: card) == AccountPatch(manualCreditLimit: .set(6000)))
  }

  @Test func blankingANameClearsIt() throws {
    let card = try TestData.accounts().groups[1].accounts[0]
    var form = AccountEditForm(account: card)
    form.name = "   "
    #expect(form.patch(against: card) == AccountPatch(displayName: .clear))
  }

  @Test func nameIsTrimmedAndAnUnchangedTrimIsNoChange() throws {
    let card = try TestData.accounts().groups[1].accounts[0]
    var form = AccountEditForm(account: card)
    form.name = "  Groceries card "
    #expect(form.patch(against: card).isEmpty)
  }

  @Test func dueDayAndLimitClear() throws {
    let card = TestData.card(manualDueDay: 6, manualCreditLimit: 5000)
    var form = AccountEditForm(account: card)
    form.dueDay = nil
    form.creditLimitText = ""
    #expect(form.patch(against: card) == AccountPatch(manualDueDay: .clear, manualCreditLimit: .clear))
  }

  @Test func nonCreditAccountsOnlyEverPatchTheName() throws {
    let checking = try TestData.accounts().groups[0].accounts[0]
    var form = AccountEditForm(account: checking)
    form.dueDay = 5
    form.creditLimitText = "100"
    #expect(form.patch(against: checking).isEmpty)
  }

  @Test func aNameOnlyEditDoesNotRewriteAHighPrecisionCreditLimit() throws {
    // Formatters.plainNumber rounds to ~5 fraction digits, so re-parsing the
    // text the form was initialised with can disagree with the stored value
    // even though the user never touched the limit field.
    let card = TestData.card(manualCreditLimit: 1234.56789012)
    var form = AccountEditForm(account: card)
    form.name = "Renamed"
    let patch = form.patch(against: card)
    #expect(patch.manualCreditLimit == .unchanged)
    #expect(patch.displayName == .set("Renamed"))
  }

  @Test func creditLimitValidation() throws {
    var form = AccountEditForm(account: TestData.card())
    form.creditLimitText = "abc"
    #expect(form.creditLimit == .invalid)
    #expect(form.isValid == false)
    form.creditLimitText = "-5"
    #expect(form.creditLimit == .invalid)
    form.creditLimitText = "2500.75"
    #expect(form.creditLimit == .value(2500.75))
    form.creditLimitText = ""
    #expect(form.creditLimit == .empty)
    #expect(form.isValid)
  }
}
