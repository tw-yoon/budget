import CoreGraphics
import Foundation
import Testing
@testable import BudgetPhone

/// The Analytics charts' entrance: played once per app session, and the
/// progress math the charts draw with.
@MainActor
struct AnalyticsEntranceTests {
  @Test func playsUntilTheFirstLoadWithData() {
    let entrance = AnalyticsEntrance()
    #expect(!entrance.hasPlayed)
    // A full-screen error: nothing was shown, so the entrance still waits.
    entrance.settle(hasData: false)
    #expect(!entrance.hasPlayed)
    entrance.settle(hasData: true)
    #expect(entrance.hasPlayed)
  }

  @Test func neverPlaysAgainInTheSession() {
    let entrance = AnalyticsEntrance()
    entrance.settle(hasData: true)
    // A later failed reload, tab switch or refresh never reopens it.
    entrance.settle(hasData: false)
    entrance.settle(hasData: true)
    #expect(entrance.hasPlayed)
  }

  @Test func staggeredItemsStartInTurnAndFinishTogether() {
    let count = 6
    let starts = (0..<count).map { AnalyticsEntrance.staggered(0, index: $0, count: count) }
    #expect(starts.allSatisfy { $0 == 0 })
    let ends = (0..<count).map { AnalyticsEntrance.staggered(1, index: $0, count: count) }
    #expect(ends.allSatisfy { $0 == 1 })
    let middle = (0..<count).map { AnalyticsEntrance.staggered(0.5, index: $0, count: count) }
    #expect(middle == middle.sorted(by: >))
    #expect(middle.first! > middle.last!)
    // The last item waits for the spread before it starts.
    #expect(AnalyticsEntrance.staggered(0.35, index: count - 1, count: count) == 0)
  }

  @Test func staggeredClampsAndHandlesOneItem() {
    #expect(AnalyticsEntrance.staggered(1.1, index: 0, count: 3) == 1)
    #expect(AnalyticsEntrance.staggered(-0.2, index: 2, count: 3) == 0)
    #expect(AnalyticsEntrance.staggered(0.4, index: 0, count: 1) == 0.4)
  }

  @Test func sankeySweepShowsNothingAtStartAndEverythingAtTheEnd() {
    let month = CashflowSankey.month(
      CashflowMonth(
        key: "2026-06", label: "Jun 2026",
        income: [.init(source: "Sample Payroll", amount: 500)],
        spend: [.init(category: "Travel", amount: 300, subs: [.init(name: "Sample Air", amount: 100)])]))
    let layout = SankeyLayout(month: month, width: 340, height: 372)
    let xs = layout.bands.map(\.node.minX) + [layout.hub.minX]
    let start = layout.reveal(0)
    #expect(xs.allSatisfy { SankeyLayout.revealOpacity(at: $0, reveal: start) == 0 })
    let end = layout.reveal(1)
    #expect(end >= layout.width)
    #expect(xs.allSatisfy { SankeyLayout.revealOpacity(at: $0, reveal: end) == 1 })
    // Halfway, the income column is in and the right-hand columns are not.
    let half = layout.reveal(0.5)
    #expect(SankeyLayout.revealOpacity(at: layout.bands[0].node.minX, reveal: half) == 1)
    #expect(SankeyLayout.revealOpacity(at: layout.bands.last!.node.minX, reveal: half) == 0)
  }
}
