import Foundation
import Testing
@testable import BudgetPhone

/// Venmo, Zelle, Categories, Rules and Connections open with the answer
/// saved last time, then refresh in the background — as Subscriptions does.
extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct InstantScreensTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    nonisolated static let venmo = #"""
      {"transactions":[{"id":"v1","label":801,"date":"2026-09-10T12:00:00.000Z","note":"dinner","counterparty":"Sample Friend","direction":"out","amount":40,"category":"Dining","linkedTo":null}],"categories":["Uncategorized","Dining"]}
      """#
    nonisolated static let zelle = #"""
      {"transactions":[{"id":"z1","label":901,"date":"2026-09-11T12:00:00.000Z","note":"","counterparty":"Sample Person","direction":"in","amount":15,"category":"Uncategorized","linkedTo":null}],"categories":["Uncategorized","Dining"]}
      """#

    nonisolated static func answer(_ r: URLRequest) throws -> (Int, Data) {
      switch r.url!.path() {
      case "/api/venmo": (200, Data(venmo.utf8))
      case "/api/zelle": (200, Data(zelle.utf8))
      case "/api/categories": (200, try TestData.fixture("categories-admin"))
      case "/api/rules": (200, try TestData.fixture("rules"))
      case "/api/accounts": (200, try TestData.fixture("connections"))
      default: (404, Data())
      }
    }

    nonisolated static func isGET(_ r: URLRequest) -> Bool { r.httpMethod == "GET" }

    /// `fresh` answers with every "Sample " name renamed "Fresh ", so a test
    /// can tell the server's answer from the one saved before.
    func client(
      _ cache: ResponseCache, gates: [Gate] = [], unreachable: Bool = false, fresh: Bool = false
    ) -> APIClient {
      APIClient(
        baseURL: base,
        session: StubURLProtocol.session(
          { r in
            if unreachable { throw URLError(.cannotConnectToHost) }
            let (status, body) = try Self.answer(r)
            guard fresh else { return (status, body) }
            return (status, Data(String(decoding: body, as: UTF8.self)
              .replacingOccurrences(of: "Sample ", with: "Fresh ").utf8))
          }, gates: gates),
        token: "sample-token", cache: cache)
    }

    static let offline = "Showing saved data — can't reach your Mac."

    // MARK: Venmo and Zelle

    @Test func aLoadedFeedIsSaved() async {
      let cache = TestData.cache()
      let c = client(cache)
      let s = P2PStore(source: .venmo) { c }
      await s.load()
      #expect(s.data != nil)
      #expect(c.savedP2P(.venmo) == s.data)
    }

    @Test func aSavedFeedShowsBeforeTheServerAnswers() async {
      let cache = TestData.cache()
      let first = client(cache)
      await P2PStore(source: .venmo) { first }.load()
      let gate = Gate(Self.isGET)
      let c = client(cache, gates: [gate], fresh: true)
      let s = P2PStore(source: .venmo) { c }
      let load = Task { await s.load() }
      await gate.arrival()
      #expect(s.data?.transactions.first?.counterparty == "Sample Friend")
      #expect(s.isLoading && s.error == nil)
      gate.open()
      await load.value
      #expect(s.data?.transactions.first?.counterparty == "Fresh Friend")
      #expect(!s.isLoading && s.banner == nil)
    }

    @Test func aFailedFeedRefreshKeepsSavedDataAndSaysSo() async {
      let cache = TestData.cache()
      let first = client(cache)
      await P2PStore(source: .zelle) { first }.load()
      let c = client(cache, unreachable: true)
      let s = P2PStore(source: .zelle) { c }
      await s.load()
      #expect(s.data?.transactions.map(\.id) == ["z1"])
      #expect(s.error == nil)
      #expect(s.banner == Self.offline)
    }

    /// Saved rows can be edited before the first GET lands; that older
    /// answer must not put the old category back.
    @Test func aCategoryChangeDuringTheFirstLoadSurvivesItsAnswer() async throws {
      let cache = TestData.cache()
      let first = client(cache)
      await P2PStore(source: .venmo) { first }.load()
      final class Server: @unchecked Sendable {
        var category = "Dining"
        var stale = false
      }
      let server = Server()
      let gate = Gate(Self.isGET)
      let session = StubURLProtocol.session(
        { r in
          if r.httpMethod == "PATCH" {
            server.category = "Travel"
            return (200, Data(#"{"ok":true}"#.utf8))
          }
          let category = server.stale ? "Dining" : server.category
          return (200, Data(Self.venmo.replacingOccurrences(of: "Dining\",\"linkedTo", with: "\(category)\",\"linkedTo").utf8))
        }, gates: [gate])
      let c = APIClient(baseURL: base, session: session, token: "sample-token", cache: cache)
      let s = P2PStore(source: .venmo) { c }
      let load = Task { await s.load() }
      await gate.arrival()
      #expect(s.data?.transactions.first?.category == "Dining")
      await s.setCategory("v1", to: "Travel")
      #expect(s.data?.transactions.first?.category == "Travel")
      server.stale = true  // the held GET was read before the change
      gate.open()
      await load.value
      #expect(s.data?.transactions.first?.category == "Travel")
      #expect(!s.isLoading && s.banner == nil)
    }

    @Test func venmoAndZelleAreSavedSeparately() async {
      let cache = TestData.cache()
      let first = client(cache)
      await P2PStore(source: .venmo) { first }.load()
      let c = client(cache, unreachable: true)
      #expect(c.savedP2P(.zelle) == nil)
      let s = P2PStore(source: .zelle) { c }
      await s.load()
      #expect(s.data == nil)
      #expect(s.banner == nil)
      guard case .unreachable = s.error else {
        Issue.record("expected .unreachable, got \(String(describing: s.error))")
        return
      }
    }

    // MARK: Categories

    @Test func loadedCategoriesAreSaved() async {
      let c = client(TestData.cache())
      let s = CategoriesStore { c }
      await s.load()
      #expect(s.data != nil)
      #expect(c.savedCategories() == s.data)
    }

    @Test func savedCategoriesShowBeforeTheServerAnswers() async {
      let cache = TestData.cache()
      let first = client(cache)
      let saved = CategoriesStore { first }
      await saved.load()
      let gate = Gate(Self.isGET)
      let c = client(cache, gates: [gate], fresh: true)
      let s = CategoriesStore { c }
      let load = Task { await s.load() }
      await gate.arrival()
      #expect(s.data != nil && s.data == saved.data)
      #expect(s.isLoading && s.error == nil)
      gate.open()
      await load.value
      #expect(s.data?.categories.first?.name == "Fresh Groceries")
      #expect(!s.isLoading && s.banner == nil)
    }

    @Test func aFailedCategoriesRefreshKeepsSavedDataAndSaysSo() async {
      let cache = TestData.cache()
      let first = client(cache)
      await CategoriesStore { first }.load()
      let c = client(cache, unreachable: true)
      let s = CategoriesStore { c }
      await s.load()
      #expect(s.data != nil)
      #expect(s.error == nil)
      #expect(s.banner == Self.offline)
    }

    @Test func thePickersCategoriesReadTheSameSavedAnswer() async throws {
      let c = client(TestData.cache())
      _ = try await c.categories()
      #expect(c.savedCategories() != nil)
    }

    // MARK: Rules

    @Test func loadedRulesAreSaved() async {
      let c = client(TestData.cache())
      let s = RulesStore { c }
      await s.load()
      #expect(s.data != nil)
      #expect(c.savedRules() == s.data)
    }

    @Test func savedRulesShowBeforeTheServerAnswers() async {
      let cache = TestData.cache()
      let first = client(cache)
      let saved = RulesStore { first }
      await saved.load()
      let gate = Gate(Self.isGET)
      let c = client(cache, gates: [gate], fresh: true)
      let s = RulesStore { c }
      let load = Task { await s.load() }
      await gate.arrival()
      #expect(s.data != nil && s.data == saved.data)
      #expect(s.isLoading && s.error == nil)
      gate.open()
      await load.value
      #expect(s.data?.rules.first?.pattern == "Fresh Mart")
      #expect(!s.isLoading && s.banner == nil)
    }

    @Test func aFailedRulesRefreshKeepsSavedDataAndSaysSo() async {
      let cache = TestData.cache()
      let first = client(cache)
      await RulesStore { first }.load()
      let c = client(cache, unreachable: true)
      let s = RulesStore { c }
      await s.load()
      #expect(s.data != nil)
      #expect(s.error == nil)
      #expect(s.banner == Self.offline)
    }

    // MARK: Connections

    @Test func loadedConnectionsAreSaved() async {
      let c = client(TestData.cache())
      let s = ConnectionsStore { c }
      await s.load()
      #expect(s.data != nil)
      #expect(c.savedConnections() == s.data)
    }

    @Test func savedConnectionsShowBeforeTheServerAnswers() async {
      let cache = TestData.cache()
      let first = client(cache)
      let saved = ConnectionsStore { first }
      await saved.load()
      let gate = Gate(Self.isGET)
      let c = client(cache, gates: [gate], fresh: true)
      let s = ConnectionsStore { c }
      let load = Task { await s.load() }
      await gate.arrival()
      #expect(s.data != nil && s.data == saved.data)
      #expect(s.isLoading && s.error == nil)
      gate.open()
      await load.value
      #expect(s.data?.debitCards.first?.name == "Fresh Debit")
      #expect(!s.isLoading && s.banner == nil)
    }

    @Test func aFailedConnectionsRefreshKeepsSavedDataAndSaysSo() async {
      let cache = TestData.cache()
      let first = client(cache)
      await ConnectionsStore { first }.load()
      let c = client(cache, unreachable: true)
      let s = ConnectionsStore { c }
      await s.load()
      #expect(s.data != nil)
      #expect(s.error == nil)
      #expect(s.banner == Self.offline)
    }

    /// One GET /api/accounts, one saved copy: Accounts and Connections each
    /// open with whichever loaded last.
    @Test func connectionsShareTheAccountsSavedAnswer() async throws {
      let c = client(TestData.cache())
      let s = ConnectionsStore { c }
      await s.load()
      #expect(c.savedAccounts() != nil)
    }

    @Test func accountsSavedByTheAccountsTabOpenConnections() async throws {
      let body = try TestData.accountsJSON()
      let c = APIClient(
        baseURL: base, session: StubURLProtocol.session { _ in (200, body) },
        token: "sample-token", cache: TestData.cache())
      _ = try await c.accounts()
      let saved = try #require(c.savedConnections())
      #expect(!saved.banks.isEmpty)
    }
  }
}
