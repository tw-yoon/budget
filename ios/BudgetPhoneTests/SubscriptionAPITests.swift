import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// The subscriptions calls' methods, paths and bodies.
  @Suite(.serialized)
  struct SubscriptionAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ json: String) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session { _ in (200, Data(json.utf8)) })
    }

    func json(_ request: URLRequest) throws -> [String: Any] {
      let body = try #require(StubURLProtocol.body(of: request))
      return try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    @Test func listIsAGet() async throws {
      _ = try await client(#"{"subscriptions":[],"monthlyTotal":0}"#).subscriptions()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "GET")
      #expect(request.url?.path() == "/api/subscriptions")
    }

    @Test func addSendsExactlyTheFourFields() async throws {
      try await client(#"{"id":"new"}"#).addSubscription(
        NewSubscription(name: "Sample Stream", amount: 15.49, cadence: "MONTHLY", nextDate: "2026-10-05"))
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "POST")
      #expect(request.url?.path() == "/api/subscriptions")
      let body = try json(request)
      #expect(Set(body.keys) == ["name", "amount", "cadence", "nextDate"])
      #expect(body["name"] as? String == "Sample Stream")
      #expect(!(body["amount"] is String))
      #expect((body["amount"] as? NSNumber)?.doubleValue == 15.49)
      #expect(body["cadence"] as? String == "MONTHLY")
      #expect(body["nextDate"] as? String == "2026-10-05")
    }

    @Test func noNextDateIsSentAsNull() async throws {
      try await client(#"{"id":"new"}"#).addSubscription(
        NewSubscription(name: "Sample Stream", amount: 5, cadence: "YEARLY", nextDate: nil))
      let body = try json(#require(StubURLProtocol.requests.first))
      #expect(Set(body.keys) == ["name", "amount", "cadence", "nextDate"])
      #expect(body["nextDate"] is NSNull)
    }

    @Test func deleteHitsTheId() async throws {
      try await client(#"{"ok":true}"#).deleteSubscription(id: "s1")
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "DELETE")
      #expect(request.url?.path() == "/api/subscriptions/s1")
    }

    @Test func detectIsAPostWithAnEmptyBody() async throws {
      let result = try await client(#"{"found":2,"errors":[]}"#).detectSubscriptions()
      #expect(result.found == 2)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "POST")
      #expect(request.url?.path() == "/api/subscriptions/detect")
      #expect(try json(request).isEmpty)
    }
  }
}
