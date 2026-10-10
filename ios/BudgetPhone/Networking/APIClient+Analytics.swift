import Foundation

extension APIClient {
  /// GET /api/analytics?months=N — the summary cards (AnalyticsDashboard).
  /// `launchRange` is the range the tab opens on next (AnalyticsRange),
  /// read when the answer arrives.
  func analytics(
    months: Int, launchRange: @escaping @Sendable () -> Int
  ) async throws(APIError) -> AnalyticsResult {
    // Only the range the app opens on is saved; another range would replace
    // it and leave the next launch with nothing to show. When the picked
    // range changes, its first answer replaces the old range's copy; until
    // then a launch has no saved summary and the cards wait for the server.
    // Asked on arrival: a slow answer for a range the user has since left
    // must not replace the new range's copy.
    try await get(
      "api/analytics", query: Self.monthsQuery(months), timeout: 15,
      saveAs: "analytics", saveIf: { months == launchRange() })
  }

  func analytics(months: Int, launchRange: Int) async throws(APIError) -> AnalyticsResult {
    try await analytics(months: months, launchRange: { launchRange })
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
