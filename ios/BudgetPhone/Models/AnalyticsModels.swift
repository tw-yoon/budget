import Foundation

// Mirrors of the analytics types in ../src/types/index.ts. Only what the
// phone draws is decoded; byCategory, byMonth and the Sankey's cash fields
// are left out.

struct AnalyticsSummary: Decodable, Equatable, Sendable {
  let totalSpent: Double
  let totalIncome: Double
  let net: Double
  let txCount: Int
}

/// MerchantTotal: one of the range's top five merchants by spend.
struct MerchantTotal: Decodable, Equatable, Sendable {
  let name: String
  let amount: Double
  let count: Int
}

/// GET /api/analytics?months=N: the summary cards and Top merchants.
struct AnalyticsResult: Decodable, Equatable, Sendable {
  let summary: AnalyticsSummary
  /// Biggest spend first, at most five. Optional so an older server that
  /// omits it still decodes.
  let topMerchants: [MerchantTotal]?
  let rangeMonths: Int
}

/// One month of GET /api/analytics/cashflow.
struct CashflowMonth: Decodable, Equatable, Sendable {
  struct Income: Decodable, Equatable, Sendable {
    let source: String
    let amount: Double
  }
  struct Spend: Decodable, Equatable, Sendable {
    let category: String
    let amount: Double
    /// Named-subcategory totals, present when some of this category's
    /// spend is subcategorized; the rest of `amount` is not.
    var subs: [Sub]? = nil
  }
  struct Sub: Decodable, Equatable, Sendable {
    let name: String
    let amount: Double
  }

  let key: String  // YYYY-MM
  let label: String  // "Jun 2026"
  let income: [Income]
  let spend: [Spend]

  /// MonthlyTrendChart's `income`.
  var totalIncome: Double { income.reduce(0) { $0 + $1.amount } }
  /// MonthlyTrendChart's `spent`.
  var totalSpent: Double { spend.reduce(0) { $0 + $1.amount } }
}

struct CashflowSeries: Decodable, Equatable, Sendable {
  let months: [CashflowMonth]  // oldest first
}

/// One day of GET /api/analytics/spending: net spend that day.
struct DailySpend: Decodable, Equatable, Sendable {
  let date: String  // YYYY-MM-DD
  let amount: Double
  /// The part of `amount` in Rent and Utilities; nil from an older server.
  var rentAndUtilities: Double? = nil
}

struct SpendingSeries: Decodable, Equatable, Sendable {
  let days: [DailySpend]  // oldest first, days with activity only
}
