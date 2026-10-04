import Foundation

/// The due-date line under a credit card. A port of `paymentStatus` in
/// src/components/AccountCard.tsx, with `daysUntil` and
/// `nextMonthlyOccurrence` from src/lib/format.ts — kept identical, quirks
/// included, so the phone never disagrees with the browser about a due date.
/// `now` and `calendar` are parameters so tests can pin both.
struct PaymentStatus: Equatable, Sendable {
  enum Tone: Equatable, Sendable {
    case normal
    case soon  // due within 7 days
    case overdue
  }

  let text: String
  let tone: Tone

  static func of(
    _ account: AccountDTO,
    now: Date = .now,
    calendar: Calendar = .gregorianCurrent
  ) -> PaymentStatus? {
    guard account.isCredit else { return nil }

    func rel(_ days: Int) -> String { days == 0 ? "today" : "in \(days)d" }
    func tone(_ days: Int) -> Tone { days <= 7 ? .soon : .normal }
    func date(_ d: Date) -> String { Formatters.date(d, calendar: calendar) }

    // Manual override wins — for issuers that don't share a due date through
    // Plaid. Always a future recurring date, so never "overdue".
    if let day = account.manualDueDay {
      let due = nextMonthlyOccurrence(day: day, now: now, calendar: calendar)
      let days = daysUntil(due, now: now)
      return PaymentStatus(
        text: "Payment due \(date(due)) · \(rel(days)) · manual",
        tone: tone(days))
    }

    guard let iso = account.nextPaymentDueDate,
      let due = Formatters.parseISO(iso)
    else { return nil }

    let min: String
    if let m = account.minimumPaymentAmount, m > 0 {
      min = " · min \(Formatters.currency(m))"
    } else {
      min = ""
    }

    // Plaid's is_overdue is authoritative — don't infer it from the date.
    if account.paymentIsOverdue == true {
      return PaymentStatus(
        text: "Payment overdue — was due \(date(due))\(min)", tone: .overdue)
    }

    let days = daysUntil(due, now: now)
    if days >= 0 {
      return PaymentStatus(
        text: "Payment due \(date(due)) · \(rel(days))\(min)", tone: tone(days))
    }

    // Plaid's date has passed but the card isn't overdue: the next statement
    // hasn't been issued yet. Project the due day forward as an estimate.
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = .gmt
    let projected = nextMonthlyOccurrence(
      day: utc.component(.day, from: due), now: now, calendar: calendar)
    let pdays = daysUntil(projected, now: now)
    return PaymentStatus(
      text: "Payment due \(date(projected)) · \(rel(pdays)) · est.",
      tone: tone(pdays))
  }
}

extension Calendar {
  /// Gregorian, with the device's time zone but never its calendar
  /// identifier. The web always works in the Gregorian JS `Date`, so a
  /// phone set to e.g. the Hebrew or Islamic calendar must still compute due
  /// dates the same way the browser does.
  static var gregorianCurrent: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    return calendar
  }
}

/// Whole days until `date`, rounded up (negative = past). format.ts daysUntil.
func daysUntil(_ date: Date, now: Date) -> Int {
  Int((date.timeIntervalSince(now) / 86_400).rounded(.up))
}

/// The next time `day` falls, today included, at local noon. Clamped to the
/// month's length, so 31 means the last day in a 30-day month.
/// format.ts nextMonthlyOccurrence.
func nextMonthlyOccurrence(day: Int, now: Date, calendar: Calendar) -> Date {
  func lastDay(_ year: Int, _ month: Int) -> Int {
    let first = calendar.date(from: DateComponents(year: year, month: month, day: 1))!
    return calendar.range(of: .day, in: .month, for: first)!.count
  }
  let today = calendar.dateComponents([.year, .month, .day], from: now)
  var year = today.year!
  var month = today.month!
  if today.day! > Swift.min(day, lastDay(year, month)) {
    month += 1
    if month > 12 {
      month = 1
      year += 1
    }
  }
  return calendar.date(
    from: DateComponents(
      year: year, month: month, day: Swift.min(day, lastDay(year, month)), hour: 12))!
}
