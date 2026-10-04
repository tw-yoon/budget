import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Connections: each call's method, path and exact body.
  @Suite(.serialized)
  struct ConnectionsAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    func only() throws -> URLRequest {
      #expect(StubURLProtocol.requests.count == 1)
      return try #require(StubURLProtocol.requests.first)
    }

    func body(_ r: URLRequest) throws -> NSDictionary {
      let data = try #require(StubURLProtocol.body(of: r))
      return try #require(try JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    @Test func connectionsReadsTheAccountsRoute() async throws {
      let c = client { _ in (200, try TestData.fixture("connections")) }
      let d = try await c.connections()
      #expect(d.banks.count == 2)
      let r = try only()
      #expect(r.httpMethod == "GET")
      #expect(r.url?.path() == "/api/accounts")
    }

    @Test func addSendsExactlyTheThreeFields() async throws {
      let c = client { _ in (200, Data(#"{"id":"d9"}"#.utf8)) }
      try await c.addDebitCard(NewDebitCard(name: "Sample Debit", last4: "0002", accountId: "a1"))
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/debit-cards")
      #expect(try body(r) == ["name": "Sample Debit", "last4": "0002", "accountId": "a1"] as NSDictionary)
    }

    @Test func addCarriesTheServerMessage() async throws {
      let c = client { _ in (400, Data(#"{"error":"Last 4 must be exactly 4 digits"}"#.utf8)) }
      await #expect(throws: APIError.server(status: 400, message: "Last 4 must be exactly 4 digits")) {
        try await c.addDebitCard(NewDebitCard(name: "Sample Debit", last4: "12", accountId: "a1"))
      }
    }

    @Test func removeSendsNoBody() async throws {
      let c = client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      try await c.removeDebitCard(id: "d1")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/debit-cards/d1")
      #expect(StubURLProtocol.body(of: r) == nil)
    }

    @Test func deleteHistorySendsNoBodyToTheHistoryRoute() async throws {
      let c = client { _ in
        (200, Data(#"{"ok":true,"institution":"Example Bank","removedAccounts":2,"removedTransactions":41}"#.utf8))
      }
      try await c.deleteBankHistory(itemId: "item-sample-abc123")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/plaid/items/item-sample-abc123/history")
      #expect(StubURLProtocol.body(of: r) == nil)
    }

    @Test func deleteHistoryCarriesTheServerMessage() async throws {
      let c = client { _ in (404, Data(#"{"error":"Bank not found"}"#.utf8)) }
      await #expect(throws: APIError.server(status: 404, message: "Bank not found")) {
        try await c.deleteBankHistory(itemId: "item-sample-gone")
      }
    }

    @Test func disconnectSendsNoBody() async throws {
      let c = client { _ in
        (200, Data(#"{"ok":true,"institution":"Example Bank","disconnectedAt":"2026-09-30T12:00:00.000Z"}"#.utf8))
      }
      try await c.disconnectBank(itemId: "item-sample-abc123")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/plaid/items/item-sample-abc123")
      #expect(StubURLProtocol.body(of: r) == nil)
    }
  }
}
