import SwiftUI
import Testing
@testable import BudgetPhone

struct TabBarScrollRuleTests {
  let travel = TabBarScrollRule.travel

  /// Feeds the offsets to one rule in order, carrying the bar's progress
  /// along, and returns the progress after each.
  func run(_ offsets: [CGFloat], maxOffset: CGFloat = 2000, from start: CGFloat = 0) -> [CGFloat] {
    var rule = TabBarScrollRule()
    var progress = start
    return offsets.map {
      progress = rule.update(offset: $0, maxOffset: maxOffset, progress: progress)
      return progress
    }
  }

  @Test func fullAtTheTop() {
    #expect(run([0]) == [0])
    #expect(run([300, 0], from: 1) == [1, 0])
  }

  @Test func theFirstOffsetOnlyRecords() {
    #expect(run([300]) == [0])
  }

  @Test func followsTheFingerDown() {
    #expect(run([100, 100 + travel / 4, 100 + travel / 2]) == [0, 0.25, 0.5])
  }

  @Test func followsTheFingerBackUp() {
    #expect(run([100, 100 + travel / 2, 100 + travel / 4]) == [0, 0.5, 0.25])
  }

  @Test func stopsAtEitherEnd() {
    #expect(run([100, 100 + travel * 3]) == [0, 1])
    #expect(run([500, 500 - travel * 3], from: 1) == [1, 0])
  }

  @Test func theBounceAtTheBottomDoesNotMoveIt() {
    let end: CGFloat = 1000
    #expect(run([end, end + 60, end + 20, end], maxOffset: end, from: 1) == [1, 1, 1, 1])
  }

  @Test func aPullPastTheTopKeepsItFull() {
    #expect(run([-80, -20, 0]) == [0, 0, 0])
  }

  @Test func aSmallStepAfterAPullStartsFromTheTop() {
    // Without the lower clamp the pull would count as 85 pt of scrolling.
    #expect(run([-80, 5]) == [0, 5 / travel])
  }

  @Test func aPageTooShortToScrollNeverShrinks() {
    #expect(run([0, 30, 60, 90], maxOffset: 0) == [0, 0, 0, 0])
  }

  @Test func letGoPartWayFinishesTheWayItWasGoing() {
    var rule = TabBarScrollRule()
    var p = rule.update(offset: 100, maxOffset: 2000, progress: 0)
    p = rule.update(offset: 100 + travel / 4, maxOffset: 2000, progress: p)
    #expect(rule.settled(p) == 1)  // a quarter of the way down: finishes shrinking
    p = rule.update(offset: 100 + travel / 8, maxOffset: 2000, progress: p)
    #expect(rule.settled(p) == 0)  // then back up a little: finishes growing
  }

  @Test func settledEndsStay() {
    let rule = TabBarScrollRule()
    #expect(rule.settled(0) == 0)
    #expect(rule.settled(1) == 1)
  }

  @Test func offsetsCountFromTheTopOfTheContent() {
    // At rest at the top, UIKit reports contentOffset.y == -contentInsets.top.
    let geometry = ScrollGeometry(
      contentOffset: CGPoint(x: 0, y: 150), contentSize: CGSize(width: 402, height: 3000),
      contentInsets: EdgeInsets(top: 100, leading: 0, bottom: 34, trailing: 0),
      containerSize: CGSize(width: 402, height: 874))
    #expect(TabBarScrollOffsets(geometry) == TabBarScrollOffsets(offset: 250, maxOffset: 3000 + 100 + 34 - 874))
  }

  @Test func shortContentHasNoRoomToScroll() {
    let geometry = ScrollGeometry(
      contentOffset: CGPoint(x: 0, y: -100), contentSize: CGSize(width: 402, height: 300),
      contentInsets: EdgeInsets(top: 100, leading: 0, bottom: 34, trailing: 0),
      containerSize: CGSize(width: 402, height: 874))
    #expect(TabBarScrollOffsets(geometry) == TabBarScrollOffsets(offset: 0, maxOffset: 0))
  }
}
