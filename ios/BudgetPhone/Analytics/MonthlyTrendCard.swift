import Charts
import SwiftUI

/// Monthly spending vs income (../src/components/charts/MonthlyTrendChart.tsx):
/// grouped bars over the windowed months. The phone shows at most three
/// months at once (the web opens on six).
struct MonthlyTrendCard: View {
  let months: [CashflowMonth]
  /// Bars grow up from the baseline, one after another (AnalyticsEntrance).
  var animatesIn = false
  @State private var window = MonthWindow(defaultSpan: 3, maxSpan: 3)
  @State private var selectedKey: String?

  private struct Bar: Identifiable {
    let key: String
    let series: String
    let amount: Double
    var id: String { key + series }
  }

  var body: some View {
    let shown = Array(months[window.range.clamped(to: 0..<months.count)])
    let bars = shown.flatMap {
      [
        Bar(key: $0.key, series: "Income", amount: $0.totalIncome),
        Bar(key: $0.key, series: "Spent", amount: $0.totalSpent),
      ]
    }
    let short = Dictionary(
      shown.map { ($0.key, String($0.label.split(separator: " ").first ?? "")) },
      uniquingKeysWith: { a, _ in a })

    ChartCard(title: "Monthly spending vs income", subtitle: MonthWindow.label(shown.map(\.label))) {
      WindowNav(window: $window)
    } content: {
      ChartEntrance(animatesIn: animatesIn) { progress in
        chart(bars: bars, shown: shown, short: short, progress: progress)
      }
    }
    .onChange(of: months.count, initial: true) { _, count in window.setTotal(count) }
  }

  private func chart(bars: [Bar], shown: [CashflowMonth], short: [String: String], progress: Double)
    -> some View
  {
    // While the bars grow, an unseen rule at the tallest bar holds the
    // y-axis at its final scale.
    let top = bars.map(\.amount).max() ?? 0
    return Chart {
      ForEach(Array(bars.enumerated()), id: \.element.id) { index, bar in
        let grown = AnalyticsEntrance.staggered(progress, index: index, count: bars.count)
        BarMark(x: .value("Month", bar.key), y: .value("Amount", bar.amount * grown))
          .foregroundStyle(by: .value("Series", bar.series))
          .position(by: .value("Series", bar.series))
          .cornerRadius(3)
      }
      if progress < 1 {
        RuleMark(y: .value("Amount", top)).foregroundStyle(.clear)
      }
      if let key = selectedKey, let month = shown.first(where: { $0.key == key }) {
        RuleMark(x: .value("Month", key))
          .foregroundStyle(Color.secondary.opacity(0.15))
          .annotation(
            position: .top, spacing: 0,
            overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
          ) {
            VStack(alignment: .leading, spacing: 2) {
              Text(month.label).fontWeight(.semibold)
              AmountText("Income \(Formatters.currency(month.totalIncome))")
              AmountText("Spent \(Formatters.currency(month.totalSpent))")
            }
            .chartReadout()
          }
      }
    }
    .chartForegroundStyleScale([
      "Income": CategoryColors.color(hex: CategoryColors.income),
      "Spent": CategoryColors.color(hex: CategoryColors.hub),
    ])
    .chartXAxis {
      AxisMarks { value in
        AxisValueLabel {
          if let key = value.as(String.self) { Text(short[key] ?? key) }
        }
      }
    }
    .chartYAxis {
      AxisMarks { value in
        AxisGridLine()
        AxisValueLabel {
          if let amount = value.as(Double.self) { AmountText(Formatters.compactCurrency(amount)) }
        }
      }
    }
    .chartXSelection(value: $selectedKey)
    .chartLegend(position: .bottom)
    .frame(height: 240)
  }
}
