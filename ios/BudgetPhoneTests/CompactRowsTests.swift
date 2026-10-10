import Foundation
import Testing
@testable import BudgetPhone

struct CompactRowsTests {
  @Test func theCardFollowsAPinchTowardTheOtherDensity() {
    // Full rows: pinching in shrinks the card, pinching out barely spreads it.
    #expect(CompactRows.liveStretch(magnification: 1, compact: false) == 0)
    #expect(abs(CompactRows.liveStretch(magnification: 0.98, compact: false) + 0.012) < 0.001)
    #expect(CompactRows.liveStretch(magnification: 1.1, compact: false) < 0.02)
    // Compact rows: the other way round.
    #expect(abs(CompactRows.liveStretch(magnification: 1.02, compact: true) - 0.012) < 0.001)
    #expect(CompactRows.liveStretch(magnification: 0.9, compact: true) > -0.02)
  }

  @Test func theCardEasesTowardItsLimitWithoutStopping() {
    // Keeps moving with the fingers, by less and less, and never passes 8%.
    let a = CompactRows.liveStretch(magnification: 0.85, compact: false)
    let b = CompactRows.liveStretch(magnification: 0.7, compact: false)
    let c = CompactRows.liveStretch(magnification: 0.2, compact: false)
    #expect(a > b && b > c)
    #expect(c >= -0.08)
    #expect(CompactRows.liveStretch(magnification: 5, compact: true) <= 0.08)
    #expect(CompactRows.liveStretch(magnification: 5, compact: false) <= 0.03)
  }

  @Test func aPinchSwitchesOnlyPastTheThreshold() {
    #expect(CompactRows.target(magnification: 0.7) == true)
    #expect(CompactRows.target(magnification: 1.4) == false)
    #expect(CompactRows.target(magnification: 0.9) == nil)
    #expect(CompactRows.target(magnification: 1.1) == nil)
    #expect(CompactRows.target(magnification: 1) == nil)
  }

  @Test func numberMatchesTheFullRows() {
    #expect(CompactRows.number(752) == "#752")
    #expect(CompactRows.number(nil) == "#—")
  }

  @Test func shortDateIsMonthAndDay() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    #expect(CompactRows.shortDate("2026-09-29T12:00:00.000Z", calendar: calendar) == "Sep 29")
    #expect(CompactRows.shortDate("not a date", calendar: calendar) == "")
  }

  @Test func bankDateKeepsItsDayWestOfUTC() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    #expect(CompactRows.shortDate("2026-10-01T00:00:00.000Z", calendar: calendar) == "Oct 1")
    #expect(CompactRows.shortDate("2026-10-01T03:00:00.000Z", calendar: calendar) == "Sep 30")
    let day = Formatters.parseISO("2026-10-01T00:00:00.000Z")!
    #expect(Formatters.date(day, calendar: calendar) == "Oct 1, 2026")
  }
}
