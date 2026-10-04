import SwiftUI

struct NetWorthHeader: View {
  let summary: AccountsSummary
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @AppStorage(AmountPrivacy.storageKey) private var amountsHidden = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Text("Net Worth")
        // Says why every figure in the app is blurred.
        if amountsHidden { Image(systemName: "eye.slash") }
      }
      .font(.subheadline)
      .foregroundStyle(.secondary)
      AmountText(Formatters.currency(summary.netWorth))
        .font(.largeTitle.weight(.semibold))
        .monospacedDigit()
        .minimumScaleFactor(0.6)
        .lineLimit(1)
      // Side by side reads fine until accessibility sizes make each figure
      // wider than half the screen; stack instead of letting the amount wrap.
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 8) {
          figure("Assets", summary.totalAssets, .green)
          figure("Liabilities", summary.totalLiabilities, .red)
        }
        .font(.subheadline)
      } else {
        HStack(spacing: 16) {
          figure("Assets", summary.totalAssets, .green)
          figure("Liabilities", summary.totalLiabilities, .red)
        }
        .font(.subheadline)
      }
      // Next to the figures it dates, as on the web's net-worth card.
      if let refreshed = summary.lastRefreshed.flatMap(Formatters.parseISO) {
        UpdatedLine(date: refreshed)
      }
    }
    .padding(.vertical, 4)
    .frame(maxWidth: .infinity, alignment: .leading)
    // A tap anywhere on the card, not just on the figures.
    .contentShape(.rect)
    .onTapGesture { amountsHidden.toggle() }
    .sensoryFeedback(.selection, trigger: amountsHidden)
    .accessibilityElement(children: .combine)
    .accessibilityValue(amountsHidden ? "Amounts hidden" : "")
    .accessibilityAddTraits(.isButton)
    .accessibilityHint(amountsHidden ? "Shows amounts" : "Hides amounts")
  }

  @ViewBuilder
  private func figure(_ label: String, _ amount: Double, _ color: Color) -> some View {
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) {
        Text(label).foregroundStyle(.secondary)
        amountText(amount, color)
      }
    } else {
      HStack(spacing: 4) {
        Text(label).foregroundStyle(.secondary)
        amountText(amount, color)
      }
    }
  }

  private func amountText(_ amount: Double, _ color: Color) -> some View {
    AmountText(Formatters.currency(amount))
      .foregroundStyle(color)
      .monospacedDigit()
      .lineLimit(1)
      .minimumScaleFactor(0.6)
  }
}

/// "Balances updated 5m ago", orange with a warning sign once older than an
/// hour — the web's STALE_THRESHOLD_MIN and its "⚠ " prefix.
private struct UpdatedLine: View {
  let date: Date

  var body: some View {
    TimelineView(.periodic(from: .now, by: 60)) { context in
      let stale = context.date.timeIntervalSince(date) > 60 * 60
      // An HStack, not a Label: Label reserves the icon's width even when
      // there is no icon, which indented the fresh case.
      HStack(spacing: 4) {
        if stale { Image(systemName: "exclamationmark.triangle.fill") }
        Text("Balances updated \(Formatters.relative(date, now: context.date))")
      }
      .font(.footnote)
      .foregroundStyle(stale ? .orange : .secondary)
    }
  }
}
