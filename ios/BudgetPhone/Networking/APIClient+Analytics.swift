import Foundation

extension APIClient {
  /// GET /api/analytics?months=N — the summary cards (AnalyticsDashboard).
  func analytics(months: Int) async throws(APIError) -> AnalyticsResult {
    // Only the range the app opens on is saved; another range would replace
    // it and leave the next launch with nothing to show.
    try await get(
      "api/analytics", query: Self.monthsQuery(months), timeout: 15,
      saveAs: months == AnalyticsStore.launchRange ? "analytics" : nil)
  }

  func savedAnalytics(months: Int) -> AnalyticsResult? {
    saved("analytics", "api/analytics", query: Self.monthsQuery(months))
  }

  private static func monthsQuery(_ months: Int) -> [URLQueryItem] {
    [URLQueryItem(name: "months", value: String(months))]
  }

  /// GET /api/analytics/cashflow — 24 months; the category and trend charts
  /// window over it on the phone, as useCashflow does on the web.
  func cashflow() async throws(APIError) -> CashflowSeries {
    try await get("api/analytics/cashflow", timeout: 30, saveAs: "cashflow")
  }

  func savedCashflow() -> CashflowSeries? { saved("cashflow", "api/analytics/cashflow") }

  /// GET /api/analytics/spending — daily spend for the cumulative graph.
  func spending() async throws(APIError) -> SpendingSeries {
    try await get("api/analytics/spending", timeout: 30, saveAs: "spending")
  }

  func savedSpending() -> SpendingSeries? { saved("spending", "api/analytics/spending") }
}
