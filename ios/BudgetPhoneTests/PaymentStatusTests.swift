import Foundation
import Testing
@testable import BudgetPhone

/// Pinned to Chicago and a fixed instant so every branch is deterministic.
struct PaymentStatusTests {
  let calendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "America/Chicago")!
    return c
  }()

  /// Local 09:00 on the given day.
  func at(_ y: Int, _ m: Int, _ d: Int, hour: Int = 9) -> Date {
    calendar.date(from: DateComponents(year: y, month: m, day: d, hour: hour))!
  }

  func status(_ account: AccountDTO, now: Date) -> PaymentStatus? {
    PaymentStatus.of(account, now: now, calendar: calendar)
  }

  @Test func nonCreditAccountsHaveNone() {
    #expect(status(TestData.card(nextPaymentDueDate: "2026-10-05T17:00:00Z", type: "DEPOSITORY"), now: at(2026, 9, 26)) == nil)
  }

  @Test func creditWithoutADueDateHasNone() {
    #expect(status(TestData.card(), now: at(2026, 9, 26)) == nil)
  }

  @Test func plaidDueDateInTheFuture() {
    let s = status(
      TestData.card(nextPaymentDueDate: "2026-10-15T17:00:00Z", minimumPaymentAmount: 35),
      now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Oct 15, 2026 · in 20d · min $35.00", tone: .normal))
  }

  @Test func withinSevenDaysIsSoon() {
    let s = status(TestData.card(nextPaymentDueDate: "2026-10-03T14:00:00Z"), now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Oct 3, 2026 · in 7d", tone: .soon))
  }

  @Test func eightDaysOutIsNormal() {
    let s = status(TestData.card(nextPaymentDueDate: "2026-10-04T14:00:00Z"), now: at(2026, 9, 26))
    #expect(s?.tone == .normal)
    #expect(s?.text == "Payment due Oct 4, 2026 · in 8d")
  }

  @Test func dueEarlierTodayReadsToday() {
    // 13:30Z is 08:30 in Chicago, half an hour before `now`.
    let s = status(TestData.card(nextPaymentDueDate: "2026-09-26T13:30:00Z"), now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Sep 26, 2026 · today", tone: .soon))
  }

  @Test func dueLaterTodayReadsInOneDayLikeTheWeb() {
    // daysUntil rounds up, so any time still ahead today is "in 1d". The web
    // does the same; parity matters more than fixing it on one side only.
    let s = status(TestData.card(nextPaymentDueDate: "2026-09-26T14:30:00Z"), now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Sep 26, 2026 · in 1d", tone: .soon))
  }

  @Test func zeroMinimumIsOmitted() {
    let s = status(
      TestData.card(nextPaymentDueDate: "2026-10-15T17:00:00Z", minimumPaymentAmount: 0),
      now: at(2026, 9, 26))
    #expect(s?.text == "Payment due Oct 15, 2026 · in 20d")
  }

  @Test func plaidOverdueFlagWinsOverTheDate() {
    let s = status(
      TestData.card(
        nextPaymentDueDate: "2026-10-15T17:00:00Z", minimumPaymentAmount: 35,
        paymentIsOverdue: true),
      now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment overdue — was due Oct 15, 2026 · min $35.00", tone: .overdue))
  }

  @Test func pastDateNotOverdueIsProjectedForward() {
    // Plaid's date is Sep 5 (UTC day 5); today is Sep 26, so the estimate is Oct 5.
    let s = status(
      TestData.card(nextPaymentDueDate: "2026-09-05T17:00:00Z", paymentIsOverdue: false),
      now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Oct 5, 2026 · in 10d · est.", tone: .normal))
  }

  @Test func manualDueDayWinsAndIsNeverOverdue() {
    let s = status(
      TestData.card(
        manualDueDay: 28, nextPaymentDueDate: "2026-09-01T17:00:00Z", paymentIsOverdue: true),
      now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Sep 28, 2026 · in 3d · manual", tone: .soon))
  }

  @Test func manualDayAlreadyPassedRollsToNextMonth() {
    let s = status(TestData.card(manualDueDay: 10), now: at(2026, 9, 26))
    #expect(s?.text == "Payment due Oct 10, 2026 · in 15d · manual")
  }

  @Test func day31ClampsToTheEndOfAShortMonth() {
    let due = nextMonthlyOccurrence(day: 31, now: at(2026, 9, 26), calendar: calendar)
    #expect(Formatters.date(due, calendar: calendar) == "Sep 30, 2026")
  }

  @Test func decemberRollsIntoJanuary() {
    let due = nextMonthlyOccurrence(day: 5, now: at(2026, 12, 20), calendar: calendar)
    #expect(Formatters.date(due, calendar: calendar) == "Jan 5, 2027")
  }

  @Test func daysUntilRoundsUpLikeTheWeb() {
    let now = at(2026, 9, 26)
    #expect(daysUntil(now.addingTimeInterval(3600), now: now) == 1)
    #expect(daysUntil(now.addingTimeInterval(-3600), now: now) == 0)
    #expect(daysUntil(now.addingTimeInterval(-86_400 - 1), now: now) == -1)
  }

  // MARK: - F3: the default calendar must be Gregorian, not the device's

  @Test func defaultCalendarIsGregorianRegardlessOfTheDevicesSetting() {
    #expect(Calendar.gregorianCurrent.identifier == .gregorian)
  }
}
