import SwiftUI

/// A dismissible warning over data that is still valid. Shared by every
/// screen that keeps showing what it has when a reload or write fails.
struct Banner: View {
  let text: String
  let dismiss: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
      Text(text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly)
        .foregroundStyle(.secondary)
    }
    .padding(12)
    .background(.regularMaterial, in: .rect(cornerRadius: 12))
    .padding(.horizontal)
  }
}

/// `Banner`'s success-toned twin — a green checkmark instead of the orange
/// warning triangle. Used for a result the user asked for and got (e.g. the
/// Venmo import notice), never for a failure.
struct Notice: View {
  let text: String
  let dismiss: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
      Text(text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly)
        .foregroundStyle(.secondary)
    }
    .padding(12)
    .background(.regularMaterial, in: .rect(cornerRadius: 12))
    .padding(.horizontal)
  }
}
