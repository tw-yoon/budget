import Foundation
import Testing
@testable import BudgetPhone

/// SpendingGraph's math (../src/components/charts/SpendingGraph.tsx).
struct SpendingMathTests {
  /// July 160 in total, August 240, September (the current month) 50 so far.
  let days = [
    DailySpend(date: "2026-07-01", amount: 100), DailySpend(date: "2026-07-03", amount: 50),
    DailySpend(date: "2026-07-31", amount: 10), DailySpend(date: "2026-08-02", amount: 200),
    DailySpend(date: "2026-08-15", amount: 40), DailySpend(date: "2026-09-01", amount: 30),
    DailySpend(date: "2026-09-10", amount: 20),
  ]
  let today = SpendingMath.Today(year: 2026, month: 9, day: 12)

  func month(_ p: SpendingMath.Prepared, _ key: String) throws -> SpendingMath.Month {
    try #require(p.months.first { $0.key == key })
  }

  @Test func monthsRunFromFirstToLastWithGapsFilled() {
    let p = SpendingMath.prepare(
      [DailySpend(date: "2026-07-01", amount: 1), DailySpend(date: "2026-09-01", amount: 1)],
      today: today)
    #expect(p.months.map(\.key) == ["2026-07", "2026-08", "2026-09"])
    #expect(p.months.map(\.label) == ["July 2026", "August 2026", "September 2026"])
    #expect(p.currentKey == "2026-09")
  }

  @Test func monthsCrossAYear() {
    let p = SpendingMath.prepare(
      [DailySpend(date: "2025-11-01", amount: 1), DailySpend(date: "2026-01-01", amount: 1)],
      today: today)
    #expect(p.months.map(\.key) == ["2025-11", "2025-12", "2026-01"])
  }

  /// A month outside 1...12 once indexed the month names out of range. A
  /// key that can't be read as a month is no bound, so with one at an end
  /// no calendar is built (months is empty); the one valid month isn't shown.
  @Test func aMonthOutOfRangeDoesNotCrash() {
    let p = SpendingMath.prepare(
      [DailySpend(date: "2026-13-01", amount: 5), DailySpend(date: "2026-07-01", amount: 1)],
      today: today)
    #expect(p.months.isEmpty || p.months.map(\.key).contains("2026-07"))
    let zero = SpendingMath.prepare(
      [DailySpend(date: "2026-00-01", amount: 5), DailySpend(date: "2026-07-01", amount: 1)],
      today: today)
    #expect(zero.months.isEmpty || zero.months.map(\.key).contains("2026-07"))
  }

  @Test func defaultLimitIsThePastAverageToTheNearest250() {
    // (160 + 240) / 2 = 200 → 250, floored at 500.
    #expect(SpendingMath.prepare(days, today: today).defaultLimit == 500)
    let big = [
      DailySpend(date: "2026-07-01", amount: 1000), DailySpend(date: "2026-08-01", amount: 1250),
    ]
    // 1125 / 250 = 4.5 → Math.round → 5 → 1250.
    #expect(SpendingMath.prepare(big, today: today).defaultLimit == 1250)
    #expect(SpendingMath.prepare([], today: today).defaultLimit == 3000)
    let onlyThisMonth = [DailySpend(date: "2026-09-01", amount: 9000)]
    #expect(SpendingMath.prepare(onlyThisMonth, today: today).defaultLimit == 3000)
  }

  @Test func theCurrentMonthStopsAtToday() throws {
    let p = SpendingMath.prepare(days, today: today)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-09"), compare: .lastMonth, limit: 500, today: today)
    #expect(chart.days == 30)
    #expect(chart.rows.count == 30)
    #expect(chart.rows[0].current == 30)
    #expect(chart.rows[9].current == 50)
    #expect(chart.rows[11].current == 50)
    #expect(chart.rows[12].current == nil)
    #expect(chart.peak == 50)
    #expect(chart.spent == 50)
  }

  @Test func aPastMonthRunsToItsLastDay() throws {
    let p = SpendingMath.prepare(days, today: today)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-08"), compare: .lastMonth, limit: 500, today: today)
    #expect(chart.rows.count == 31)
    #expect(chart.rows[30].current == 240)
    #expect(chart.peak == 240)
  }

  @Test func averageUsesCompleteMonthsOnly() throws {
    let p = SpendingMath.prepare(days, today: today)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-09"), compare: .lastMonth, limit: 500, today: today)
    #expect(chart.rows[0].average == 50)  // (100 + 0) / 2
    #expect(chart.rows[1].average == 150)  // (100 + 200) / 2
    #expect(chart.rows[2].average == 175)  // (150 + 200) / 2
  }

  @Test func compareIsLastMonthOrLastYear() throws {
    let p = SpendingMath.prepare(days, today: today)
    let sep = try month(p, "2026-09")
    let lastMonth = SpendingMath.chart(p, month: sep, compare: .lastMonth, limit: 500, today: today)
    #expect(lastMonth.rows[1].compare == 200)
    #expect(lastMonth.rows[29].compare == 240)
    let lastYear = SpendingMath.chart(p, month: sep, compare: .lastYear, limit: 500, today: today)
    #expect(lastYear.rows.allSatisfy { $0.compare == 0 }, "a month with no data is a flat zero line")
  }

  @Test func lastMonthOfJanuaryIsDecember() throws {
    let janToday = SpendingMath.Today(year: 2026, month: 1, day: 20)
    let p = SpendingMath.prepare(
      [DailySpend(date: "2025-12-05", amount: 70), DailySpend(date: "2026-01-02", amount: 10)],
      today: janToday)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-01"), compare: .lastMonth, limit: 500, today: janToday)
    #expect(chart.rows[4].compare == 70)
  }

  @Test func cumulativeIsRoundedToCents() throws {
    let p = SpendingMath.prepare(
      [DailySpend(date: "2026-08-01", amount: 0.1), DailySpend(date: "2026-08-02", amount: 0.2)],
      today: today)
    let chart = SpendingMath.chart(
      p, month: try month(p, "2026-08"), compare: .lastMonth, limit: 500, today: today)
    #expect(chart.rows[1].current == 0.3)
  }

  @Test func topAndSplits() throws {
    let p = SpendingMath.prepare(days, today: today)
    let sep = try month(p, "2026-09")
    let under = SpendingMath.chart(p, month: sep, compare: .lastMonth, limit: 500, today: today)
    #expect(under.top == 600)  // max 500 × 1.06 = 530 → step 100
    #expect(under.splitFill == 0)
    #expect(under.splitLine == 0)
    let over = SpendingMath.chart(p, month: sep, compare: .lastMonth, limit: 40, today: today)
    #expect(abs(over.splitFill - 0.2) < 1e-9)  // 1 − 40 / 50
    #expect(over.splitLine == 0.5)  // (50 − 40) / (50 − 30)
  }

  @Test func niceCeilSteps() {
    #expect(SpendingMath.niceCeil(0) == 500)
    #expect(SpendingMath.niceCeil(-5) == 500)
    #expect(SpendingMath.niceCeil(150) == 150)
    #expect(SpendingMath.niceCeil(201) == 300)
    #expect(SpendingMath.niceCeil(1001) == 1500)
    #expect(SpendingMath.niceCeil(4001) == 5000)
  }

  @Test func ticksEndOnTheLastDay() throws {
    for (date, last) in [("2026-02-01", 28), ("2026-04-01", 30), ("2026-05-01", 31)] {
      let p = SpendingMath.prepare([DailySpend(date: date, amount: 1)], today: today)
      let chart = SpendingMath.chart(
        p, month: try #require(p.months.first), compare: .lastMonth, limit: 500, today: today)
      #expect(chart.ticks == [1, 5, 10, 15, 20, 25, last])
    }
  }

  @Test func statusLine() {
    let under = SpendingMath.status(spent: 450, limit: 500)
    #expect(under.text == "$50.00 left of the $500.00 limit")
    #expect(!under.over)
    let over = SpendingMath.status(spent: 620, limit: 500)
    #expect(over.text == "$120.00 over the $500.00 limit")
    #expect(over.over)
  }

  @Test func todayFromADate() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let date = calendar.date(from: DateComponents(year: 2026, month: 9, day: 30))!
    #expect(SpendingMath.Today(date, calendar: calendar) == SpendingMath.Today(year: 2026, month: 9, day: 30))
  }

  /// Excluding rent takes each day's Rent and Utilities part out of every
  /// series; a day without the field (an older server) is unchanged.
  @Test func excludingRentSubtractsItFromEachDay() throws {
    let json = #"{"days":[{"date":"2026-09-01","amount":1530,"rentAndUtilities":1500},{"date":"2026-09-10","amount":20}]}"#
    let series = try JSONDecoder().decode(SpendingSeries.self, from: Data(json.utf8))
    #expect(series.days[0].rentAndUtilities == 1500)
    #expect(series.days[1].rentAndUtilities == nil)
    #expect(SpendingMath.excludingRent(series.days) == [
      DailySpend(date: "2026-09-01", amount: 30), DailySpend(date: "2026-09-10", amount: 20),
    ])
  }
}
