import SwiftUI

/// The panel every Analytics chart sits in: title and range line, its
/// controls beside them (below at accessibility sizes), then the chart.
struct ChartCard<Controls: View, Content: View>: View {
  let title: String
  let subtitle: String
  @ViewBuilder let controls: Controls
  @ViewBuilder let content: Content
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let stacked = dynamicTypeSize.isAccessibilitySize
    let header =
      stacked
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
      : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
    VStack(alignment: .leading, spacing: 12) {
      header {
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.headline)
          Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
        if !stacked { Spacer(minLength: 0) }
        controls
      }
      content
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
  }
}

extension View {
  /// The popup a chart shows while it is touched. A solid, scheme-aware
  /// fill: a material inside a chart annotation renders as black.
  func chartReadout() -> some View {
    self
      .font(.caption)
      .monospacedDigit()
      .foregroundStyle(.primary)
      .padding(6)
      .background(Color(.systemBackground), in: .rect(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
  }
}
