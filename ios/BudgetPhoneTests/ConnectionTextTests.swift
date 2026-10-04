import Foundation
import Testing
@testable import BudgetPhone

/// Settings → Connections: decoding and wording
/// (../src/components/DebitCards.tsx, ConnectedBanks.tsx), with no network.
struct ConnectionTextTests {
  func data() throws -> ConnectionsResponse {
    try JSONDecoder().decode(ConnectionsResponse.self, from: TestData.fixture("connections"))
  }

  @Test func decodesTheFixture() throws {
    let d = try data()
    #expect(d.banks.map(\.id) == ["item-sample-abc123", "item-sample-zzz999"])
    #expect(d.debitCards.map(\.id) == ["d1", "d2"])
    #expect(d.debitCards[1].available == nil)
    #expect(d.checkingAccounts.map(\.id) == ["a1", "a2"], "the DEPOSITORY group's accounts")
  }

  @Test func noDepositoryGroupMeansNoCheckingAccounts() throws {
    let json = #"{"groups":[],"banks":[],"debitCards":[]}"#
    let d = try JSONDecoder().decode(ConnectionsResponse.self, from: Data(json.utf8))
    #expect(d.checkingAccounts.isEmpty)
  }

  var utc: Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
  }

  @Test func decodesWhetherABankIsDisconnected() throws {
    let d = try data()
    #expect(!d.banks[0].isDisconnected)
    #expect(d.banks[0].transactionCount == 41)
    #expect(d.banks[1].isDisconnected)
    #expect(d.banks[1].disconnectedAt == "2026-09-30T12:00:00.000Z")
  }

  @Test func aBankFromAnOlderServerDecodesAsConnected() throws {
    let json = #"{"itemId":"item-sample-old","institution":"Example Bank","accountCount":1}"#
    let b = try JSONDecoder().decode(BankSummary.self, from: Data(json.utf8))
    #expect(!b.isDisconnected)
    #expect(b.transactionCount == nil)
  }

  @Test func bankLine() throws {
    let d = try data()
    #expect(ConnectionText.bankLine(d.banks[0], calendar: utc) == "2 accounts \u{00B7} id \u{2026}abc123")
    #expect(ConnectionText.bankLine(d.banks[1], calendar: utc)
      == "Disconnected Sep 30, 2026 \u{00B7} 1 account \u{00B7} id \u{2026}zzz999")
  }

  @Test func disconnectWordingSaysHistoryIsKept() throws {
    let b = try data().banks[0]
    #expect(ConnectionText.disconnectTitle(b) == "Disconnect Example Bank?")
    #expect(ConnectionText.disconnectMessage(b)
      == "This revokes the Plaid connection, so nothing new comes in from this bank. Its history is kept: 2 accounts and their transactions stay in this app, left out of your totals.")
  }

  @Test func deleteOnAConnectedBankDisconnectsAndNamesTheCounts() throws {
    let b = try data().banks[0]
    #expect(ConnectionText.deleteAction(b) == "Delete")
    #expect(ConnectionText.deleteTitle(b) == "Delete Example Bank?")
    #expect(ConnectionText.deleteMessage(b)
      == "This disconnects the bank and removes everything it recorded in this app: 2 accounts and 41 transactions, with their categories, splits and links. It cannot be undone.")
  }

  @Test func deleteHistoryOnADisconnectedBank() throws {
    let b = try data().banks[1]
    #expect(ConnectionText.deleteAction(b) == "Delete History")
    #expect(ConnectionText.deleteTitle(b) == "Delete Sample Credit Union's history?")
    #expect(ConnectionText.deleteMessage(b)
      == "This removes everything this bank recorded in this app: 1 account and 1 transaction, with their categories, splits and links. It cannot be undone.")
  }

  @Test func deleteWithoutATransactionCountStillReads() throws {
    let json = #"{"itemId":"item-sample-old","institution":"Example Bank","accountCount":3}"#
    let b = try JSONDecoder().decode(BankSummary.self, from: Data(json.utf8))
    #expect(ConnectionText.deleteMessage(b).contains("3 accounts and their transactions, with"))
  }

  @Test func cardWording() throws {
    let d = try data()
    #expect(ConnectionText.cardLine(d.debitCards[0]) == "\u{00B7}\u{00B7}0002 \u{00B7} draws from Everyday")
    #expect(ConnectionText.removeTitle(d.debitCards[0]) == "Remove debit card Sample Debit \u{00B7}\u{00B7}0002?")
    #expect(ConnectionText.available(d.debitCards[0]) == "$1,450.00 available")
    #expect(ConnectionText.available(d.debitCards[1]) == nil)
  }

  @Test func fixedStrings() {
    #expect(ConnectionText.noCards == "No debit cards yet.")
    #expect(ConnectionText.noChecking == "Connect a checking account first, then add the debit card linked to it.")
    #expect(ConnectionText.macFooter
      == "To connect a bank or investment account, or reconnect one, use Budget on your Mac.")
  }

  @Test func cleanLast4KeepsAtMostFourDigits() {
    #expect(ConnectionText.cleanLast4("12a3-45") == "1234")
    #expect(ConnectionText.cleanLast4("98") == "98")
    #expect(ConnectionText.cleanLast4("") == "")
  }

  @Test func accountLabelPrefersTheDisplayName() throws {
    let accounts = try data().checkingAccounts
    #expect(ConnectionText.accountLabel(accounts[0]) == "Everyday")
    #expect(ConnectionText.accountLabel(accounts[1]) == "Sample Savings")
  }
}
