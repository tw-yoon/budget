import Foundation
import Testing
@testable import BudgetPhone

struct AnalyticsSupportTests {
  // MARK: Formatters (../src/lib/format.ts formatCompactCurrency; Math.round)

  @Test func compactCurrencyMatchesIntl() {
    // Expected strings come from Node's Intl.NumberFormat with the web's options.
    #expect(Formatters.compactCurrency(0) == "$0")
    #expect(Formatters.compactCurrency(500) == "$500")
    #expect(Formatters.compactCurrency(1000) == "$1K")
    #expect(Formatters.compactCurrency(1250) == "$1.3K")
    #expect(Formatters.compactCurrency(2500) == "$2.5K")
    #expect(Formatters.compactCurrency(12345) == "$12.3K")
    #expect(Formatters.compactCurrency(1_000_000) == "$1M")
  }

  @Test func mathRoundRoundsHalvesUp() {
    #expect(Formatters.mathRound(2.5) == 3)
    #expect(Formatters.mathRound(-2.5) == -2)
    #expect(Formatters.mathRound(1.4) == 1)
    #expect(Formatters.mathRound(4.6) == 5)
  }

  // MARK: MonthWindow (useMonthWindow.ts)

  @Test func clampMatchesClampView() {
    #expect(MonthWindow.clamp(end: 0, span: 5, total: 10) == (5, 5))
    #expect(MonthWindow.clamp(end: 12, span: 0, total: 10) == (10, 1))
    #expect(MonthWindow.clamp(end: 3, span: 2, total: 0) == (0, 1))
  }

  @Test func beforeDataNothingIsShownOrEnabled() {
    let w = MonthWindow(defaultSpan: 6)
    #expect(w.range.isEmpty)
    #expect(!w.canEarlier && !w.canLater && !w.canZoomIn && !w.canZoomOut)
  }

  @Test func opensOnTheLatestDefaultSpan() {
    var w = MonthWindow(defaultSpan: 6)
    w.setTotal(24)
    #expect(w.range == 18..<24)
    #expect(w.canEarlier && !w.canLater && w.canZoomIn && w.canZoomOut)
  }

  @Test func aShortSeriesShowsAllOfIt() {
    var w = MonthWindow(defaultSpan: 6)
    w.setTotal(3)
    #expect(w.range == 0..<3)
    #expect(!w.canEarlier && !w.canZoomOut)
    w.pan(-1)
    #expect(w.range == 0..<3, "the window can't slide past the start")
    w.zoom(1)
    #expect(w.span == 3)
  }

  @Test func panAndZoomMoveTheWindow() {
    var w = MonthWindow(defaultSpan: 1)
    w.setTotal(24)
    w.pan(-1)
    #expect(w.range == 22..<23)
    #expect(w.canLater)
    w.zoom(1)
    #expect(w.range == 21..<23)
    w.zoom(-1)
    w.zoom(-1)
    #expect(w.span == 1, "zoom stops at one month")
  }

  @Test func laterTotalsDoNotResetTheWindow() {
    var w = MonthWindow(defaultSpan: 6)
    w.setTotal(24)
    w.pan(-2)
    w.setTotal(24)
    #expect(w.end == 22)
  }

  /// The phone caps how many months one chart shows (the web doesn't).
  @Test func zoomStopsAtTheMaximumSpan() {
    var w = MonthWindow(defaultSpan: 3, maxSpan: 3)
    w.setTotal(24)
    #expect(w.range == 21..<24)
    #expect(!w.canZoomOut)
    w.zoom(1)
    #expect(w.span == 3)
    w.zoom(-1)
    #expect(w.canZoomOut)
  }

  @Test func theDefaultSpanIsCappedToo() {
    var w = MonthWindow(defaultSpan: 6, maxSpan: 3)
    w.setTotal(24)
    #expect(w.span == 3)
  }

  @Test func aShortSeriesStillLimitsZoomOut() {
    var w = MonthWindow(defaultSpan: 3, maxSpan: 3)
    w.setTotal(2)
    #expect(w.span == 2)
    #expect(!w.canZoomOut)
  }

  @Test func rangeLabels() {
    #expect(MonthWindow.label([]) == "—")
    #expect(MonthWindow.label(["Jun 2026"]) == "Jun 2026")
    #expect(MonthWindow.label(["Apr 2026", "May 2026", "Jun 2026"]) == "Apr 2026 – Jun 2026")
  }

  // MARK: CategoryColors (../src/lib/colors.ts)

  @Test func categoryColorsMatchTheWeb() {
    #expect(CategoryColors.hex(for: "Groceries") == "#06b6d4")
    #expect(CategoryColors.hex(for: "Other") == "#94a3b8")
    #expect(CategoryColors.hex(for: "Other income") == "#94a3b8")
    // Hashed names; expected values computed with the web's categoryColor.
    #expect(CategoryColors.hex(for: "Sample Category") == "#eab308")
    #expect(CategoryColors.hex(for: "Pets") == "#14b8a6")
    #expect(CategoryColors.hex(for: "Café") == "#a855f7", "hashes UTF-16 code units, as charCodeAt does")
  }

  // MARK: CategoryBreakdown (../src/components/charts/CategoryChart.tsx)

  private func month(_ key: String, _ spend: [(String, Double)]) -> CashflowMonth {
    CashflowMonth(
      key: key, label: key, income: [],
      spend: spend.map { CashflowMonth.Spend(category: $0.0, amount: $0.1) })
  }

  @Test func slicesSumAcrossMonthsLargestFirst() {
    let slices = CategoryBreakdown.slices([
      month("2026-07", [("Dining", 50), ("Groceries", 100)]),
      month("2026-08", [("Dining", 80)]),
    ])
    #expect(slices == [
      CategorySlice(category: "Dining", amount: 130), CategorySlice(category: "Groceries", amount: 100),
    ])
  }

  @Test func tiesKeepFirstSeenOrder() {
    let slices = CategoryBreakdown.slices([month("2026-07", [("B", 10), ("A", 10)])])
    #expect(slices.map(\.category) == ["B", "A"])
  }

  private func slices(_ n: Int, other: Int? = nil) -> [CategorySlice] {
    (0..<n).map { i in
      CategorySlice(category: i == other ? "Other" : "C\(i)", amount: Double(100 - i))
    }
  }

  @Test func eightOrFewerAreLeftAlone() {
    #expect(CategoryBreakdown.fold(slices(8)) == slices(8))
  }

  @Test func theTailFoldsIntoANewOther() {
    let folded = CategoryBreakdown.fold(slices(10))
    #expect(folded.count == 9)
    #expect(folded.last == CategorySlice(category: "Other", amount: 92 + 91))
  }

  @Test func theTailFoldsIntoAnExistingOther() {
    let folded = CategoryBreakdown.fold(slices(10, other: 3))
    #expect(folded.count == 8)
    #expect(folded[3] == CategorySlice(category: "Other", amount: 97 + 92 + 91))
  }

  @Test func percentRoundsLikeTheLegend() {
    #expect(CategoryBreakdown.percent(1, of: 8) == 13)  // 12.5 rounds up
    #expect(CategoryBreakdown.percent(5, of: 0) == 500)  // sum || 1
  }

  @Test func angleSelectionFindsTheSlice() {
    let s = [CategorySlice(category: "A", amount: 10), CategorySlice(category: "B", amount: 5)]
    #expect(CategoryBreakdown.slice(at: 4, in: s)?.category == "A")
    #expect(CategoryBreakdown.slice(at: 10.5, in: s)?.category == "B")
    #expect(CategoryBreakdown.slice(at: 99, in: s) == nil)
  }
}
