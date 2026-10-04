import SwiftUI

struct AccountRow: View {
  let account: AccountDTO
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @AppStorage(AmountPrivacy.storageKey) private var amountsHidden = false

  var body: some View {
    let status = PaymentStatus.of(account)
    Group {
      // Side by side wraps the balance digit by digit once the name column
      // and the amount column both need most of the width; stack instead.
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 4) {
          info(status)
          amounts(alignment: .leading)
        }
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          info(status)
          Spacer(minLength: 0)
          amounts(alignment: .trailing)
        }
      }
    }
    // A disconnected bank's account: greyed, its balance frozen and counted
    // in no total.
    .opacity(account.disconnected ? 0.5 : 1)
    .accessibilityElement(children: .combine)
  }

  private func info(_ status: PaymentStatus?) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(account.title).lineLimit(1)
      Text(account.subtitle)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(1)
      if let line = account.disconnectedLine() {
        Text(line)
          .font(.footnote.weight(.medium))
          .foregroundStyle(.secondary)
      }
      if let status {
        Text(amountsHidden ? AmountPrivacy.mask(status.text) : status.text)
          .font(.footnote.weight(status.tone == .normal ? .regular : .medium))
          .foregroundStyle(status.tone.color)
      }
    }
  }

  private func amounts(alignment: HorizontalAlignment) -> some View {
    VStack(alignment: alignment, spacing: 2) {
      AmountText(Formatters.currency(account.signedBalance))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      if let available = account.availableWorthShowing {
        AmountText("\(account.availableLabel) \(Formatters.currency(available))")
          .font(.caption)
          .foregroundStyle(.secondary)
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      }
    }
  }
}

extension PaymentStatus.Tone {
  var color: Color {
    switch self {
    case .normal: .secondary
    case .soon: .orange
    case .overdue: .red
    }
  }
}
