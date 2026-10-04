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

    @Test func analyticsAreSavedPerRange() async throws {
      let c = client(try TestData.fixture("analytics"))
      let got = try await c.analytics(months: 6)
      #expect(c.savedAnalytics(months: 6) == got)
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

    @Test func proModeKeysAreSaved() async throws {
      let c = client(Data(#"{"value":"pro"}"#.utf8))
      for key in [ProMode.key, ProMode.legacyKey] {
        let got = try await c.uiState(key)
        #expect(got.isStored)
        #expect(c.savedUIState(key) == got)
      }
    }

    @Test func otherUIStateKeysSaveNothing() async throws {
      let c = client(Data(#"{"value":"500"}"#.utf8))
      _ = try await c.uiState("spendingMonthlyLimit")
      #expect(files(c).isEmpty)
      #expect(c.savedUIState("spendingMonthlyLimit") == nil)
    }
  }
}
