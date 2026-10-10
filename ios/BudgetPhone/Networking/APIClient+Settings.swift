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

extension APIClient {
  /// GET /api/update — this Mac's version and the published one. `check`
  /// asks the server to look again instead of using its hourly answer.
  func updateStatus(check: Bool = false) async throws(APIError) -> UpdateStatus {
    try await get(
      "api/update", query: check ? [URLQueryItem(name: "check", value: "1")] : [], timeout: 40)
  }

  /// POST /api/update — `{}`; the Mac updates itself and restarts Budget.
  func startUpdate() async throws(APIError) {
    _ = try await send("POST", "api/update", body: Data("{}".utf8), timeout: 15)
  }
}

extension APIClient {
  /// GET /api/update/phone — whether the Mac can reinstall this app, and how
  /// the last reinstall went.
  func phoneUpdateStatus() async throws(APIError) -> PhoneUpdateStatus {
    try await get("api/update/phone", timeout: 15)
  }

  /// POST /api/update/phone — `{}`; the Mac rebuilds this app and installs
  /// it, which closes the app once the install starts.
  func startPhoneUpdate() async throws(APIError) {
    _ = try await send("POST", "api/update/phone", body: Data("{}".utf8), timeout: 15)
  }
}

extension APIClient {
  /// GET /api/update/phone, only to see whether the Mac answers (the
  /// Accounts dot). Not decoded, and not a load time.
  func ping() async throws(APIError) {
    _ = try await send("GET", "api/update/phone", timeout: 10)
  }
}
