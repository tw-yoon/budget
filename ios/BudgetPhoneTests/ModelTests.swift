import Foundation
import Testing
@testable import BudgetPhone

struct ModelTests {
  @Test func decodesTheAccountsResponseAndIgnoresUnusedKeys() throws {
    let response = try TestData.accounts()
    #expect(response.groups.map(\.type) == ["DEPOSITORY", "CREDIT"])
    #expect(response.summary.accountCount == 2)
    #expect(response.summary.netWorth == 3398.16)
    let card = response.groups[1].accounts[0]
    #expect(card.displayName == "Groceries card")
    #expect(card.manualCreditLimit == 5000)
    #expect(card.manualDueDay == nil)
  }

  @Test func anAccountWithoutTheDisconnectedKeyIsConnected() throws {
    let response = try TestData.accounts()
    #expect(response.groups.flatMap(\.accounts).allSatisfy { !$0.disconnected })
    #expect(response.groups[0].accounts[0].disconnectedLine() == nil)
  }

  @Test func aDisconnectedAccountDecodesAndSaysAsOfWhen() throws {
    let json = Data(
      #"""
      {
        "id": "x", "name": "Old Savings", "officialName": null, "mask": "0003", "type": "DEPOSITORY",
        "subtype": "savings", "currentBalance": 10, "availableBalance": null,
        "balanceFetchedAt": "2026-09-26T15:00:00.000Z", "institution": "Example Bank",
        "isLiability": false, "nextPaymentDueDate": null, "lastStatementBalance": null,
        "minimumPaymentAmount": null, "paymentIsOverdue": null, "displayName": null,
        "manualDueDay": null, "manualCreditLimit": null, "disconnected": true
      }
      """#.utf8)
    let account = try JSONDecoder().decode(AccountDTO.self, from: json)
    #expect(account.disconnected)
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    #expect(account.disconnectedLine(calendar: utc) == "Disconnected \u{00B7} as of Sep 26, 2026")
  }

  @Test func liabilitiesPrintNegative() throws {
    let response = try TestData.accounts()
    #expect(response.groups[0].signedSubtotal == 4210.5)
    #expect(response.groups[1].signedSubtotal == -812.34)
    #expect(response.groups[1].accounts[0].signedBalance == -812.34)
  }

  @Test func rowTextMatchesTheWebCard() throws {
    let response = try TestData.accounts()
    let checking = response.groups[0].accounts[0]
    let card = response.groups[1].accounts[0]
    #expect(checking.title == "Everyday Checking")
    #expect(checking.subtitle == "··0001 · checking · Example Bank")
    #expect(card.title == "Groceries card")
    #expect(card.availableLabel == "Available credit")
    // A manual limit derives available credit: 5000 − 812.34.
    #expect(abs(card.available! - 4187.66) < 0.001)
    #expect(checking.available == 4100)
  }

  @Test func availableIsShownOnlyWhenItDiffersFromTheBalance() throws {
    let response = try TestData.accounts()
    #expect(response.groups[0].accounts[0].availableWorthShowing == 4100)
    let same = TestData.card(type: "DEPOSITORY")  // balance 100, available 900
    #expect(same.availableWorthShowing == 900)
    let equal = AccountDTO(
      id: "e", name: "Savings", officialName: nil, mask: nil, type: "DEPOSITORY",
      subtype: "savings", currentBalance: 250, availableBalance: 250,
      balanceFetchedAt: "2026-09-26T15:00:00.000Z", institution: "Example Bank",
      isLiability: false, nextPaymentDueDate: nil, lastStatementBalance: nil,
      minimumPaymentAmount: nil, paymentIsOverdue: nil, displayName: nil,
      manualDueDay: nil, manualCreditLimit: nil)
    #expect(equal.availableWorthShowing == nil)
  }

  @Test func subtitleFallsBackToTypeAndSkipsAMissingMask() {
    let account = AccountDTO(
      id: "x", name: "Brokerage", officialName: nil, mask: nil, type: "INVESTMENT",
      subtype: nil, currentBalance: 1, availableBalance: nil,
      balanceFetchedAt: "2026-09-26T15:00:00.000Z", institution: "Example Invest",
      isLiability: false, nextPaymentDueDate: nil, lastStatementBalance: nil,
      minimumPaymentAmount: nil, paymentIsOverdue: nil, displayName: nil,
      manualDueDay: nil, manualCreditLimit: nil)
    #expect(account.subtitle == "investment · Example Invest")
  }

  @Test func missingOptionalKeysDecodeAsNil() throws {
    let json = Data(
      #"""
      {
        "id": "x", "name": "No Extras", "mask": null, "type": "DEPOSITORY",
        "subtype": null, "currentBalance": 10, "availableBalance": null,
        "balanceFetchedAt": "2026-09-26T15:00:00.000Z", "institution": "Example Bank",
        "isLiability": false, "nextPaymentDueDate": null, "lastStatementBalance": null,
        "minimumPaymentAmount": null, "paymentIsOverdue": null, "displayName": null,
        "manualDueDay": null
      }
      """#.utf8)
    let account = try JSONDecoder().decode(AccountDTO.self, from: json)
    #expect(account.officialName == nil)
    #expect(account.manualCreditLimit == nil)
  }

  @Test func formattersMatchTheWeb() throws {
    #expect(Formatters.currency(1234.5) == "$1,234.50")
    #expect(Formatters.currency(-812.34) == "-$812.34")
    let now = try #require(Formatters.parseISO("2026-09-26T15:00:00.000Z"))
    #expect(Formatters.relative(now.addingTimeInterval(-30), now: now) == "just now")
    #expect(Formatters.relative(now.addingTimeInterval(-4 * 60), now: now) == "4m ago")
    #expect(Formatters.relative(now.addingTimeInterval(-3 * 3600), now: now) == "3h ago")
    #expect(Formatters.relative(now.addingTimeInterval(-50 * 3600), now: now) == "2d ago")
    #expect(Formatters.plainNumber(5000) == "5000")
    #expect(Formatters.plainNumber(5000.5) == "5000.5")
    #expect(Formatters.parseISO("2026-10-05T00:00:00Z") != nil)
    #expect(Formatters.parseISO("2026-10-05") != nil)
    #expect(Formatters.parseISO("not a date") == nil)
  }
}
