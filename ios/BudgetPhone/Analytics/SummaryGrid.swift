import SwiftUI

/// One summary card (../src/components/SummaryCards.tsx).
struct SummaryTile: Identifiable, Equatable {
  enum Tone { case neutral, income, spend }

  let label: String
  let value: String
  let tone: Tone
  /// Money, so Hide Amounts blurs it; the transaction count stays.
  var isAmount = true
  var id: String { label }

  static func tiles(_ s: AnalyticsSummary) -> [SummaryTile] {
    [
      SummaryTile(label: "Spent", value: Formatters.currency(s.totalSpent), tone: .neutral),
      SummaryTile(label: "Income", value: Formatters.currency(s.totalIncome), tone: .income),
      SummaryTile(
        label: "Net",
        value: s.net >= 0 ? "+\(Formatters.currency(s.net))" : Formatters.currency(s.net),
        tone: s.net >= 0 ? .income : .spend),
      SummaryTile(label: "Transactions", value: String(s.txCount), tone: .neutral, isAmount: false),
    ]
  }
}

extension SummaryTile.Tone {
  var color: Color {
    switch self {
    case .neutral: .primary
    case .income: .green
    case .spend: .red
    }
  }
}

/// Spent / Income / Net / Transactions, two across (one at accessibility
/// sizes).
struct SummaryGrid: View {
  let summary: AnalyticsSummary
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let columns = Array(
      repeating: GridItem(.flexible(), spacing: 12),
      count: dynamicTypeSize.isAccessibilitySize ? 1 : 2)
    LazyVGrid(columns: columns, spacing: 12) {
      ForEach(SummaryTile.tiles(summary)) { tile in
        VStack(alignment: .leading, spacing: 4) {
          Text(tile.label)
            .font(.caption)
            .textCase(.uppercase)
            .foregroundStyle(.secondary)
          AmountText(tile.value, isPrivate: tile.isAmount)
            .font(.title3.weight(.semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .foregroundStyle(tile.tone.color)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
      }
    }
  }
}
