import Foundation
import Testing
@testable import BudgetPhone

struct PerkRemindersTests {
  let cal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "America/Chicago")!
    return c
  }()

  func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date {
    cal.date(from: DateComponents(year: y, month: m, day: d, hour: h))!
  }

  func card(period: String = "MONTHLY", amount: Double = 7, used: Double = 0, autoMode: String? = "credits")
    -> [UserCardDTO]
  {
    let b = BenefitDTO(
      id: "b1", name: "Sample Coffee Credit", notes: nil, amount: amount, period: period,
      matchCategories: [], categoryLabels: [], matchText: [], perkActiveFrom: nil, used: used,
      cappedUsed: used, pct: 0, periodLabel: "", source: "auto", autoMode: autoMode,
      yearBreakdown: [], openQuestions: 0, ytdCaptured: 0, yearTarget: 0)
    return [UserCardDTO(id: "c1", issuer: "AMEX", name: "Sample Rewards Card", last4: "0002", benefits: [b])]
  }

  @Test func monthlyRemindsAWeekBefore() {
    let r = PerkReminders.plan(cards: card(), now: date(2026, 10, 10), calendar: cal, fired: [])
    #expect(r.count == 1)
    #expect(r[0].fireDate == date(2026, 10, 24, 10))
    #expect(r[0].id == "perk-b1-2026-11-01")
    #expect(r[0].title == "Sample Coffee Credit")
    #expect(r[0].body == "$7.00 left, ends Oct 31.")
  }

  @Test func fullOrFlatPerksGetNone() {
    let now = date(2026, 10, 10)
    #expect(PerkReminders.plan(cards: card(used: 7), now: now, calendar: cal, fired: []).isEmpty)
    #expect(PerkReminders.plan(cards: card(autoMode: "perk"), now: now, calendar: cal, fired: []).isEmpty)
    #expect(PerkReminders.plan(cards: card(amount: 0), now: now, calendar: cal, fired: []).isEmpty)
  }

  @Test func insideTheLastWeekFiresOnceSoon() {
    let now = date(2026, 10, 27)
    let r = PerkReminders.plan(cards: card(), now: now, calendar: cal, fired: [])
    #expect(r.map(\.fireDate) == [now.addingTimeInterval(60)])
    #expect(PerkReminders.plan(cards: card(), now: now, calendar: cal, fired: [r[0].id]).isEmpty)
  }

  @Test func bookedTenAMReminderIsNotBookedAgainAfterTen() {
    let now = date(2026, 10, 24, 11)
    #expect(PerkReminders.plan(cards: card(), now: now, calendar: cal, fired: ["perk-b1-2026-11-01"]).isEmpty)
    #expect(PerkReminders.plan(cards: card(), now: date(2026, 10, 10), calendar: cal, fired: [])[0].soon == false)
    #expect(PerkReminders.plan(cards: card(), now: now, calendar: cal, fired: [])[0].soon)
  }

  @Test func changesKeepBookedPendingAndRedoTheRest() {
    let id = "perk-b1-2026-11-01"
    let now = date(2026, 10, 27)
    // A second reschedule a second later keeps the booked 60 s reminder.
    let again = PerkReminders.changes(cards: card(), now: now, calendar: cal, fired: [id], pending: [id, "other"])
    #expect(again.add.isEmpty && again.remove.isEmpty)
    // Not booked yet (permission was denied): removed and re-added.
    let redo = PerkReminders.changes(cards: card(), now: now, calendar: cal, fired: [], pending: [id])
    #expect(redo.remove == [id] && redo.add.map(\.id) == [id])
    // Perk used up since: the booked reminder goes.
    let used = PerkReminders.changes(cards: card(used: 7), now: now, calendar: cal, fired: [id], pending: [id])
    #expect(used.remove == [id] && used.add.isEmpty)
    // Turned off then on before the date: booked but no longer pending, so it comes back.
    let back = PerkReminders.changes(cards: card(), now: date(2026, 10, 10), calendar: cal, fired: [id], pending: [])
    #expect(back.add.map(\.id) == [id] && back.remove.isEmpty)
  }

  @Test func windowEnds() {
    #expect(PerkReminders.windowEnd(period: "QUARTERLY", now: date(2026, 11, 5), calendar: cal) == date(2027, 1, 1, 0))
    #expect(PerkReminders.windowEnd(period: "SEMIANNUAL", now: date(2026, 3, 3), calendar: cal) == date(2026, 7, 1, 0))
    #expect(PerkReminders.windowEnd(period: "SEMIANNUAL", now: date(2026, 8, 3), calendar: cal) == date(2027, 1, 1, 0))
    #expect(PerkReminders.windowEnd(period: "ANNUAL", now: date(2026, 3, 3), calendar: cal) == date(2027, 1, 1, 0))
    #expect(PerkReminders.windowEnd(period: "MONTHLY", now: date(2026, 12, 20), calendar: cal) == date(2027, 1, 1, 0))
  }
}
