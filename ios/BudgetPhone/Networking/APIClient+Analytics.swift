import Foundation

extension APIClient {
  /// GET /api/analytics?months=N — the summary cards (AnalyticsDashboard).
  func analytics(months: Int) async throws(APIError) -> AnalyticsResult {
    try decode(
      await send(
        "GET", "api/analytics", query: [URLQueryItem(name: "months", value: String(months))],
        timeout: 15))
  }

  /// GET /api/analytics/cashflow — 24 months; the category and trend charts
  /// window over it on the phone, as useCashflow does on the web.
  func cashflow() async throws(APIError) -> CashflowSeries {
    try decode(await send("GET", "api/analytics/cashflow", timeout: 30))
  }

  /// GET /api/analytics/spending — daily spend for the cumulative graph.
  func spending() async throws(APIError) -> SpendingSeries {
    try decode(await send("GET", "api/analytics/spending", timeout: 30))
  }
}
