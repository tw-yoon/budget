import Testing
@testable import BudgetPhone

/// SummaryCards.tsx: labels, values and tones.
struct SummaryTileTests {
  @Test func tilesMatchTheWeb() {
    let tiles = SummaryTile.tiles(
      AnalyticsSummary(totalSpent: 1840.5, totalIncome: 3200, net: 1359.5, txCount: 42))
    #expect(tiles.map(\.label) == ["Spent", "Income", "Net", "Transactions"])
    #expect(tiles.map(\.value) == ["$1,840.50", "$3,200.00", "+$1,359.50", "42"])
    #expect(tiles.map(\.tone) == [.neutral, .income, .income, .neutral])
  }

  @Test func aNegativeNetIsRedWithoutAPlus() {
    let net = SummaryTile.tiles(
      AnalyticsSummary(totalSpent: 500, totalIncome: 200, net: -300, txCount: 3))[2]
    #expect(net.value == "-$300.00")
    #expect(net.tone == .spend)
  }

  @Test func zeroNetCountsAsIncome() {
    let net = SummaryTile.tiles(
      AnalyticsSummary(totalSpent: 0, totalIncome: 0, net: 0, txCount: 0))[2]
    #expect(net.value == "+$0.00")
    #expect(net.tone == .income)
  }
}
