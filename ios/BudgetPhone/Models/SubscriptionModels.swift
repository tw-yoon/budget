import Foundation

// Mirrors of SubscriptionDTO / SubscriptionsResponse in ../src/types/index.ts,
// plus the detect result and the POST body of ../src/app/api/subscriptions.

struct SubscriptionDTO: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let amount: Double
  let cadence: String
  let cadenceLabel: String
  let monthlyCost: Double
  let nextDate: String?
  let merchantName: String?
  let accountName: String?
  let source: String  // MANUAL | AUTO
  let isActive: Bool

  /// The web's "detected" tag (source AUTO); anything else is "manual".
  var isDetected: Bool { source == "AUTO" }

  /// The row's second line (SubscriptionsDashboard Row): cadence, then the
  /// account and next date when present.
  var detailLine: String {
    var parts = [cadenceLabel]
    if let accountName, !accountName.isEmpty { parts.append(accountName) }
    if let next = nextDate.flatMap(Self.nextDateText) { parts.append("next \(next)") }
    return parts.joined(separator: " · ")
  }

  /// "Oct 5, 2026", the stored calendar date as is (see Formatters.zone).
  static func nextDateText(_ iso: String) -> String? {
    Formatters.parseISO(iso).map { Formatters.date($0) }
  }
}

struct SubscriptionsResponse: Decodable, Equatable, Sendable {
  var subscriptions: [SubscriptionDTO]
  let monthlyTotal: Double

  var activeCount: Int { subscriptions.filter(\.isActive).count }

  /// The web page's header line.
  var summary: String { "\(Formatters.currency(monthlyTotal))/mo across \(activeCount) active" }
}

/// POST /api/subscriptions/detect.
struct DetectResult: Decodable, Equatable, Sendable {
  struct Failure: Decodable, Equatable, Sendable {
    let institution: String
    let error: String
  }

  let found: Int
  let errors: [Failure]

  /// SubscriptionsDashboard's detect message.
  var notice: String {
    var text = "Found \(found) recurring charge\(found == 1 ? "" : "s")."
    if !errors.isEmpty {
      text += " (" + errors.map { "\($0.institution): \($0.error)" }.joined(separator: "; ") + ")"
    }
    return text
  }
}

/// The body AddForm posts. `nextDate` is always sent, as null when unset.
struct NewSubscription: Encodable, Equatable, Sendable {
  let name: String
  let amount: Double
  let cadence: String
  let nextDate: String?

  private enum CodingKeys: String, CodingKey { case name, amount, cadence, nextDate }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(amount, forKey: .amount)
    try c.encode(cadence, forKey: .cadence)
    try c.encode(nextDate, forKey: .nextDate)  // Optional → null, not omitted
  }

  /// "2026-10-05", what the web's date input sends.
  static func day(_ date: Date, calendar: Calendar = .current) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04ld-%02ld-%02ld", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
  }
}

/// CADENCES / CADENCE_LABELS (../src/lib/subscriptions.ts).
enum Cadence: String, CaseIterable, Identifiable, Sendable {
  case weekly = "WEEKLY"
  case biweekly = "BIWEEKLY"
  case semiMonthly = "SEMI_MONTHLY"
  case monthly = "MONTHLY"
  case quarterly = "QUARTERLY"
  case yearly = "YEARLY"

  var id: String { rawValue }

  var label: String {
    switch self {
    case .weekly: "Weekly"
    case .biweekly: "Every 2 weeks"
    case .semiMonthly: "Twice a month"
    case .monthly: "Monthly"
    case .quarterly: "Quarterly"
    case .yearly: "Yearly"
    }
  }
}
