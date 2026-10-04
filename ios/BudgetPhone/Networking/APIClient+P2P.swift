import Foundation

extension APIClient {
  func p2p(_ source: P2PSource) async throws(APIError) -> P2PResponse {
    try decode(await send("GET", source.endpoint, timeout: 15))
  }

  func setP2PCategory(_ source: P2PSource, id: String, category: String) async throws(APIError) {
    _ = try await send(
      "PATCH", "\(source.endpoint)/\(id)", body: encode(P2PCategoryUpdate(userCategory: category)),
      timeout: 15)
  }

  /// The server reads the CSVs from its own Downloads folder.
  func importP2P(_ source: P2PSource) async throws(APIError) -> P2PImportResult {
    try decode(await send("POST", "\(source.endpoint)/import", timeout: 60))
  }
}
