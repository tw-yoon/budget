import SwiftUI

/// One row of the list (SubscriptionsDashboard's Row). The amounts move
/// under the text at accessibility sizes.
struct SubscriptionRow: View {
  let subscription: SubscriptionDTO
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let stacked = dynamicTypeSize.isAccessibilitySize
    let layout =
      stacked
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
      : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
    layout {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(subscription.name).fontWeight(.medium).lineLimit(stacked ? nil : 1)
          tag(subscription.isDetected ? "detected" : "manual")
          if !subscription.isActive {
            Text("inactive").font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
          }
        }
        Text(subscription.detailLine).font(.caption).foregroundStyle(.secondary)
      }
      if !stacked { Spacer(minLength: 0) }
      VStack(alignment: stacked ? .leading : .trailing, spacing: 2) {
        AmountText(Formatters.currency(subscription.amount))
        AmountText("\(Formatters.currency(subscription.monthlyCost))/mo")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .monospacedDigit()
      .lineLimit(1)
    }
    .opacity(subscription.isActive ? 1 : 0.6)
  }

  private func tag(_ text: String) -> some View {
    Text(text)
      .font(.caption2)
      .textCase(.uppercase)
      .foregroundStyle(.secondary)
      .padding(.horizontal, 5)
      .padding(.vertical, 1)
      .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 4))
  }
}
