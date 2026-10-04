import Foundation
import Testing
@testable import BudgetPhone

/// Hiding accounts on the phone: the totals recomputed from what is left
/// (the sums in ../src/app/api/accounts/route.ts), and where the hidden ids
/// are kept.
@MainActor
struct AccountHidingTests {
  func account(_ id: String, _ balance: Double, type: String, disconnected: Bool = false) -> AccountDTO {
    let a = TestData.card(type: type)
    return AccountDTO(
      id: id, name: a.name, officialName: nil, mask: a.mask, type: type, subtype: nil,
      currentBalance: balance, availableBalance: nil, balanceFetchedAt: a.balanceFetchedAt,
      institution: a.institution, isLiability: type == "CREDIT" || type == "LOAN",
      nextPaymentDueDate: nil, lastStatementBalance: nil, minimumPaymentAmount: nil,
      paymentIsOverdue: nil, displayName: nil, manualDueDay: nil, manualCreditLimit: nil,
      disconnected: disconnected)
  }

  func group(_ type: String, _ accounts: [AccountDTO]) -> AccountGroup {
    AccountGroup(
      type: type, label: type.capitalized, subtotal: accounts.reduce(0) { $0 + $1.currentBalance },
      isLiability: type == "CREDIT" || type == "LOAN", accounts: accounts)
  }

  /// Two cash accounts, one investment, one card.
  func data() -> AccountsResponse {
    let cash = group("DEPOSITORY", [account("chk", 1000.10, type: "DEPOSITORY"), account("sav", 500.20, type: "DEPOSITORY")])
    let inv = group("INVESTMENT", [account("hsa", 0, type: "INVESTMENT")])
    let card = group("CREDIT", [account("card", 300.05, type: "CREDIT")])
    return AccountsResponse(
      groups: [cash, inv, card],
      summary: AccountsSummary(
        totalAssets: 1500.3, totalLiabilities: 300.05, netWorth: 1200.25, accountCount: 4,
        lastRefreshed: "2026-09-26T15:00:00.000Z"))
  }

  // MARK: Totals

  @Test func nothingHiddenKeepsTheServersFiguresExactly() {
    let d = data()
    let r = AccountTotals.visible(d, hidden: [], showHidden: false)
    #expect(r.groups == d.groups)
    #expect(r.summary == d.summary)
  }

  @Test func aHiddenAssetLeavesItsGroupAndTheTotals() {
    let r = AccountTotals.visible(data(), hidden: ["sav"], showHidden: false)
    #expect(r.groups.map(\.type) == ["DEPOSITORY", "INVESTMENT", "CREDIT"])
    #expect(r.groups[0].accounts.map(\.id) == ["chk"])
    #expect(r.groups[0].subtotal == 1000.10)
    #expect(r.summary.totalAssets == 1000.1)
    #expect(r.summary.totalLiabilities == 300.05)
    #expect(r.summary.netWorth == 700.05)
    #expect(r.summary.accountCount == 4, "the server's count; hiding isn't removing")
    #expect(r.summary.lastRefreshed == "2026-09-26T15:00:00.000Z")
  }

  @Test func aHiddenLiabilityLeavesTheLiabilities() {
    let r = AccountTotals.visible(data(), hidden: ["card"], showHidden: false)
    #expect(r.groups.map(\.type) == ["DEPOSITORY", "INVESTMENT"], "a group with nothing left drops out")
    #expect(r.summary.totalLiabilities == 0)
    #expect(r.summary.netWorth == 1500.3)
  }

  @Test func showHiddenKeepsTheRowsButNotTheirMoney() {
    let r = AccountTotals.visible(data(), hidden: ["sav", "hsa"], showHidden: true)
    #expect(r.groups.map(\.type) == ["DEPOSITORY", "INVESTMENT", "CREDIT"])
    #expect(r.groups[0].accounts.map(\.id) == ["chk", "sav"])
    #expect(r.groups[0].subtotal == 1000.10)
    #expect(r.groups[1].subtotal == 0)
    #expect(r.summary.totalAssets == 1000.1)
    #expect(r.summary.netWorth == 700.05)
  }

  @Test func hiddenIdsNotInTheDataChangeNothing() {
    let d = data()
    let r = AccountTotals.visible(d, hidden: ["gone"], showHidden: false)
    #expect(r.groups == d.groups)
    #expect(r.summary == d.summary)
  }

  // MARK: Disconnected banks

  /// A cash account and a card on a disconnected bank, beside `data()`'s
  /// accounts. The server's figures already leave them out
  /// (../src/lib/account-totals.ts).
  func withDisconnected() -> AccountsResponse {
    let d = data()
    let oldCash = account("old-sav", 700, type: "DEPOSITORY", disconnected: true)
    let oldCard = account("old-card", 50, type: "CREDIT", disconnected: true)
    let groups = d.groups.map { g in
      AccountGroup(
        type: g.type, label: g.label, subtotal: g.subtotal, isLiability: g.isLiability,
        accounts: g.accounts + (g.type == "DEPOSITORY" ? [oldCash] : g.type == "CREDIT" ? [oldCard] : []))
    }
    return AccountsResponse(groups: groups, summary: d.summary)
  }

  @Test func disconnectedAccountsStayListedButCountInNoTotal() {
    let d = withDisconnected()
    let r = AccountTotals.visible(d, hidden: [], showHidden: false)
    #expect(r.groups[0].accounts.map(\.id) == ["chk", "sav", "old-sav"])
    #expect(r.groups[0].subtotal == data().groups[0].subtotal, "chk + sav, without old-sav")
    #expect(r.groups[2].accounts.map(\.id) == ["card", "old-card"])
    #expect(r.groups[2].subtotal == 300.05)
    #expect(r.summary == d.summary, "the same figures the server sent")
  }

  @Test func hidingBesideADisconnectedAccountStillLeavesItOut() {
    let r = AccountTotals.visible(withDisconnected(), hidden: ["chk"], showHidden: false)
    #expect(r.groups[0].accounts.map(\.id) == ["sav", "old-sav"])
    #expect(r.groups[0].subtotal == 500.2)
    #expect(r.summary.totalAssets == 500.2)
    #expect(r.summary.totalLiabilities == 300.05)
    #expect(r.summary.netWorth == 200.15)
  }

  @Test func aGroupOfOnlyDisconnectedAccountsShowsWithAZeroSubtotal() {
    let old = account("old-hsa", 900, type: "INVESTMENT", disconnected: true)
    let d = AccountsResponse(
      groups: [AccountGroup(type: "INVESTMENT", label: "Investments", subtotal: 0, isLiability: false, accounts: [old])],
      summary: AccountsSummary(totalAssets: 0, totalLiabilities: 0, netWorth: 0, accountCount: 0, lastRefreshed: nil))
    let r = AccountTotals.visible(d, hidden: [], showHidden: false)
    #expect(r.groups.map(\.type) == ["INVESTMENT"])
    #expect(r.groups[0].subtotal == 0)
    #expect(r.summary.netWorth == 0)
  }

  @Test func totalsRoundToTheCentLikeTheServer() {
    #expect(AccountTotals.round(0.125) == 0.13)
    #expect(AccountTotals.round(-0.125) == -0.12, "Math.round rounds halves up, toward +∞")
    #expect(AccountTotals.round(1200.249) == 1200.25)
  }

  // MARK: Storage

  @Test func hiddenIdsAreKeptAndReadBack() throws {
    let defaults = try #require(UserDefaults(suiteName: "AccountHidingTests"))
    defaults.removePersistentDomain(forName: "AccountHidingTests")
    let hidden = HiddenAccounts(defaults: defaults)
    #expect(!hidden.isHidden("hsa"))
    hidden.setHidden("hsa", true)
    hidden.setHidden("sav", true)
    hidden.setHidden("sav", false)
    #expect(hidden.isHidden("hsa"))
    #expect(!hidden.isHidden("sav"))
    #expect(HiddenAccounts(defaults: defaults).ids == ["hsa"], "a fresh copy reads what was saved")
  }

  @Test func countOnlyIncludesAccountsStillShown() {
    let defaults = UserDefaults(suiteName: "AccountHidingTests.count")!
    defaults.removePersistentDomain(forName: "AccountHidingTests.count")
    let hidden = HiddenAccounts(defaults: defaults)
    hidden.setHidden("hsa", true)
    hidden.setHidden("gone", true)
    #expect(hidden.count(in: data()) == 1)
  }
}
