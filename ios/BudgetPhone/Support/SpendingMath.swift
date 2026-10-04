import Foundation

/// The math behind the web's cumulative Spending graph
/// (../src/components/charts/SpendingGraph.tsx, its two useMemos and the
/// status line), with "today" passed in so tests can pin it.
enum SpendingMath {
  struct Today: Equatable, Sendable {
    let year: Int
    let month: Int
    let day: Int

    init(year: Int, month: Int, day: Int) {
      self.year = year
      self.month = month
      self.day = day
    }

    init(_ date: Date, calendar: Calendar = .current) {
      let c = calendar.dateComponents([.year, .month, .day], from: date)
      self.init(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1)
    }
  }

  struct Month: Equatable, Sendable {
    let year: Int
    let month: Int
    let key: String  // YYYY-MM
    let label: String  // "June 2026"
  }

  enum Compare: CaseIterable, Sendable {
    case lastMonth, lastYear
    var label: String { self == .lastMonth ? "Last month" : "Last year" }
  }

  struct Row: Equatable, Sendable {
    let day: Int
    let current: Double?
    let average: Double?
    let compare: Double?
  }

  struct Chart: Equatable, Sendable {
    let rows: [Row]
    /// The y axis top.
    let top: Double
    /// Cumulative spend on the last day shown.
    let peak: Double
    /// Days in the month.
    let days: Int
    let ticks: [Int]
    /// Where the area fill turns from red (above) to green, top = 0.
    let splitFill: Double
    /// The same for the line, over its own height.
    let splitLine: Double
    var spent: Double { peak }
  }

  struct Prepared: Equatable, Sendable {
    let months: [Month]
    /// Month key → day of month → spend.
    let byMonth: [String: [Int: Double]]
    let defaultLimit: Double
    let currentKey: String
  }

  private static let monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]

  static func key(_ year: Int, _ month: Int) -> String {
    String(format: "%04d-%02d", year, month)
  }

  static func daysInMonth(_ year: Int, _ month: Int) -> Int {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    guard let first = calendar.date(from: DateComponents(year: year, month: month, day: 1)),
      let days = calendar.range(of: .day, in: .month, for: first)
    else { return 30 }
    return days.count
  }

  private static func cents(_ x: Double) -> Double { Formatters.mathRound(x * 100) / 100 }

  static func niceCeil(_ n: Double) -> Double {
    if n <= 0 { return 500 }
    let step: Double = n > 4000 ? 1000 : n > 1000 ? 500 : n > 200 ? 100 : 50
    return (n / step).rounded(.up) * step
  }

  /// The same days without their Rent and Utilities spend (phone only: the
  /// Spending card's Exclude Rent & Utilities toggle).
  static func excludingRent(_ days: [DailySpend]) -> [DailySpend] {
    days.map { DailySpend(date: $0.date, amount: cents($0.amount - ($0.rentAndUtilities ?? 0))) }
  }

  /// Calendar months, the per-day lookup and the default limit.
  static func prepare(_ days: [DailySpend], today: Today) -> Prepared {
    var byMonth: [String: [Int: Double]] = [:]
    for d in days {
      guard let day = Int(d.date.dropFirst(8).prefix(2)) else { continue }
      byMonth[String(d.date.prefix(7)), default: [:]][day, default: 0] += d.amount
    }
    let keys = byMonth.keys.sorted()
    var months: [Month] = []
    func parts(_ key: String) -> (Int, Int)? {
      let p = key.split(separator: "-").compactMap { Int($0) }
      return p.count == 2 && (1...12).contains(p[1]) ? (p[0], p[1]) : nil
    }
    if let first = keys.first.flatMap(parts), let last = keys.last.flatMap(parts) {
      var (y, m) = first
      while y < last.0 || (y == last.0 && m <= last.1) {
        months.append(Month(year: y, month: m, key: key(y, m), label: "\(monthNames[m - 1]) \(y)"))
        m += 1
        if m > 12 {
          m = 1
          y += 1
        }
      }
    }
    let currentKey = key(today.year, today.month)
    let totals = months.filter { $0.key < currentKey }
      .map { (byMonth[$0.key] ?? [:]).values.reduce(0, +) }
      .filter { $0 > 0 }
    let average = totals.isEmpty ? 3000 : totals.reduce(0, +) / Double(totals.count)
    return Prepared(
      months: months, byMonth: byMonth,
      defaultLimit: max(500, Formatters.mathRound(average / 250) * 250), currentKey: currentKey)
  }

  /// The selected month's rows, axis and limit split.
  static func chart(
    _ p: Prepared, month: Month, compare: Compare, limit: Double, today: Today
  ) -> Chart {
    func cumulative(_ year: Int, _ month: Int) -> [Double] {
      let spend = p.byMonth[key(year, month)]
      var running = 0.0
      return (1...daysInMonth(year, month)).map { d in
        running += spend?[d] ?? 0
        return cents(running)
      }
    }

    let days = daysInMonth(month.year, month.month)
    let elapsed = month.key == p.currentKey ? today.day : days
    let current = cumulative(month.year, month.month)

    // Long-run average over complete (past) months.
    let complete = p.months.filter { $0.key < p.currentKey }.map { cumulative($0.year, $0.month) }
    let average: [Double?] = (0..<31).map { i in
      let have = complete.filter { i < $0.count }
      return have.isEmpty ? nil : cents(have.reduce(0) { $0 + $1[i] } / Double(have.count))
    }

    var cy = month.year
    var cm = month.month
    switch compare {
    case .lastMonth:
      cm -= 1
      if cm < 1 {
        cm = 12
        cy -= 1
      }
    case .lastYear:
      cy -= 1
    }
    let comparison = cumulative(cy, cm)

    var rows: [Row] = []
    for d in 1...days {
      let currentValue: Double? = d <= elapsed ? current[d - 1] : nil
      let compareValue: Double? = d - 1 < comparison.count ? comparison[d - 1] : nil
      rows.append(Row(day: d, current: currentValue, average: average[d - 1], compare: compareValue))
    }
    let peak = (1...current.count).contains(elapsed) ? current[elapsed - 1] : 0
    let first = current.first ?? 0
    let maxValue = ([limit, peak, 0] + average.compactMap { $0 } + comparison).max() ?? 0
    let clamp01 = { (x: Double) in min(1, max(0, x)) }
    var ticks: [Int] = []
    for t in [1, 5, 10, 15, 20, 25, days] where t <= days && !ticks.contains(t) { ticks.append(t) }

    return Chart(
      rows: rows,
      top: niceCeil(maxValue * 1.06),
      peak: peak,
      days: days,
      ticks: ticks,
      splitFill: peak > 0 ? clamp01(1 - limit / peak) : 0,
      splitLine: peak > first ? clamp01((peak - limit) / (peak - first)) : (peak > limit ? 1 : 0))
  }

  /// The line under the graph.
  static func status(spent: Double, limit: Double) -> (text: String, over: Bool) {
    if spent > limit {
      return (
        "\(Formatters.currency(spent - limit)) over the \(Formatters.currency(limit)) limit", true
      )
    }
    return (
      "\(Formatters.currency(limit - spent)) left of the \(Formatters.currency(limit)) limit", false
    )
  }
}
