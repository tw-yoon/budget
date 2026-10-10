import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  @Suite(.serialized)
  struct SavedResponsesTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ body: Data) -> APIClient {
      let cache = ResponseCache(
        root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
      return APIClient(
        baseURL: base, session: StubURLProtocol.session { _ in (200, body) },
        token: "sample-token", cache: cache)
    }

    func files(_ c: APIClient) -> [String] {
      let paths = FileManager.default.enumerator(atPath: c.cache!.root.path)?.allObjects as? [String]
      return (paths ?? []).filter { $0.hasSuffix(".json") }
    }

    @Test func accountsAreSaved() async throws {
      let c = client(try TestData.accountsJSON())
      let got = try await c.accounts()
      #expect(c.savedAccounts() == got)
    }

    @Test func theLedgerIsSavedForPageOne() async throws {
      let c = client(try TestData.fixture("transactions"))
      let q = TransactionQuery()
      let got = try await c.transactions(q, page: 1)
      #expect(c.savedTransactions(q) == got)
    }

    @Test func ledgerPageTwoSavesNothing() async throws {
      let c = client(try TestData.fixture("transactions"))
      _ = try await c.transactions(TransactionQuery(), page: 2)
      #expect(files(c).isEmpty)
      #expect(c.savedTransactions(TransactionQuery()) == nil)
    }

    @Test func aSearchSavesNothingAndReadsNil() async throws {
      let c = client(try TestData.fixture("transactions"))
      var q = TransactionQuery()
      q.search = "sample"
      _ = try await c.transactions(q, page: 1)
      #expect(files(c).isEmpty)
      #expect(c.savedTransactions(q) == nil)
    }

    @Test func aLedgerSavedForOneFilterSetReadsNilForAnother() async throws {
      let c = client(try TestData.fixture("transactions"))
      _ = try await c.transactions(TransactionQuery(), page: 1)
      var other = TransactionQuery()
      other.showLinked = true
      #expect(c.savedTransactions(other) == nil)
    }

    @Test func analyticsAreSavedOnlyForTheLaunchRange() async throws {
      let c = client(try TestData.fixture("analytics"))
      let got = try await c.analytics(months: 3, launchRange: 3)
      #expect(c.savedAnalytics(months: 3) == got)
      _ = try await c.analytics(months: 6, launchRange: 3)
      #expect(c.savedAnalytics(months: 6) == nil)
    }

    @Test func anotherRangeLeavesTheLaunchRangeSaved() async throws {
      let c = client(try TestData.fixture("analytics"))
      let launch = try await c.analytics(months: 3, launchRange: 3)
      _ = try await c.analytics(months: 12, launchRange: 3)
      #expect(c.savedAnalytics(months: 3) == launch)
    }

    @Test func anAnswerForARangeLeftWhileItLoadedIsNotSaved() async throws {
      let body = try TestData.fixture("analytics")
      let cache = ResponseCache(
        root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
      let gate = Gate { _ in true }
      let c = APIClient(
        baseURL: base, session: StubURLProtocol.session({ _ in (200, body) }, gates: [gate]),
        token: "sample-token", cache: cache)
      let picked = RangeBox(3)
      let slow = Task { try await c.analytics(months: 3, launchRange: { picked.value }) }
      await gate.arrival()
      picked.value = 6  // the user picks 6 months meanwhile
      gate.open()
      _ = try await slow.value
      #expect(c.savedAnalytics(months: 3) == nil)
    }

    @Test func aPickedLaunchRangeReplacesTheOldRangesCopy() async throws {
      let c = client(try TestData.fixture("analytics"))
      _ = try await c.analytics(months: 3, launchRange: 3)
      let picked = try await c.analytics(months: 12, launchRange: 12)
      #expect(c.savedAnalytics(months: 12) == picked)
      #expect(c.savedAnalytics(months: 3) == nil)
    }

    @Test func cashflowIsSaved() async throws {
      let c = client(try TestData.fixture("cashflow"))
      let got = try await c.cashflow()
      #expect(c.savedCashflow() == got)
    }

    @Test func spendingIsSaved() async throws {
      let c = client(try TestData.fixture("spending"))
      let got = try await c.spending()
      #expect(c.savedSpending() == got)
    }

    @Test func subscriptionsAreSaved() async throws {
      let c = client(try TestData.fixture("subscriptions"))
      let got = try await c.subscriptions()
      #expect(c.savedSubscriptions() == got)
    }

    @Test func cardsAreSaved() async throws {
      let c = client(try TestData.fixture("user-cards"))
      let got = try await c.userCards()
      #expect(c.savedUserCards() == got)
    }

    @Test func uiStateReadsSaveNothing() async throws {
      let c = client(Data(#"{"value":"pro"}"#.utf8))
      for key in [ProMode.key, ProMode.legacyKey] {
        #expect(try await c.uiState(key).isStored)
        #expect(c.savedUIState(key) == nil)
      }
      #expect(files(c).isEmpty)
    }

    @Test func theSettledModeIsSavedUnderTheProModeKeyOnly() {
      let c = client(Data())
      c.saveUIState(ProMode.key, string: "pro")
      #expect(c.savedUIState(ProMode.key)?.string == "pro")
      c.saveUIState(ProMode.legacyKey, string: "pro")
      #expect(c.savedUIState(ProMode.legacyKey) == nil)
      #expect(files(c).count == 1)
    }

    @Test func otherUIStateKeysSaveNothing() async throws {
      let c = client(Data(#"{"value":"500"}"#.utf8))
      _ = try await c.uiState("spendingMonthlyLimit")
      #expect(files(c).isEmpty)
      #expect(c.savedUIState("spendingMonthlyLimit") == nil)
    }
  }
}

/// A launch range a test changes while a request is in flight.
final class RangeBox: @unchecked Sendable {
  var value: Int
  init(_ value: Int) { self.value = value }
}
