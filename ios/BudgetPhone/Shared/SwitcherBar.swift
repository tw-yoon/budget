import SwiftUI

/// The navigation bar's one item on a tab with a SegmentedSwitcher: the
/// switcher in the centre and each segment's trailing button at the bar's
/// trailing edge. The buttons are kept here rather than as trailing items of
/// each segment, so a switch fades one out and the next in instead of popping,
/// and the bar never re-lays out. (A trailing item can't fade: the bar draws
/// its glass, and hides any glass drawn inside it. So each button draws its
/// own, with `barGlass`.)
struct SwitcherBar<Segment: Hashable, Trailing: View>: View {
  @Binding var selection: Segment
  let segments: [Segment]
  let title: (Segment) -> String
  /// The screen's width: the bar centres an item at its own size, so this one
  /// is given the bar's width less its margins.
  let width: CGFloat
  @ViewBuilder let trailing: (Segment) -> Trailing

  var body: some View {
    ZStack {
      SegmentedSwitcher(selection: $selection, segments: segments, title: title)
      ZStack(alignment: .trailing) {
        ForEach(segments, id: \.self) { segment in
          let shown = segment == selection
          trailing(segment)
            .opacity(shown ? 1 : 0)
            .allowsHitTesting(shown)
            .accessibilityHidden(!shown)
        }
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
      // The switcher changes segment with animations off; the fade is the
      // buttons' alone.
      .transaction(value: selection) { t in
        t.disablesAnimations = false
        t.animation = .easeInOut(duration: 0.2)
      }
    }
    .frame(width: max(0, width - 2 * SwitcherBarMetrics.margin))
  }
}

enum SwitcherBarMetrics {
  /// Where the bar puts a trailing button's edge, from the screen's edge.
  static let margin: CGFloat = 16
  /// A bar button's height, and an icon button's width.
  static let button: CGFloat = 44
}

extension View {
  /// A SwitcherBar button's glass, as the bar draws its own: a circle round
  /// an icon, a capsule round text.
  func barGlass(icon: Bool) -> some View {
    self
      .foregroundStyle(.primary)
      .padding(.horizontal, icon ? 0 : 14)
      .frame(
        width: icon ? SwitcherBarMetrics.button : nil,
        height: SwitcherBarMetrics.button)
      .glassEffect(.regular.interactive(), in: .capsule)
  }
}
