import Foundation

/// The body pushSynced sends (`../src/lib/ui-state.ts`). The value is any
/// JSON: Pro Mode sends a string, the spending limit a number.
private struct UIStatePut<Value: Encodable>: Encodable {
  let key: String
  let value: Value
}

extension APIClient {
  /// PUT /api/ui-state — `{ key, value }`; the value replaces the stored one.
  func putUIState(key: String, value: some Encodable & Sendable) async throws(APIError) {
    _ = try await send(
      "PUT", "api/ui-state", body: encode(UIStatePut(key: key, value: value)), timeout: 15)
  }
}
