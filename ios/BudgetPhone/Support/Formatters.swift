import Foundation

// Formatting that matches the web app's src/lib/format.ts, so the phone and
// the browser print the same strings for the same data.
enum Formatters {
  private static let enUS = Locale(identifier: "en_US")

  /// "$1,234.56", "-$12.00" — Intl.NumberFormat("en-US", currency USD).
  static func currency(_ amount: Double) -> String {
    amount.formatted(.currency(code: "USD").locale(enUS))
  }

  /// The zone to read a date in — isDateOnly in ../src/lib/format.ts. A bank
  /// date is a bare calendar day stored as UTC midnight; read locally it would
  /// show the day before west of UTC. Real instants keep the calendar's zone.
  static func zone(for date: Date, calendar: Calendar) -> TimeZone {
    date.timeIntervalSince1970.truncatingRemainder(dividingBy: 86_400) == 0 ? .gmt : calendar.timeZone
  }

  /// A Gregorian en_US style in the zone `date` should be read in. FormatStyle
  /// rather than a DateFormatter per call: these run once per list row.
  static func dateStyle(_ date: Date, calendar: Calendar) -> Date.FormatStyle {
    Date.FormatStyle(locale: enUS, calendar: Calendar(identifier: .gregorian), timeZone: zone(for: date, calendar: calendar))
  }

  /// "Sep 26, 2026" — formatDate, in the calendar's time zone.
  static func date(_ date: Date, calendar: Calendar = .current) -> String {
    date.formatted(dateStyle(date, calendar: calendar).month(.abbreviated).day().year())
  }

  /// "just now", "4m ago", "3h ago", "2d ago" — formatRelativeTime.
  static func relative(_ date: Date, now: Date = .now) -> String {
    let sec = max(0, Int(now.timeIntervalSince(date)))
    if sec < 60 { return "just now" }
    let min = sec / 60
    if min < 60 { return "\(min)m ago" }
    let hr = min / 60
    if hr < 24 { return "\(hr)h ago" }
    return "\(hr / 24)d ago"
  }

  private static let lowercaseWords: Set<String> = ["and", "or", "of", "the", "to"]
  private static let acronyms: Set<String> = ["atm", "bnpl", "tv"]

  /// "FOOD_AND_DRINK" → "Food and Drink" — humanizePfc.
  static func humanizePfc(_ pfc: String) -> String {
    pfc.lowercased()
      .split(separator: "_", omittingEmptySubsequences: false)
      .enumerated()
      .map { i, part in
        let word = String(part)
        if acronyms.contains(word) { return word.uppercased() }
        if i > 0 && lowercaseWords.contains(word) { return word }
        return word.prefix(1).uppercased() + word.dropFirst()
      }
      .joined(separator: " ")
  }

  /// Plain number for an edit field: 5000 → "5000", 5000.5 → "5000.5".
  static func plainNumber(_ value: Double) -> String {
    value.formatted(.number.grouping(.never).locale(enUS))
  }

  /// Parses the ISO strings the API sends — Prisma's
  /// "2026-10-05T00:00:00.000Z", the same without fractional seconds, or a
  /// bare "2026-10-05", which JavaScript reads as UTC midnight.
  static func parseISO(_ s: String) -> Date? {
    for style in isoStyles {
      if let d = try? style.parse(s) { return d }
    }
    return nil
  }

  private static let isoStyles: [Date.ISO8601FormatStyle] = [
    .iso8601.year().month().day().time(includingFractionalSeconds: true).timeZone(separator: .omitted),
    .iso8601,
    Date.ISO8601FormatStyle().year().month().day(),
  ]

  /// "$1.2K" — formatCompactCurrency: compact notation, at most one
  /// decimal, halves rounded away from zero as Intl does.
  static func compactCurrency(_ amount: Double) -> String {
    amount.formatted(
      .currency(code: "USD")
        .notation(.compactName)
        .precision(.fractionLength(0...1))
        .rounded(rule: .toNearestOrAwayFromZero)
        .locale(enUS))
  }

  /// JavaScript's Math.round: halves go toward +∞ (-2.5 → -2), unlike
  /// Swift's `.rounded()`.
  static func mathRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
}
