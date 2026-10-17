import Foundation

struct PerkReminder: Equatable, Sendable {
  let id: String
  let fireDate: Date
  let title: String
  let body: String
  /// Inside the last week: book it 60 s out instead of on a date.
  let soon: Bool
}

/// Reminders a week before a perk's window closes unused. Windows match
/// `periodWindow` in ../src/services/benefits.service.ts.
enum PerkReminders {
  static let storageKey = "perkReminders"
  static let idPrefix = "perk-"

  static func windowEnd(period: String, now: Date, calendar: Calendar) -> Date {
    let c = calendar.dateComponents([.year, .month], from: now)
    let y = c.year!, m = c.month! - 1
    let (endY, endM): (Int, Int)
    switch period {
    case "MONTHLY": (endY, endM) = (y, m + 1)
    case "QUARTERLY": (endY, endM) = (y, m / 3 * 3 + 3)
    case "SEMIANNUAL": (endY, endM) = (y, m < 6 ? 6 : 12)
    default: (endY, endM) = (y + 1, 0)
    }
    return calendar.date(from: DateComponents(year: endY, month: endM + 1, day: 1))!
  }

  static func plan(cards: [UserCardDTO], now: Date, calendar: Calendar, fired: Set<String>) -> [PerkReminder] {
    let idDay = DateFormatter()
    idDay.calendar = calendar
    idDay.timeZone = calendar.timeZone
    idDay.locale = Locale(identifier: "en_US_POSIX")
    idDay.dateFormat = "yyyy-MM-dd"
    let shown = DateFormatter()
    shown.calendar = calendar
    shown.timeZone = calendar.timeZone
    shown.locale = Locale(identifier: "en_US")
    shown.setLocalizedDateFormatFromTemplate("MMMd")

    var out: [PerkReminder] = []
    for card in cards {
      for b in card.benefits where b.autoMode != "perk" && b.amount > 0 && b.cappedUsed < b.amount {
        let end = windowEnd(period: b.period, now: now, calendar: calendar)
        let id = "\(idPrefix)\(b.id)-\(idDay.string(from: end))"
        let lastDay = calendar.date(byAdding: .day, value: -1, to: end)!
        // A week before the last day (the date the body names): Oct 24 for Oct 31.
        let weekBefore = calendar.date(byAdding: .day, value: -7, to: lastDay)!
        var fire = calendar.date(bySettingHour: 10, minute: 0, second: 0, of: weekBefore)!
        let soon = fire.timeIntervalSince(now) <= 61
        if fire <= now {
          if fired.contains(id) { continue }
          fire = now.addingTimeInterval(60)
        }
        out.append(
          PerkReminder(
            id: id, fireDate: fire, title: b.name,
            body: "\(Formatters.currency(b.amount - b.cappedUsed)) left, ends \(shown.string(from: lastDay)).",
            soon: soon))
      }
    }
    return out
  }

  /// What one reschedule does with the pending requests. Booked ones (id in
  /// `fired`) stay unless their perk no longer needs a reminder; every other
  /// pending `perk-` request is removed and re-added.
  static func changes(
    cards: [UserCardDTO], now: Date, calendar: Calendar, fired: Set<String>, pending: [String]
  ) -> (add: [PerkReminder], remove: [String]) {
    let wanted = Set(plan(cards: cards, now: now, calendar: calendar, fired: []).map(\.id))
    let ours = pending.filter { $0.hasPrefix(idPrefix) }
    let keep = Set(ours.filter { fired.contains($0) && wanted.contains($0) })
    return (
      plan(cards: cards, now: now, calendar: calendar, fired: fired).filter { !keep.contains($0.id) },
      ours.filter { !keep.contains($0) }
    )
  }
}
