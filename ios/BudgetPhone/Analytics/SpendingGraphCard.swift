import Charts
import SwiftUI

/// The cumulative Spending graph (../src/components/charts/SpendingGraph.tsx),
/// shown in Pro mode only: this month against its limit, the long-run
/// average, and last month or last year.
struct SpendingGraphCard: View {
  let store: AnalyticsStore
  /// The plot draws in from left to right (AnalyticsEntrance).
  var animatesIn = false
  /// nil = the latest month.
  @State private var selectedIndex: Int?
  @State private var compare: SpendingMath.Compare = .lastMonth
  @State private var editingLimit = false
  @State private var selectedDay: Int?
  @AppStorage("spendingExcludesRent") private var excludesRent = false
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  private let under = CategoryColors.color(hex: CategoryColors.income)
  private let over = CategoryColors.color(hex: CategoryColors.draw)
  private let averageColor = CategoryColors.color(hex: "#94a3b8")
  private let compareColor = CategoryColors.color(hex: "#64748b")

  var body: some View {
    let today = SpendingMath.Today(.now)
    let days = store.spending ?? []
    let prepared = SpendingMath.prepare(
      excludesRent ? SpendingMath.excludingRent(days) : days, today: today)
    let months = prepared.months
    let index = min(max(0, selectedIndex ?? months.count - 1), max(0, months.count - 1))
    let month = months.indices.contains(index) ? months[index] : nil
    let limit = store.limitOverride ?? prepared.defaultLimit

    ChartCard(title: "Spending", subtitle: month?.label ?? "—") {
      WindowNav(
        canEarlier: index > 0, canLater: index < months.count - 1,
        pan: { selectedIndex = index + $0 })
    } content: {
      let stacked = dynamicTypeSize.isAccessibilitySize
      let controls =
        stacked
        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
        : AnyLayout(HStackLayout(spacing: 8))
      controls {
        Button {
          editingLimit = true
        } label: {
          AmountText("Limit \(Formatters.currency(limit))")
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.5)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .layoutPriority(1)
        Picker("Compare", selection: $compare) {
          ForEach(SpendingMath.Compare.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
      }
      Toggle("Exclude Rent & Utilities", isOn: $excludesRent)
        .font(.subheadline)
      if store.spending == nil {
        if store.isLoading {
          ProgressView().frame(maxWidth: .infinity, minHeight: 240)
        } else {
          Text("Couldn't load spending.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 240)
        }
      } else if let month,
        case let chart = SpendingMath.chart(
          prepared, month: month, compare: compare, limit: limit, today: today),
        chart.peak != 0
      {
        ChartEntrance(animatesIn: animatesIn) { progress in
          plot(chart, limit: limit, progress: progress)
        }
        legend(chart, limit: limit)
      } else {
        Text("No spending in \(month?.label ?? "this month").")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, minHeight: 240)
      }
    }
    .sheet(isPresented: $editingLimit) {
      LimitSheet(limit: limit) { value in
        Task { await store.saveLimit(value, current: limit) }
      }
    }
  }

  /// Solid when the series stays on one side of the limit; otherwise a
  /// hard red-to-green split at `split` (top = 0), as the web's gradients.
  private func splitStyle(_ split: Double, opacity: Double) -> AnyShapeStyle {
    if split <= 0 { return AnyShapeStyle(under.opacity(opacity)) }
    if split >= 1 { return AnyShapeStyle(over.opacity(opacity)) }
    return AnyShapeStyle(
      LinearGradient(
        stops: [
          .init(color: over.opacity(opacity), location: 0),
          .init(color: over.opacity(opacity), location: split),
          .init(color: under.opacity(opacity), location: split),
          .init(color: under.opacity(opacity), location: 1),
        ], startPoint: .top, endPoint: .bottom))
  }

  private func plot(_ chart: SpendingMath.Chart, limit: Double, progress: Double) -> some View {
    let currentRows = chart.rows.filter { $0.current != nil }
    return Chart {
      ForEach(chart.rows, id: \.day) { row in
        if let average = row.average {
          LineMark(
            x: .value("Day", row.day), y: .value("Amount", average),
            series: .value("Series", "Average")
          )
          .foregroundStyle(averageColor)
          .lineStyle(StrokeStyle(lineWidth: 1.5))
        }
        if let compared = row.compare {
          LineMark(
            x: .value("Day", row.day), y: .value("Amount", compared),
            series: .value("Series", "Compare")
          )
          .foregroundStyle(compareColor)
          .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
        }
      }
      ForEach(currentRows, id: \.day) { row in
        AreaMark(
          x: .value("Day", row.day), y: .value("Amount", row.current ?? 0),
          series: .value("Series", "This month")
        )
        .foregroundStyle(splitStyle(chart.splitFill, opacity: 0.2))
        LineMark(
          x: .value("Day", row.day), y: .value("Amount", row.current ?? 0),
          series: .value("Series", "This month line")
        )
        .foregroundStyle(splitStyle(chart.splitLine, opacity: 1))
        .lineStyle(StrokeStyle(lineWidth: 2.5))
      }
      RuleMark(y: .value("Limit", limit))
        .foregroundStyle(Color.secondary)
        .lineStyle(StrokeStyle(lineWidth: 1, dash: [5, 4]))
        .annotation(position: .top, alignment: .trailing) {
          AmountText("Limit \(Formatters.compactCurrency(limit))")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      if let day = selectedDay, let row = chart.rows.first(where: { $0.day == day }) {
        RuleMark(x: .value("Day", day))
          .foregroundStyle(Color.secondary.opacity(0.3))
          .annotation(
            position: .top, spacing: 0,
            overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
          ) {
            readout(row)
          }
      }
    }
    .chartXScale(domain: 1...chart.days)
    .chartYScale(domain: 0...chart.top)
    .chartXAxis { AxisMarks(values: chart.ticks) }
    .chartYAxis {
      AxisMarks { value in
        AxisGridLine()
        AxisValueLabel {
          if let amount = value.as(Double.self) { AmountText(Formatters.compactCurrency(amount)) }
        }
      }
    }
    // The entrance uncovers the plot from its left edge, so the lines draw
    // in day by day; the axes stay put. The mask reaches well past the plot
    // on the other sides, and past the right too once done, so the limit
    // label and the readout above the plot are never cut off.
    .chartPlotStyle { plot in
      plot.mask {
        GeometryReader { geometry in
          let margin: CGFloat = 400
          let right = progress >= 1 ? geometry.size.width + margin : geometry.size.width * max(0, progress)
          Rectangle()
            .frame(width: right + margin, height: geometry.size.height + 2 * margin)
            .position(x: (right - margin) / 2, y: geometry.size.height / 2)
        }
      }
    }
    .chartXSelection(value: $selectedDay)
    .chartLegend(.hidden)
    .frame(height: 240)
  }

  private func readout(_ row: SpendingMath.Row) -> some View {
    func line(_ name: String, _ value: Double?) -> AmountText {
      AmountText("\(name) \(value.map(Formatters.currency) ?? "—")")
    }
    return VStack(alignment: .leading, spacing: 2) {
      Text("Day \(row.day)").fontWeight(.semibold)
      line("This month", row.current)
      line("Average", row.average)
      line(compare.label, row.compare)
    }
    .chartReadout()
  }

  private func legend(_ chart: SpendingMath.Chart, limit: Double) -> some View {
    let status = SpendingMath.status(spent: chart.spent, limit: limit)
    return VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Capsule()
          .fill(LinearGradient(colors: [under, over], startPoint: .leading, endPoint: .trailing))
          .frame(width: 16, height: 6)
        AmountText("This month \(Formatters.currency(chart.spent))").monospacedDigit()
      }
      HStack(spacing: 6) {
        Capsule().fill(averageColor).frame(width: 16, height: 2)
        Text("Average")
      }
      HStack(spacing: 6) {
        Path { p in
          p.move(to: CGPoint(x: 0, y: 1))
          p.addLine(to: CGPoint(x: 16, y: 1))
        }
        .stroke(compareColor, style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
        .frame(width: 16, height: 2)
        Text(compare.label)
      }
      AmountText(status.text)
        .monospacedDigit()
        .foregroundStyle(status.over ? Color.red : Color.green)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}
