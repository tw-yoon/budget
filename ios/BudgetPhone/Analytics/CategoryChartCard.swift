import Charts
import SwiftUI

/// Spending by category (../src/components/charts/CategoryChart.tsx): a
/// donut for one month at a time (the web can zoom out), opening on the
/// latest month.
struct CategoryChartCard: View {
  let months: [CashflowMonth]
  /// The donut sweeps open from 0° to its full angles (AnalyticsEntrance).
  var animatesIn = false
  @State private var window = MonthWindow(defaultSpan: 1, maxSpan: 1)
  @State private var selectedAngle: Double?
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let shown = Array(months[window.range.clamped(to: 0..<months.count)])
    let slices = CategoryBreakdown.slices(shown)
    let sum = slices.reduce(0) { $0 + $1.amount }
    let label = MonthWindow.label(shown.map(\.label))
    // Recharts skips non-positive slices; Swift Charts can't draw them.
    let drawn = slices.filter { $0.amount > 0 }
    let selected = selectedAngle.flatMap { CategoryBreakdown.slice(at: $0, in: drawn) }

    ChartCard(
      title: "Spending by category",
      subtitle: shown.count > 1 ? "\(label) · \(shown.count) months" : label
    ) {
      // One month at a time on the phone: pan only, no zoom.
      WindowNav(canEarlier: window.canEarlier, canLater: window.canLater) { window.pan($0) }
    } content: {
      if slices.isEmpty {
        Text("No spending in \(label).")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, minHeight: 200)
      } else {
        ChartEntrance(animatesIn: animatesIn) { progress in
          donut(drawn, selected: selected, sum: sum, progress: progress)
        }

        VStack(spacing: 6) {
          ForEach(slices) { slice in legendRow(slice, sum: sum) }
        }
        .font(.subheadline)
      }
    }
    .onChange(of: months.count, initial: true) { _, count in window.setTotal(count) }
  }

  /// While it opens, every slice is `progress` of its size and an unseen
  /// last slice holds the rest of the circle, so the slices sweep clockwise
  /// from the top without the ring turning.
  private func donut(_ drawn: [CategorySlice], selected: CategorySlice?, sum: Double, progress: Double)
    -> some View
  {
    let opened = AnalyticsEntrance.clamp(progress)
    let total = drawn.reduce(0) { $0 + $1.amount }
    return Chart {
      ForEach(drawn) { slice in
        if slice.amount * opened > 0 {
          SectorMark(
            angle: .value("Amount", slice.amount * opened), innerRadius: .ratio(0.7), angularInset: 1.5
          )
          .foregroundStyle(CategoryColors.color(for: slice.category))
          .opacity(selected == nil || selected == slice ? 1 : 0.4)
        }
      }
      if opened < 1 {
        SectorMark(angle: .value("Amount", total * (1 - opened)), innerRadius: .ratio(0.7))
          .foregroundStyle(.clear)
      }
    }
    .chartAngleSelection(value: $selectedAngle)
    .chartBackground { proxy in
      GeometryReader { geometry in
        if let plot = proxy.plotFrame {
          let frame = geometry[plot]
          VStack(spacing: 2) {
            Text(selected?.category ?? "Total")
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
            AmountText(Formatters.currency(selected?.amount ?? sum))
              .font(.headline)
              .monospacedDigit()
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          }
          .frame(width: frame.width * 0.6)
          .position(x: frame.midX, y: frame.midY)
        }
      }
    }
    .frame(height: 200)
  }

  @ViewBuilder private func legendRow(_ slice: CategorySlice, sum: Double) -> some View {
    let swatch = RoundedRectangle(cornerRadius: 2)
      .fill(CategoryColors.color(for: slice.category))
      .frame(width: 10, height: 10)
    let percent = Text("\(CategoryBreakdown.percent(slice.amount, of: sum))%")
      .foregroundStyle(.secondary)
    let amount = AmountText(Formatters.currency(slice.amount))
      .monospacedDigit()
      .lineLimit(1)
      .minimumScaleFactor(0.6)
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 8) {
          swatch
          Text(slice.category)
        }
        HStack(spacing: 8) {
          percent
          amount
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      HStack(spacing: 8) {
        swatch
        Text(slice.category).lineLimit(1)
        Spacer(minLength: 4)
        percent
        amount
      }
    }
  }
}
