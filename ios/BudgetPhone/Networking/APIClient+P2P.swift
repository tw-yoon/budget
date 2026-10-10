import Foundation

extension APIClient {
  /// GET /api/venmo or /api/zelle, saved per feed for the next open.
  func p2p(_ source: P2PSource) async throws(APIError) -> P2PResponse {
    try await get(source.endpoint, timeout: 15, saveAs: source.rawValue)
  }

  func savedP2P(_ source: P2PSource) -> P2PResponse? { saved(source.rawValue, source.endpoint) }

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
