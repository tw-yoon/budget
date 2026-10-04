import Foundation

extension APIClient {
  func transactions(_ query: TransactionQuery, page: Int) async throws(APIError) -> TransactionsResponse {
    // Only the first page of an unsearched ledger is saved: it is what the
    // screen opens with. Later pages and searches are never shown at launch.
    try await get(
      "api/transactions", query: query.queryItems(page: page), timeout: 15,
      saveAs: page == 1 && !query.hasSearch ? "ledger" : nil)
  }

  /// The first page last saved for exactly this filter set; nil for a search.
  func savedTransactions(_ query: TransactionQuery) -> TransactionsResponse? {
    query.hasSearch ? nil : saved("ledger", "api/transactions", query: query.queryItems(page: 1))
  }

  /// Pulls new transactions from Plaid for every linked bank. A bank that
  /// fails comes back in the summary; the call itself still succeeds.
  func syncTransactions() async throws(APIError) -> SyncResult {
    try decode(await send("POST", "api/plaid/sync", body: Data("{}".utf8), timeout: 120))
  }

  func updateCategory(transactionId: String, _ update: CategoryUpdate) async throws(APIError) {
    _ = try await send("PATCH", "api/transactions/\(transactionId)", body: encode(update), timeout: 15)
  }

  func updateLink(transactionId: String, _ update: LinkUpdate) async throws(APIError) {
    _ = try await send("PATCH", "api/transactions/\(transactionId)", body: encode(update), timeout: 15)
  }

  func linkCandidates(transactionId: String) async throws(APIError) -> [LinkCandidate] {
    let r: LinkCandidatesResponse = try decode(
      await send("GET", "api/transactions/\(transactionId)/link-candidates", timeout: 15))
    return r.candidates
  }

  func addSplit(transactionId: String, _ split: NewSplit) async throws(APIError) {
    _ = try await send("POST", "api/transactions/\(transactionId)/splits", body: encode(split), timeout: 15)
  }

  func deleteSplit(transactionId: String, splitId: String) async throws(APIError) {
    _ = try await send("DELETE", "api/transactions/\(transactionId)/splits/\(splitId)", timeout: 15)
  }

  func categories() async throws(APIError) -> CategoriesResponse {
    try decode(await send("GET", "api/categories", timeout: 15))
  }

  /// GET /api/ui-state?key= → `{ value }`.
  func uiState(_ key: String) async throws(APIError) -> UIStateValue {
    // Only the Pro-mode keys are saved: they decide which screens open.
    try await get(
      "api/ui-state", query: [URLQueryItem(name: "key", value: key)], timeout: 15,
      saveAs: Self.savesUIState(key) ? "ui-state-\(key)" : nil)
  }

  func savedUIState(_ key: String) -> UIStateValue? {
    Self.savesUIState(key)
      ? saved("ui-state-\(key)", "api/ui-state", query: [URLQueryItem(name: "key", value: key)]) : nil
  }

  private static func savesUIState(_ key: String) -> Bool {
    key == ProMode.key || key == ProMode.legacyKey
  }
}

/// `{ value: <any JSON> }` from the shared ui-state store, a plain JSON file
/// anything can write. The web's loadSynced treats only null (or a missing
/// key) as "nothing stored"; any other value counts as stored, even one that
/// isn't a string — which resolveProMode then reads as Normal.
struct UIStateValue: Decodable, Equatable, Sendable {
  /// False when the store has nothing (null) under the key.
  let isStored: Bool
  /// The value when it is a string.
  let string: String?
  /// The value as a number, by SpendingGraph's rule: a JSON number, or a
  /// non-empty string that reads as a finite number.
  let number: Double?

  private enum CodingKeys: String, CodingKey { case value }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    if try !c.contains(.value) || c.decodeNil(forKey: .value) {
      isStored = false
      string = nil
      number = nil
    } else {
      isStored = true
      string = try? c.decode(String.self, forKey: .value)
      if let n = try? c.decode(Double.self, forKey: .value) {
        number = n
      } else if let s = string, !s.isEmpty, let n = Double(s), n.isFinite {
        number = n
      } else {
        number = nil
      }
    }
  }
}
