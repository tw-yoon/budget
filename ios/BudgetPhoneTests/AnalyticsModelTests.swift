import Foundation
import Testing
@testable import BudgetPhone

struct AnalyticsModelTests {
  @Test func decodesTheSummaryAndIgnoresTheRest() throws {
    let result = try JSONDecoder().decode(AnalyticsResult.self, from: TestData.fixture("analytics"))
    #expect(result.summary == AnalyticsSummary(totalSpent: 1840.5, totalIncome: 3200, net: 1359.5, txCount: 42))
    #expect(result.rangeMonths == 6)
    #expect(result.topMerchants == [MerchantTotal(name: "Sample Mart", amount: 120, count: 3)])
  }

  @Test func topMerchantsAreOptionalAndCountPurchases() throws {
    let json = #"{"summary":{"totalSpent":1,"totalIncome":1,"net":0,"txCount":1},"rangeMonths":3}"#
    #expect(try JSONDecoder().decode(AnalyticsResult.self, from: Data(json.utf8)).topMerchants == nil)
    #expect(TopMerchantsCard.countLabel(1) == "1 purchase")
    #expect(TopMerchantsCard.countLabel(3) == "3 purchases")
  }

  @Test func decodesCashflowMonthsAndTotalsThem() throws {
    let series = try JSONDecoder().decode(CashflowSeries.self, from: TestData.fixture("cashflow"))
    #expect(series.months.map(\.key) == ["2026-07", "2026-08"])
    #expect(series.months[0].label == "Jul 2026")
    #expect(series.months[0].totalIncome == 3050)
    #expect(series.months[0].totalSpent == 330)
    #expect(series.months[1].totalIncome == 0)
    #expect(series.months[1].spend == [CashflowMonth.Spend(category: "Travel", amount: 500)])
    #expect(series.months[0].spend[0].subs == [CashflowMonth.Sub(name: "Sample Mart", amount: 100)])
    #expect(series.months[0].spend[1].subs == nil)
  }

  @Test func decodesDailySpend() throws {
    let series = try JSONDecoder().decode(SpendingSeries.self, from: TestData.fixture("spending"))
    #expect(series.days == [
      DailySpend(date: "2026-07-01", amount: 100), DailySpend(date: "2026-07-03", amount: 50.25),
    ])
  }

  private func stored(_ json: String) throws -> UIStateValue {
    try JSONDecoder().decode(UIStateValue.self, from: Data(json.utf8))
  }

  /// SpendingGraph accepts `v != null && v !== "" && !isNaN(Number(v))`.
  @Test func uiStateNumberFollowsTheWebsRule() throws {
    #expect(try stored(#"{"value":2500}"#).number == 2500)
    #expect(try stored(#"{"value":"1800"}"#).number == 1800)
    #expect(try stored(#"{"value":""}"#).number == nil)
    #expect(try stored(#"{"value":"lots"}"#).number == nil)
    #expect(try stored(#"{"value":"inf"}"#).number == nil)
    #expect(try stored(#"{"value":null}"#).number == nil)
    #expect(try stored(#"{"value":"pro"}"#).string == "pro", "the string reading is unchanged")
  }
}
