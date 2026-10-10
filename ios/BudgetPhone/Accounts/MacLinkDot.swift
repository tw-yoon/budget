import SwiftUI

/// The Accounts toolbar's connection dot. Tapping it shows `MacLinkCard`.
///
/// The card is drawn by Accounts itself, not a popover or a menu: on a real
/// phone the popover landed below and left of the dot and changed width with
/// its text; a menu has a fixed width that wraps "Connected to Your Mac"
/// once the coloured dot sits beside it, and drops colours from its icons.
struct MacLinkDot: View {
  let link: MacLink
  let updated: Date?
  @Binding var isShowing: Bool
  /// Where the dot is on screen, for the card to open over it.
  @Binding var frame: CGRect
  @Environment(\.accessibilityDifferentiateWithoutColor) private var withoutColor

  var body: some View {
    let text = MacLinkText(link, updated: updated, now: .now)
    Button {
      withAnimation(.snappy) { isShowing.toggle() }
    } label: {
      MacLinkSymbol(link: link, withoutColor: withoutColor)
        .font(withoutColor ? .body : .caption)
        .contentTransition(.symbolEffect(.replace))
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
    }
    .accessibilityLabel("Mac connection")
    .accessibilityValue(
      ([text.title, text.detail].compactMap(\.self)
        + (text.checks.isEmpty ? [] : ["Check that " + text.checks.joined(separator: ", ")]))
        .joined(separator: ". "))
    .accessibilityHint("Shows details")
  }
}

/// What the dot opens: the dot again, the line and the data's age, and when
/// the Mac can't be reached, what to check. One width for every state, so
/// the text always starts at the same place.
struct MacLinkCard: View {
  let link: MacLink
  let updated: Date?
  @Environment(\.accessibilityDifferentiateWithoutColor) private var withoutColor
  /// Room for the dot and the check numbers, so every line's text lines up.
  @ScaledMetric(relativeTo: .body) private var iconWidth = 22
  /// Text width: the same in every state, growing with the text size.
  @ScaledMetric(relativeTo: .body) private var textWidth = 250

  /// Half the glass circle the bar draws around the dot.
  static let circleRadius: CGFloat = 22
  /// The circle's own curve, so the card's corner covers the circle exactly
  /// instead of letting it peek out round the corner.
  static let cornerRadius: CGFloat = circleRadius

  /// The card's distance from the screen's top and right edges: its
  /// top-right corner on the circle's, so its right edge lines up with the
  /// circle and the boxes below. (0.12.2 reached 8 points further right, as
  /// the system menu does; on the phone that stuck out past both.) Measured,
  /// not fixed: the bar's button sits a little differently on a real phone
  /// than in the simulator.
  static func placement(dot: CGRect, screenWidth: CGFloat) -> (top: CGFloat, trailing: CGFloat) {
    // Not measured yet: where the circle sits on a 6.3-inch iPhone.
    guard dot != .zero else { return (62, 16) }
    return (dot.midY - circleRadius, screenWidth - (dot.midX + circleRadius))
  }

  var body: some View {
    // Keeps "2 minutes ago" true while the card stays open.
    TimelineView(.periodic(from: .now, by: 15)) { context in
      let text = MacLinkText(link, updated: updated, now: context.date)
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          MacLinkSymbol(link: link, withoutColor: withoutColor)
            .font(.footnote)
            .frame(width: iconWidth)
          VStack(alignment: .leading, spacing: 2) {
            Text(text.title)
            if let detail = text.detail {
              Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
          }
        }
        if !text.checks.isEmpty {
          Divider()
          Text("Check that").font(.footnote).foregroundStyle(.secondary)
          ForEach(Array(text.checks.enumerated()), id: \.offset) { index, check in
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Image(systemName: "\(index + 1).circle")
                .foregroundStyle(.secondary)
                .frame(width: iconWidth)
              Text(check)
            }
          }
        }
      }
      .frame(width: min(textWidth, 340), alignment: .leading)
      .fixedSize(horizontal: false, vertical: true)
      .padding(16)
      .background(.regularMaterial, in: .rect(cornerRadius: Self.cornerRadius))
      .shadow(color: .black.opacity(0.15), radius: 20, y: 8)
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.isModal)
    }
  }
}

/// The coloured circle, or with Differentiate Without Color on, a symbol
/// that says the state without its colour.
private struct MacLinkSymbol: View {
  let link: MacLink
  let withoutColor: Bool

  var body: some View {
    Image(systemName: withoutColor ? symbol : "circle.fill").foregroundStyle(color)
  }

  private var color: Color {
    switch link {
    case .checking: .secondary
    case .connected: .green
    case .unreachable, .notConfigured: .red
    case .tokenRejected: .orange
    }
  }

  private var symbol: String {
    switch link {
    case .checking: "ellipsis.circle.fill"
    case .connected: "checkmark.circle.fill"
    case .unreachable, .notConfigured: "xmark.circle.fill"
    case .tokenRejected: "exclamationmark.circle.fill"
    }
  }
}
