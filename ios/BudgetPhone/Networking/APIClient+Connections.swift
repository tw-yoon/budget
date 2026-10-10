import Foundation

// Settings → Connections (../src/app/api/debit-cards/**,
// ../src/app/api/plaid/items/[itemId]/**). Connecting a bank (Plaid Link)
// stays on the Mac, so the link-token routes have no calls here.

extension APIClient {
  /// GET /api/accounts, read for its `banks`, `debitCards` and checking accounts.
  /// Saved under Accounts' name: the same GET, so either screen opens with
  /// whichever loaded last.
  func connections() async throws(APIError) -> ConnectionsResponse {
    try await get("api/accounts", timeout: 15, saveAs: "accounts")
  }

  func savedConnections() -> ConnectionsResponse? { saved("accounts", "api/accounts") }

  /// POST /api/debit-cards — `{ name, last4, accountId }`.
  func addDebitCard(_ card: NewDebitCard) async throws(APIError) {
    _ = try await send("POST", "api/debit-cards", body: encode(card), timeout: 15)
  }

  /// DELETE /api/debit-cards/:id.
  func removeDebitCard(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/debit-cards/\(id)", timeout: 15)
  }

  /// DELETE /api/plaid/items/:itemId — revokes the Plaid item and deletes
  /// its token; its accounts and transactions stay. It calls Plaid, hence
  /// the long timeout.
  func disconnectBank(itemId: String) async throws(APIError) {
    _ = try await send("DELETE", "api/plaid/items/\(itemId)", timeout: 60)
  }

  /// DELETE /api/plaid/items/:itemId/history — removes everything the bank
  /// recorded (accounts, transactions, sync logs, the item). A connected
  /// bank is disconnected first, which calls Plaid, hence the long timeout.
  func deleteBankHistory(itemId: String) async throws(APIError) {
    _ = try await send("DELETE", "api/plaid/items/\(itemId)/history", timeout: 60)
  }
}
