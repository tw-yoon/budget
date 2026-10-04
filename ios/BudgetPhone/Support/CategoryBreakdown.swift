import Foundation

/// One donut slice of Spending by category.
struct CategorySlice: Equatable, Identifiable, Sendable {
  let category: String
  let amount: Double
  var id: String { category }
}

/// CategoryChart's data (../src/components/charts/CategoryChart.tsx).
enum CategoryBreakdown {
  /// Spend summed per category over the windowed months, largest first
  /// (ties keep first-seen order, as the web's stable sort does), then folded.
  static func slices(_ months: some Sequence<CashflowMonth>) -> [CategorySlice] {
    var order: [String] = []
    var totals: [String: Double] = [:]
    for month in months {
      for spend in month.spend {
        if totals[spend.category] == nil { order.append(spend.category) }
        totals[spend.category, default: 0] += spend.amount
      }
    }
    let sorted = order.enumerated()
      .map { (index: $0.offset, slice: CategorySlice(category: $0.element, amount: totals[$0.element] ?? 0)) }
      .sorted { a, b in
        a.slice.amount != b.slice.amount ? a.slice.amount > b.slice.amount : a.index < b.index
      }
      .map(\.slice)
    return fold(sorted)
  }

  /// fold: the top 8, with the long tail as one "Other" slice — added to
  /// an existing "Other" in the top 8 if there is one.
  static func fold(_ slices: [CategorySlice]) -> [CategorySlice] {
    let top = Array(slices.prefix(8))
    let rest = slices.dropFirst(8)
    guard !rest.isEmpty else { return top }
    let tail = rest.reduce(0) { $0 + $1.amount }
    if top.contains(where: { $0.category == "Other" }) {
      return top.map {
        $0.category == "Other" ? CategorySlice(category: "Other", amount: $0.amount + tail) : $0
      }
    }
    return top + [CategorySlice(category: "Other", amount: tail)]
  }

  /// The legend's share: Math.round((amount / (sum || 1)) * 100).
  static func percent(_ amount: Double, of sum: Double) -> Int {
    Int(Formatters.mathRound(amount / (sum == 0 ? 1 : sum) * 100))
  }

  /// The slice a `chartAngleSelection` value falls in (values accumulate
  /// slice by slice in chart order).
  static func slice(at value: Double, in slices: [CategorySlice]) -> CategorySlice? {
    var running = 0.0
    for slice in slices {
      running += slice.amount
      if value <= running { return slice }
    }
    return nil
  }
}
