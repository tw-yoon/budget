import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// The analytics calls' paths and query, and a numeric ui-state PUT.
  @Suite(.serialized)
  struct AnalyticsAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ json: String) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session { _ in (200, Data(json.utf8)) })
    }

    @Test func analyticsSendsTheRange() async throws {
      let json = String(decoding: try TestData.fixture("analytics"), as: UTF8.self)
      _ = try await client(json).analytics(months: 12, launchRange: 3)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "GET")
      #expect(request.url?.path() == "/api/analytics")
      #expect(TestData.query(of: request, "months") == "12")
    }

    @Test func cashflowAndSpendingPaths() async throws {
      _ = try await client(#"{"months":[],"currentCash":0,"cashAsOf":null}"#).cashflow()
      #expect(StubURLProtocol.requests.first?.url?.path() == "/api/analytics/cashflow")
      _ = try await client(#"{"days":[]}"#).spending()
      #expect(StubURLProtocol.requests.first?.url?.path() == "/api/analytics/spending")
    }

    /// The web's pushSynced sends the limit as a JSON number, not a string.
    @Test func aNumericValueIsSentAsANumber() async throws {
      try await client(#"{"ok":true}"#).putUIState(key: "spendingMonthlyLimit", value: 2500.0)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "PUT")
      let body = try #require(StubURLProtocol.body(of: request))
      let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
      #expect(json.count == 2)
      #expect(json["key"] as? String == "spendingMonthlyLimit")
      #expect(!(json["value"] is String))
      #expect((json["value"] as? NSNumber)?.doubleValue == 2500)
    }
  }
}
