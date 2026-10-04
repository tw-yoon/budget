import Foundation

// Formatting that matches the web app's src/lib/format.ts, so the phone and
// the browser print the same strings for the same data.
enum Formatters {
  private static let enUS = Locale(identifier: "en_US")

  /// "$1,234.56", "-$12.00" — Intl.NumberFormat("en-US", currency USD).
  static func currency(_ amount: Double) -> String {
    amount.formatted(.currency(code: "USD").locale(enUS))
  }

  /// "Sep 26, 2026" — formatDate, in the calendar's time zone.
  static func date(_ date: Date, calendar: Calendar = .current) -> String {
    let f = DateFormatter()
    f.locale = enUS
    f.timeZone = calendar.timeZone
    f.dateFormat = "MMM d, yyyy"
    return f.string(from: date)
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
    for options: ISO8601DateFormatter.Options in [
      [.withInternetDateTime, .withFractionalSeconds],
      [.withInternetDateTime],
      [.withFullDate],
    ] {
      let f = ISO8601DateFormatter()
      f.formatOptions = options
      f.timeZone = .gmt
      if let d = f.date(from: s) { return d }
    }
    return nil
  }

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
