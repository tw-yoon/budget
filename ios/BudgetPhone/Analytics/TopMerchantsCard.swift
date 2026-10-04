import SwiftUI

/// The summary range's five biggest merchants by spend. Phone-only: the
/// server's /api/analytics sends `topMerchants`, but the web page doesn't
/// draw them.
struct TopMerchantsCard: View {
  let merchants: [MerchantTotal]
  let range: Int
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    ChartCard(title: "Top merchants", subtitle: "Last \(range) months") {
      EmptyView()
    } content: {
      if merchants.isEmpty {
        Text("No spending in this range.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .center)
          .padding(.vertical, 8)
      } else {
        VStack(spacing: 10) {
          ForEach(Array(merchants.enumerated()), id: \.offset) { index, merchant in
            if index > 0 { Divider() }
            row(index + 1, merchant)
          }
        }
      }
    }
  }

  private func row(_ rank: Int, _ merchant: MerchantTotal) -> some View {
    let name = VStack(alignment: .leading, spacing: 2) {
      Text(merchant.name).lineLimit(1)
      Text(Self.countLabel(merchant.count)).font(.caption).foregroundStyle(.secondary)
    }
    let amount = AmountText(Formatters.currency(merchant.amount))
      .monospacedDigit()
      .lineLimit(1)
      .fixedSize()
    return HStack(alignment: .firstTextBaseline, spacing: 12) {
      Text("\(rank)")
        .font(.subheadline.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(.secondary)
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 2) { name; amount }
      } else {
        name
        Spacer(minLength: 8)
        amount
      }
    }
    .accessibilityElement(children: .combine)
  }

  /// "1 purchase", "3 purchases".
  nonisolated static func countLabel(_ count: Int) -> String {
    count == 1 ? "1 purchase" : "\(count) purchases"
  }
}
