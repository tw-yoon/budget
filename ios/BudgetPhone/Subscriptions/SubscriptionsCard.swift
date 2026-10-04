import SwiftUI

/// Pushes the Subscriptions list.
struct SubscriptionsRoute: Hashable {}

/// The Subscriptions entry on Analytics: the web page's header line, a
/// tap to open the list, and a long-press menu to detect from banks.
struct SubscriptionsCard: View {
  let store: SubscriptionsStore

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      NavigationLink(value: SubscriptionsRoute()) {
        HStack(alignment: .firstTextBaseline) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Subscriptions").font(.headline)
            summary
          }
          Spacer(minLength: 8)
          if store.isDetecting { ProgressView().controlSize(.small) }
          Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .contextMenu {
        Button("Detect from Banks", systemImage: "arrow.triangle.2.circlepath") {
          Task { await store.detect() }
        }
        .disabled(store.isDetecting)
      }

      if let notice = store.notice {
        message(notice, symbol: "checkmark.circle.fill", tint: .green) { store.notice = nil }
      }
      if let banner = store.banner {
        message(banner, symbol: "exclamationmark.triangle.fill", tint: .orange) { store.banner = nil }
      }
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
  }

  @ViewBuilder private var summary: some View {
    if let data = store.data {
      AmountText(data.summary).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
    } else if store.error == nil {
      ProgressView().controlSize(.small)
    } else {
      Text("Couldn't load subscriptions.").font(.subheadline).foregroundStyle(.secondary)
    }
  }

  private func message(
    _ text: String, symbol: String, tint: Color, dismiss: @escaping () -> Void
  ) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: symbol).foregroundStyle(tint)
      Text(text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly)
        .foregroundStyle(.secondary)
    }
  }
}
