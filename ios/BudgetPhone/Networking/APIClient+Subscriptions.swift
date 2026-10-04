import Foundation

extension APIClient {
  /// GET /api/subscriptions — the list (active first, then by name) and the
  /// monthly total of the active ones.
  func subscriptions() async throws(APIError) -> SubscriptionsResponse {
    try decode(await send("GET", "api/subscriptions", timeout: 15))
  }

  /// POST /api/subscriptions — add one manually. A 400 carries the reason.
  func addSubscription(_ subscription: NewSubscription) async throws(APIError) {
    _ = try await send("POST", "api/subscriptions", body: encode(subscription), timeout: 15)
  }

  /// DELETE /api/subscriptions/:id
  func deleteSubscription(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/subscriptions/\(id)", timeout: 15)
  }

  /// POST /api/subscriptions/detect — scans Plaid's recurring streams, so
  /// the long timeout. Banks that fail come back in `errors`.
  func detectSubscriptions() async throws(APIError) -> DetectResult {
    try decode(await send("POST", "api/subscriptions/detect", body: Data("{}".utf8), timeout: 60))
  }
}
