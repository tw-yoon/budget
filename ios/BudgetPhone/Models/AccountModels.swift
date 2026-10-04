import Foundation

// Mirrors of src/types/index.ts. Property names match the JSON keys exactly,
// so Codable needs no key mapping. Dates stay ISO strings, as they do in the
// web code; Formatters.parseISO reads them where they are used.

struct AccountDTO: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let name: String
  let officialName: String?
  let mask: String?
  let type: String  // DEPOSITORY | CREDIT | INVESTMENT | LOAN | OTHER
  let subtype: String?
  let currentBalance: Double
  let availableBalance: Double?
  let balanceFetchedAt: String
  let institution: String
  let isLiability: Bool
  let nextPaymentDueDate: String?
  let lastStatementBalance: Double?
  let minimumPaymentAmount: Double?
  let paymentIsOverdue: Bool?
  let displayName: String?
  let manualDueDay: Int?
  let manualCreditLimit: Double?
  /// The account's bank is disconnected: still listed, its balance frozen
  /// as of `balanceFetchedAt`, counted in no total. False when the server
  /// predates the key.
  var disconnected = false
}

extension AccountDTO {
  private enum CodingKeys: String, CodingKey {
    case id, name, officialName, mask, type, subtype, currentBalance, availableBalance
    case balanceFetchedAt, institution, isLiability, nextPaymentDueDate, lastStatementBalance
    case minimumPaymentAmount, paymentIsOverdue, displayName, manualDueDay, manualCreditLimit
    case disconnected
  }

  // Written out only so `disconnected` may be absent; in an extension, so
  // the memberwise initializer stays.
  init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    officialName = try c.decodeIfPresent(String.self, forKey: .officialName)
    mask = try c.decodeIfPresent(String.self, forKey: .mask)
    type = try c.decode(String.self, forKey: .type)
    subtype = try c.decodeIfPresent(String.self, forKey: .subtype)
    currentBalance = try c.decode(Double.self, forKey: .currentBalance)
    availableBalance = try c.decodeIfPresent(Double.self, forKey: .availableBalance)
    balanceFetchedAt = try c.decode(String.self, forKey: .balanceFetchedAt)
    institution = try c.decode(String.self, forKey: .institution)
    isLiability = try c.decode(Bool.self, forKey: .isLiability)
    nextPaymentDueDate = try c.decodeIfPresent(String.self, forKey: .nextPaymentDueDate)
    lastStatementBalance = try c.decodeIfPresent(Double.self, forKey: .lastStatementBalance)
    minimumPaymentAmount = try c.decodeIfPresent(Double.self, forKey: .minimumPaymentAmount)
    paymentIsOverdue = try c.decodeIfPresent(Bool.self, forKey: .paymentIsOverdue)
    displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
    manualDueDay = try c.decodeIfPresent(Int.self, forKey: .manualDueDay)
    manualCreditLimit = try c.decodeIfPresent(Double.self, forKey: .manualCreditLimit)
    disconnected = try c.decodeIfPresent(Bool.self, forKey: .disconnected) ?? false
  }
}

struct AccountGroup: Codable, Identifiable, Equatable, Sendable {
  let type: String
  let label: String
  let subtotal: Double
  let isLiability: Bool
  let accounts: [AccountDTO]

  var id: String { type }
  /// Liability groups print negative, as on the web.
  var signedSubtotal: Double { isLiability ? -subtotal : subtotal }
}

struct AccountsSummary: Codable, Equatable, Sendable {
  let totalAssets: Double
  let totalLiabilities: Double
  let netWorth: Double
  let accountCount: Int
  let lastRefreshed: String?
}

/// GET /api/accounts. The response also carries `banks` and `debitCards`,
/// which the phone does not use and so does not decode.
struct AccountsResponse: Codable, Equatable, Sendable {
  let groups: [AccountGroup]
  let summary: AccountsSummary
}

/// POST /api/plaid/refresh-balances. Only the per-bank failures matter here;
/// `updated` and `liabilities` are ignored.
struct RefreshResult: Decodable, Equatable, Sendable {
  struct ItemError: Decodable, Equatable, Sendable {
    let itemId: String
    let institution: String
    let error: String
  }
  let errors: [ItemError]
}

extension AccountDTO {
  var isCredit: Bool { type == "CREDIT" }
  var title: String { displayName ?? name }

  /// "··1234 · checking · Chase" — the web card's second line.
  var subtitle: String {
    [mask.map { "··\($0)" }, subtype ?? type.lowercased(), institution]
      .compactMap { $0 }
      .joined(separator: " · ")
  }

  /// "Disconnected · as of Sep 26, 2026" under a disconnected bank's
  /// account (the web card's line, ../src/components/AccountCard.tsx).
  func disconnectedLine(calendar: Calendar = .current) -> String? {
    guard disconnected else { return nil }
    guard let at = Formatters.parseISO(balanceFetchedAt) else { return "Disconnected" }
    return "Disconnected \u{00B7} as of \(Formatters.date(at, calendar: calendar))"
  }

  var signedBalance: Double { isLiability ? -currentBalance : currentBalance }

  /// A manual credit limit derives available credit; otherwise Plaid's figure.
  var available: Double? {
    manualCreditLimit.map { $0 - currentBalance } ?? availableBalance
  }

  var availableLabel: String { isLiability ? "Available credit" : "Available" }

  /// The phone shows "Available" only when it adds something. For most cash
  /// accounts it equals the balance, and repeating it squeezes the name on a
  /// 402pt screen. (The web always shows it; it has the width.)
  var availableWorthShowing: Double? {
    guard let available, abs(available - currentBalance) >= 0.005 else { return nil }
    return available
  }
}
