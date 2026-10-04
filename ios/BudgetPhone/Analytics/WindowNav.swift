import SwiftUI

/// The charts' month controls (../src/components/charts/WindowNav.tsx):
/// pan ‹ › and, where the chart zooms, − +.
struct WindowNav: View {
  let canEarlier: Bool
  let canLater: Bool
  let pan: (Int) -> Void
  var canZoomIn = false
  var canZoomOut = false
  var zoom: ((Int) -> Void)?
  /// Grows with Dynamic Type, like the symbols themselves.
  @ScaledMetric(relativeTo: .subheadline) private var iconSize = 14.0

  var body: some View {
    HStack(spacing: 8) {
      HStack(spacing: 0) {
        button("Earlier", "chevron.left", enabled: canEarlier) { pan(-1) }
        button("Later", "chevron.right", enabled: canLater) { pan(1) }
      }
      if let zoom {
        HStack(spacing: 0) {
          button("Fewer months", "minus", enabled: canZoomIn) { zoom(-1) }
          button("More months", "plus", enabled: canZoomOut) { zoom(1) }
        }
      }
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.bordered)
    .controlSize(.small)
  }

  /// Symbols differ in height ("minus" is flatter than "plus"), so each
  /// icon gets the same frame and every button comes out the same size.
  private func button(
    _ title: String, _ symbol: String, enabled: Bool, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Label {
        Text(title)
      } icon: {
        Image(systemName: symbol).frame(width: iconSize, height: iconSize)
      }
    }
    .disabled(!enabled)
  }
}

extension WindowNav {
  /// Pan and zoom over a `MonthWindow`.
  init(window: Binding<MonthWindow>) {
    let w = window.wrappedValue
    self.init(
      canEarlier: w.canEarlier, canLater: w.canLater, pan: { window.wrappedValue.pan($0) },
      canZoomIn: w.canZoomIn, canZoomOut: w.canZoomOut, zoom: { window.wrappedValue.zoom($0) })
  }
}
