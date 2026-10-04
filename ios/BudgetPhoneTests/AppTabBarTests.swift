import CoreGraphics
import Testing
@testable import BudgetPhone

@MainActor
struct AppTabBarTests {
  @Test func tabsKeepTheirOrderTitlesAndSymbols() {
    #expect(AppTab.allCases.map(\.title) == ["Accounts", "Activity", "Analytics", "Benefits", "Settings"])
    #expect(
      AppTab.allCases.map(\.systemImage)
        == ["building.columns", "list.bullet.rectangle", "chart.pie", "creditcard", "gear"])
  }

  @Test(arguments: [false, true])
  func contentClearsTheFullBar(showsLabels: Bool) {
    let m = AppTabBar.Metrics.self
    let barTop = m.bottomGap + (showsLabels ? m.labelledHeight : m.fullHeight) + m.clearance
    // Above the home indicator, the inset adds what the safe area lacks…
    #expect(AppTabBar.contentInset(bottomSafeArea: 34, showsLabels: showsLabels) == barTop - 34)
    // …and on a phone without one, all of it.
    #expect(AppTabBar.contentInset(bottomSafeArea: 0, showsLabels: showsLabels) == barTop)
  }

  @Test func labelsNeedMoreRoom() {
    #expect(
      AppTabBar.contentInset(bottomSafeArea: 34, showsLabels: true)
        > AppTabBar.contentInset(bottomSafeArea: 34, showsLabels: false))
  }

  @Test(arguments: [false, true])
  func noExtraInsetWhileTheKeyboardIsUp(showsLabels: Bool) {
    // The bar sits behind the keyboard, so nothing needs to clear it.
    #expect(AppTabBar.contentInset(bottomSafeArea: 336, showsLabels: showsLabels) == 0)
  }

  @Test func easesIntoEitherEnd() {
    let full: CGFloat = 1
    let small = AppTabBar.Metrics.compactScale
    func step(_ p: CGFloat) -> CGFloat {
      abs(AppTabBar.scale(progress: p + 0.05, showsLabels: false) - AppTabBar.scale(progress: p, showsLabels: false))
    }
    // The size changes least near full and near small, most in the middle.
    #expect(step(0) < step(0.45))
    #expect(step(0.95) < step(0.45))
    #expect(AppTabBar.scale(progress: 0, showsLabels: false) == full)
    #expect(abs(AppTabBar.scale(progress: 1, showsLabels: false) - small) < 0.0001)
  }

  @Test func theShrunkBarIs44PointsTall() {
    let m = AppTabBar.Metrics.self
    #expect(abs(m.fullHeight * m.compactScale - 44) < 0.0001)
  }

  @Test func scalesWithProgressOnlyWithoutLabels() {
    let small = AppTabBar.Metrics.compactScale
    #expect(AppTabBar.scale(progress: 0, showsLabels: false) == 1)
    #expect(AppTabBar.scale(progress: 1, showsLabels: false) == small)
    #expect(AppTabBar.scale(progress: 0.5, showsLabels: false) == (1 + small) / 2)
    #expect(AppTabBar.scale(progress: 1, showsLabels: true) == 1)
  }
}

struct BottomSearchFieldTests {
  /// Where the field's bottom edge lands, from the screen's bottom.
  private func bottomEdge(progress: CGFloat, showsLabels: Bool) -> CGFloat {
    let scale = BottomSearchField.scale(progress: progress, showsLabels: showsLabels, keyboardUp: false)
    return AppTabBar.Metrics.bottomGap
      + BottomSearchField.lift(showsLabels: showsLabels, keyboardUp: false) * scale
  }

  @Test func shrinksWithTheBarAsOnePicture() {
    let m = AppTabBar.Metrics.self
    #expect(bottomEdge(progress: 0, showsLabels: false) == m.bottomGap + m.fullHeight + m.clearance)
    // The same scale as the bar, so it keeps the bar's width and gap.
    #expect(BottomSearchField.scale(progress: 1, showsLabels: false, keyboardUp: false) == m.compactScale)
    let shrunk = bottomEdge(progress: 1, showsLabels: false)
    #expect(abs(shrunk - (m.bottomGap + m.compactHeight + m.clearance * m.compactScale)) < 0.001)
    // Labels keep the bar full size.
    #expect(bottomEdge(progress: 1, showsLabels: true) == m.bottomGap + m.labelledHeight + m.clearance)
    // Over the keyboard: full size, only the gap.
    #expect(BottomSearchField.scale(progress: 1, showsLabels: false, keyboardUp: true) == 1)
    #expect(BottomSearchField.lift(showsLabels: false, keyboardUp: true) == m.clearance)
  }
}
