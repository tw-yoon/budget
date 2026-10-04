import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Rules: each call's method, path and exact body.
  @Suite(.serialized)
  struct RulesAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    func only() throws -> URLRequest {
      #expect(StubURLProtocol.requests.count == 1)
      return try #require(StubURLProtocol.requests.first)
    }

    /// The body as an NSDictionary, so the comparison covers every key.
    func body(_ r: URLRequest) throws -> NSDictionary {
      let data = try #require(StubURLProtocol.body(of: r))
      return try #require(try JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    @Test func getDecodesTheFixture() async throws {
      let c = client { _ in (200, try TestData.fixture("rules")) }
      let r = try await c.rules()
      #expect(r.rules.count == 2)
      let req = try only()
      #expect(req.httpMethod == "GET")
      #expect(req.url?.path() == "/api/rules")
    }

    @Test func createSendsTheFourFields() async throws {
      let c = client { _ in (201, Data(#"{"rule":{"id":"r9"}}"#.utf8)) }
      try await c.createRule(NewRule(
        field: "EITHER", matchType: "CONTAINS", pattern: "Sample Mart", category: "Sample Groceries > Snacks"))
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/rules")
      #expect(try body(r) == [
        "field": "EITHER", "matchType": "CONTAINS", "pattern": "Sample Mart",
        "category": "Sample Groceries > Snacks",
      ] as NSDictionary)
    }

    @Test func setCategorySendsOnlyTheCategory() async throws {
      let c = client { _ in (200, Data(#"{"rule":{"id":"r1"}}"#.utf8)) }
      try await c.setRuleCategory(id: "r1", "Example Dining")
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/rules/r1")
      #expect(try body(r) == ["category": "Example Dining"] as NSDictionary)
    }

    @Test func setEnabledSendsOnlyEnabled() async throws {
      let c = client { _ in (200, Data(#"{"rule":{"id":"r1"}}"#.utf8)) }
      try await c.setRuleEnabled(id: "r1", false)
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/rules/r1")
      #expect(try body(r) == ["enabled": false] as NSDictionary)
    }

    @Test func deleteSendsNoBody() async throws {
      let c = client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      try await c.deleteRule(id: "r1")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/rules/r1")
      #expect(StubURLProtocol.body(of: r) == nil)
    }

    @Test func applyPostsAnEmptyObject() async throws {
      let c = client { _ in (200, Data(#"{"updated":12,"kept":3}"#.utf8)) }
      let result = try await c.applyRules()
      #expect(result == ApplyResult(updated: 12, kept: 3))
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/rules/apply")
      #expect(try body(r) == [:] as NSDictionary)
    }

    @Test func takeOverPostsAnEmptyObject() async throws {
      let c = client { _ in (200, Data(#"{"updated":3}"#.utf8)) }
      let result = try await c.takeOverRule(id: "r1")
      #expect(result == TakeOverResult(updated: 3))
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/rules/r1/take-over")
      #expect(try body(r) == [:] as NSDictionary)
    }

    @Test func takeOverOfARuleThatIsOffCarriesTheServerMessage() async throws {
      let c = client { _ in (404, Data(#"{"error":"That rule is off or gone"}"#.utf8)) }
      await #expect(throws: APIError.server(status: 404, message: "That rule is off or gone")) {
        try await c.takeOverRule(id: "r2")
      }
    }
  }
}
