import Foundation

// Settings → Connections' view of GET /api/accounts, plus the debit-card
// write body. Mirrors BankSummary and DebitCardDTO in src/types/index.ts.

struct BankSummary: Decodable, Equatable, Sendable, Identifiable {
  let itemId: String
  let institution: String
  let accountCount: Int
  /// Named in the Delete confirm. Nil from a server that predates it.
  let transactionCount: Int?
  /// ISO; nil while connected.
  let disconnectedAt: String?

  var id: String { itemId }
  var isDisconnected: Bool { disconnectedAt != nil }
}

struct DebitCardDTO: Decodable, Equatable, Sendable, Identifiable {
  let id: String
  let name: String
  let last4: String
  let accountId: String
  let accountName: String
  let available: Double?
}

/// GET /api/accounts, read for Connections. `summary` is not needed here, so
/// it is not decoded; the Accounts tab keeps its own `AccountsResponse`.
struct ConnectionsResponse: Decodable, Equatable, Sendable {
  let groups: [AccountGroup]
  let banks: [BankSummary]
  let debitCards: [DebitCardDTO]

  /// The accounts a debit card can draw from — SettingsConnections'
  /// `groups.find(g => g.type === "DEPOSITORY")?.accounts ?? []`.
  var checkingAccounts: [AccountDTO] {
    groups.first { $0.type == "DEPOSITORY" }?.accounts ?? []
  }
}

/// POST /api/debit-cards — the three fields AddForm sends.
struct NewDebitCard: Encodable, Equatable, Sendable {
  let name: String
  let last4: String
  let accountId: String
}
