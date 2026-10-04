import Foundation

/// One row of GET /api/venmo or /api/zelle — P2pCategorizer.tsx's P2pTx.
/// `amount` is a magnitude; `direction` says which way it went.
struct P2PTransaction: Codable, Equatable, Sendable, Identifiable {
  enum Direction: String, Codable, Sendable { case `in`, out }
  let id: String
  let label: Int?
  let date: String
  let note: String
  let counterparty: String?
  let direction: Direction
  let amount: Double
  let category: String
  let linkedTo: LinkedTargetDTO?
}

struct P2PResponse: Codable, Equatable, Sendable {
  let transactions: [P2PTransaction]
  let categories: [String]
}

/// POST /api/venmo/import.
struct P2PImportResult: Decodable, Equatable, Sendable {
  let imported: Int
  let reconciledCashouts: Int

  /// The web's notice after an import.
  var notice: String {
    imported > 0
      ? "Imported \(imported) payments · reconciled \(reconciledCashouts) cash-out\(reconciledCashouts == 1 ? "" : "s")."
      : "No statements found in your Downloads folder."
  }
}

/// PATCH /api/venmo/:id or /api/zelle/:id.
struct P2PCategoryUpdate: Encodable, Equatable, Sendable {
  let userCategory: String
}

/// The categorizer's two feeds.
enum P2PSource: String, Sendable, CaseIterable {
  case venmo, zelle

  var title: String { self == .venmo ? "Venmo" : "Zelle" }
  var endpoint: String { "api/\(rawValue)" }
  /// Venmo imports from CSV; Zelle rides the bank feed.
  var canImport: Bool { self == .venmo }
}

extension P2PTransaction {
  /// "+$12.00" in, "−$12.00" out — the web prints a real minus sign here.
  var signedAmount: String { (direction == .in ? "+" : "\u{2212}") + Formatters.currency(amount) }
  var isIgnored: Bool { P2PTotals.ignored.contains(category) }

  /// The row's "#N · date" footnote line — no trailing separator when the
  /// date fails to parse, unlike a plain `?? ""` join would leave.
  var dateLine: String {
    ([
      "#\(label.map(String.init) ?? "—")",
      Formatters.parseISO(date).map { Formatters.date($0) },
    ] as [String?]).compactMap { $0 }.joined(separator: " · ")
  }
}

/// The header figures, over categorized rows only (P2pCategorizer's
/// `totals`: Uncategorized and Transfer don't count as spending).
struct P2PTotals: Equatable, Sendable {
  static let ignored: Set<String> = ["Uncategorized", "Transfer"]

  let sent: Double
  let received: Double
  var net: Double { sent - received }

  init(_ rows: [P2PTransaction]) {
    var out = 0.0, inc = 0.0
    for t in rows where !Self.ignored.contains(t.category) {
      if t.direction == .out { out += t.amount } else { inc += t.amount }
    }
    sent = out
    received = inc
  }
}
