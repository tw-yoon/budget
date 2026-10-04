import SwiftUI

/// The segmented control at the top of Activity and Benefits. Drawn here,
/// like AppTabBar, rather than with a segmented Picker: on iOS 26 that one's
/// glass thumb swells taller under a tap and slides across, and the bar
/// animates the whole control in from the left on every switch. Here a tap
/// only moves the highlight, at once, as on the tab bar; nothing changes size
/// and the labels never move. Each segment is as wide as its label, with the
/// same room either side, so the gaps between labels are even.
struct SegmentedSwitcher<Segment: Hashable>: View {
  @Binding var selection: Segment
  let segments: [Segment]
  let title: (Segment) -> String

  var body: some View {
    HStack(spacing: 0) {
      ForEach(segments, id: \.self) { item($0) }
    }
    .padding(SegmentedSwitcherMetrics.inset)
    // Not interactive glass: that one stretches and wobbles under a tap.
    .glassEffect(.regular, in: .capsule)
    .fixedSize()
    .accessibilityElement(children: .contain)
  }

  private func item(_ segment: Segment) -> some View {
    let selected = segment == selection
    return Button {
      // No animation, so the bar doesn't slide the control in again.
      var instant = Transaction()
      instant.disablesAnimations = true
      withTransaction(instant) { selection = segment }
    } label: {
      Text(title(segment))
        .font(.subheadline.weight(.medium))
        .lineLimit(1)
        .padding(.horizontal, SegmentedSwitcherMetrics.labelPadding)
        .padding(.vertical, 6)
        .background {
          if selected { Capsule().fill(.quaternary) }
        }
        .contentShape(.capsule)
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

enum SegmentedSwitcherMetrics {
  /// Each side of a label, inside its highlight.
  static let labelPadding: CGFloat = 14
  /// Between the glass and the selected highlight.
  static let inset: CGFloat = 3
}

#Preview {
  @Previewable @State var selection = "Ledger"
  SegmentedSwitcher(selection: $selection, segments: ["Ledger", "Venmo", "Zelle"]) { $0 }
}
