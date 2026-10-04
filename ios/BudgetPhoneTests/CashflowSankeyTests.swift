import CoreGraphics
import Foundation
import SwiftUI
import Testing
@testable import BudgetPhone

/// buildModel / foldTail in ../src/components/charts/CashFlowSankey.tsx.
struct CashflowSankeyTests {
  private func month(
    income: [(String, Double)], spend: [(String, Double)],
    subs: [String: [(String, Double)]] = [:]
  ) -> CashflowMonth {
    CashflowMonth(
      key: "2026-06", label: "Jun 2026",
      income: income.map { .init(source: $0.0, amount: $0.1) },
      spend: spend.map {
        .init(category: $0.0, amount: $0.1, subs: subs[$0.0]?.map { .init(name: $0.0, amount: $0.1) })
      })
  }

  @Test func surplusFlowsToSavings() {
    let m = CashflowSankey.month(month(income: [("Sample Payroll", 3000)], spend: [("Groceries", 1000)]))
    #expect(m.inflow.map(\.name) == ["Sample Payroll"])
    #expect(m.outflow.map(\.name) == ["Groceries", "To savings"])
    #expect(m.outflow.last?.amount == 2000)
    #expect(m.outflow.last?.hex == CategoryColors.saved)
    #expect(m.hubTotal == 3000)
    #expect(m.drawn == -2000)
  }

  @Test func deficitDrawsFromSavings() {
    let m = CashflowSankey.month(month(income: [("Sample Payroll", 500)], spend: [("Travel", 800)]))
    #expect(m.inflow.map(\.name) == ["Sample Payroll", "Savings"])
    #expect(m.inflow.last?.amount == 300)
    #expect(m.inflow.last?.hex == CategoryColors.draw)
    #expect(m.outflow.map(\.name) == ["Travel"])
    #expect(m.hubTotal == 800)
    #expect(m.drawn == 300)
  }

  @Test func balancedMonthHasNeitherSavingsNode() {
    let m = CashflowSankey.month(month(income: [("Sample Payroll", 100)], spend: [("Dining", 100)]))
    #expect(m.inflow.count == 1 && m.outflow.count == 1)
  }

  @Test func spendPastTheTopSevenFoldsIntoOther() {
    let spend = (1...9).map { ("Category \($0)", Double(100 - $0)) }
    let m = CashflowSankey.month(month(income: [], spend: spend))
    #expect(m.outflow.count == 8)
    #expect(m.outflow.first { $0.name == "Other" }?.amount == 183.0)
    #expect(m.outflow.map(\.amount) == m.outflow.map(\.amount).sorted(by: >))
  }

  @Test func foldTailAddsToAnExistingOther() {
    let spend = [("Other", 50.0)] + (1...8).map { ("Category \($0)", Double(100 - $0)) }
    let m = CashflowSankey.month(month(income: [], spend: spend))
    // Top seven: Other (50) plus six categories; the last two fold into Other.
    #expect(m.outflow.count == 7)
    #expect(m.outflow.first { $0.name == "Other" }?.amount == 235.0)  // 50 + 93 + 92
    #expect(m.outflow.first?.name == "Other")
  }

  @Test func incomePastTheTopFiveFoldsIntoOtherIncome() {
    let income = (1...6).map { ("Source \($0)", Double(10 - $0)) }
    let m = CashflowSankey.month(month(income: income, spend: []))
    #expect(m.inflow.map(\.name).last == "Other income")
    #expect(m.inflow.count == 6)
  }

  @Test func truncateAndShortLabel() {
    #expect(CashflowSankey.truncate("Entertainment", 10) == "Entertain…")
    #expect(CashflowSankey.truncate("Dining", 10) == "Dining")
    #expect(CashflowSankey.shortLabel("Jun 2026") == "Jun '26")
  }

  @Test func layoutFillsTheHubFromBothSides() {
    let m = CashflowSankey.month(month(income: [("Sample Payroll", 500)], spend: [("Travel", 800)]))
    let layout = SankeyLayout(month: m, width: 340, height: 372)
    let hubH = m.hubTotal * layout.scale
    let inH = m.inflow.reduce(0) { $0 + $1.amount * layout.scale }
    #expect(abs(inH - hubH) < 0.001)
    #expect(layout.band(at: CGPoint(x: layout.hub.midX, y: layout.hub.midY))?.name == "Total cash flow")
    let travel = layout.bands.first { $0.name == "Travel" }!
    #expect(layout.band(at: CGPoint(x: travel.node.midX, y: travel.node.midY)) == travel)
  }

  @Test func foldTailKeepsSubs() {
    let m = CashflowSankey.month(
      month(income: [], spend: [("Groceries", 100)], subs: ["Groceries": [("Sample Mart", 40)]]))
    #expect(m.outflow[0].subs == [CashflowMonth.Sub(name: "Sample Mart", amount: 40)])
  }

  @Test func withoutSubsThereIsNoSubStage() {
    let m = CashflowSankey.month(month(income: [("Sample Payroll", 500)], spend: [("Travel", 800)]))
    let layout = SankeyLayout(month: m, width: 340, height: 372)
    #expect(!layout.hasSubStage)
    #expect(layout.bands.allSatisfy { $0.parent == nil })
  }

  /// One month only, so the branch stage shows at a phone's width (the web
  /// needs 560 px).
  @Test func subcategoriesBranchWithTheRemainderAsOther() {
    let m = CashflowSankey.month(
      month(
        income: [("Sample Payroll", 1000)],
        spend: [("Groceries", 300), ("Dining", 200), ("Travel", 100)],
        subs: ["Groceries": [("Sample Mart", 120), ("Example Market", 80)], "Dining": [("Coffee", 200)]]))
    let layout = SankeyLayout(month: m, width: 340, height: 372)
    #expect(layout.hasSubStage)
    let groceries = layout.bands.filter { $0.parent == "Groceries" }
    #expect(groceries.map(\.name) == ["Sample Mart", "Example Market", "Other"])
    #expect(groceries.map(\.amount) == [120, 80, 100])
    #expect(groceries.map(\.faded) == [false, false, true])
    // Fully subcategorized: no remainder node.
    #expect(layout.bands.filter { $0.parent == "Dining" }.map(\.name) == ["Coffee"])
    #expect(layout.bands.filter { $0.parent == "Travel" }.isEmpty)
    // Every name sits beside its own node, level with it: income names to
    // the right, spend and subcategory names to the left.
    for band in layout.bands {
      guard let label = band.label else { continue }
      #expect(label.point.y == band.node.midY)
      if band.node.minX > layout.hub.maxX {
        #expect(label.point.x < band.node.minX && label.anchor == .trailing)
      } else {
        #expect(label.point.x > band.node.maxX && label.anchor == .leading)
      }
    }
    // A tap on a subcategory node reads out that subcategory.
    let mart = groceries[0]
    #expect(layout.band(at: CGPoint(x: mart.node.midX, y: mart.node.midY)) == mart)
    #expect(mart.accessibilityLabel == "Groceries › Sample Mart: $120.00")
  }

  @Test func subStacksNeverOverlap() {
    let m = CashflowSankey.month(
      month(
        income: [],
        spend: [("Groceries", 100), ("Dining", 100)],
        subs: ["Groceries": [("A", 50), ("B", 50)], "Dining": [("C", 50), ("D", 50)]]))
    let layout = SankeyLayout(month: m, width: 340, height: 372)
    let subs = layout.bands.filter { $0.parent != nil }.map(\.node)
    for (a, b) in zip(subs, subs.dropFirst()) { #expect(a.maxY <= b.minY) }
  }

  /// Edge to edge, with every column the same width and the three ribbon
  /// runs the same length.
  @Test func subStageIsEvenlySpacedEdgeToEdge() {
    let m = CashflowSankey.month(
      month(income: [("Sample Payroll", 100)], spend: [("Groceries", 100)], subs: ["Groceries": [("A", 50)]]))
    let layout = SankeyLayout(month: m, width: 338, height: 372)
    let inflow = layout.bands.first { $0.name == "Sample Payroll" }!.node
    let spend = layout.bands.first { $0.name == "Groceries" }!.node
    let sub = layout.bands.first { $0.parent != nil }!.node
    #expect(inflow.minX == 0 && abs(sub.maxX - 338) < 0.001)
    #expect(inflow.width == spend.width && spend.width == sub.width)
    #expect(inflow.width < 15, "thin bars; the names sit beside them")
    #expect(layout.hub.width == inflow.width)
    let runs = [layout.hub.minX - inflow.maxX, spend.minX - layout.hub.maxX, sub.minX - spend.maxX]
    #expect(runs.allSatisfy { abs($0 - runs[0]) < 0.001 })
  }

  @Test func withoutSubsTwoColumnsSpanTheWidth() {
    let m = CashflowSankey.month(month(income: [("Sample Payroll", 100)], spend: [("Groceries", 100)]))
    let layout = SankeyLayout(month: m, width: 338, height: 372)
    let inflow = layout.bands.first { $0.name == "Sample Payroll" }!.node
    let spend = layout.bands.first { $0.name == "Groceries" }!.node
    #expect(inflow.minX == 0 && abs(spend.maxX - 338) < 0.001)
    #expect(abs((layout.hub.minX - inflow.maxX) - (spend.minX - layout.hub.maxX)) < 0.001)
  }

  @Test func subcategoryBarsAreALighterSolidShade() {
    #expect(CategoryColors.lighter("#7c3aed", by: 0) == "#7c3aed")
    #expect(CategoryColors.lighter("#000000", by: 0.5) == "#808080")
    #expect(CategoryColors.lighter("#7c3aed", by: 1) == "#ffffff")
    let m = CashflowSankey.month(
      month(income: [], spend: [("Groceries", 100)], subs: ["Groceries": [("Sample Mart", 60)]]))
    let layout = SankeyLayout(month: m, width: 338, height: 372)
    let parent = layout.bands.first { $0.name == "Groceries" }!
    let sub = layout.bands.first { $0.name == "Sample Mart" }!
    #expect(sub.nodeOpacity == 1)
    #expect(sub.hex == CategoryColors.lighter(parent.hex, by: 0.4))
    #expect(sub.ribbonFrom == parent.hex)
  }

  /// Labels in a column never overlap; the crowded ones drop.
  @Test func labelsNeverOverlapInAColumn() {
    let spend = (1...12).map { ("Category \($0)", Double(13 - $0) * 10) }
    let m = CashflowSankey.month(month(income: [("Sample Payroll", 2000)], spend: spend))
    let layout = SankeyLayout(month: m, width: 338, height: 372)
    let labelled = layout.bands.filter { $0.parent == nil && $0.node.minX > layout.hub.maxX }
      .compactMap(\.label)
    #expect(labelled.allSatisfy { $0.anchor == .trailing })
    let ys = labelled.map(\.point.y)
    for (a, b) in zip(ys, ys.dropFirst()) { #expect(b - a >= SankeyLayout.lineHeight) }
  }
}
