import SwiftUI

/// Activity's one-line rows (../docs/superpowers/specs/2026-10-02-ios-compact-rows-design.md).
/// Phone-only. Pinch in on a list for compact rows, pinch out for the full
/// ones; one setting for all three segments, kept per device.
enum CompactRows {
  static let key = "transactions.compactRows"

  /// How far a pinch must go before it switches, so it snaps between the
  /// two densities and a stray two-finger touch does nothing.
  nonisolated static let threshold: CGFloat = 0.15

  /// The density a pinch ending at `magnification` asks for: true for
  /// compact, false for full, nil when it didn't go far enough.
  nonisolated static func target(magnification: CGFloat) -> Bool? {
    if magnification < 1 - threshold { return true }
    if magnification > 1 + threshold { return false }
    return nil
  }

  /// How a list moves between the two densities, and back from a pinch: a
  /// soft spring with a touch of give. With Reduce Motion on, a short plain
  /// ease.
  static var motion: Animation {
    UIAccessibility.isReduceMotionEnabled
      ? .easeInOut(duration: 0.2)
      : .spring(response: 0.42, dampingFraction: 0.86)
  }

  /// How the card follows the fingers mid-pinch. A spring rather than none,
  /// so the release spring starts at the fingers' speed instead of from rest.
  static var following: Animation? {
    UIAccessibility.isReduceMotionEnabled ? nil : .interactiveSpring(response: 0.18, dampingFraction: 0.9)
  }

  /// How far the rows card gives while a pinch is under way: below 0 it
  /// shrinks by that much, above 0 its rows spread apart by that much. It
  /// gives toward the density the pinch asks for and barely toward the one
  /// already shown, and eases off as it nears its limit (8% toward the other
  /// density, 3% toward this one) rather than stopping dead there.
  nonisolated static func liveStretch(magnification: CGFloat, compact: Bool) -> CGFloat {
    let stretch = magnification - 1
    let towardOther = compact ? stretch > 0 : stretch < 0
    let (gain, limit): (CGFloat, CGFloat) = towardOther ? (0.6, 0.08) : (0.15, 0.03)
    return limit * tanh(stretch * gain / limit)
  }

  /// The step a card gives, on top of its stretch, once a pinch has gone
  /// far enough to switch: the "click" that says letting go will switch.
  nonisolated static let armedStep: CGFloat = 0.03

  /// How the card steps when a pinch arms or disarms a switch: quick, with
  /// a little bounce.
  static var click: Animation {
    UIAccessibility.isReduceMotionEnabled ? .easeInOut(duration: 0.15) : .spring(response: 0.24, dampingFraction: 0.62)
  }

  /// The coordinate space of a rows card, where its rows' frames are kept.
  nonisolated static let space = "compactRowsCard"

  /// The saved setting, read at once, so a list is drawn at the right
  /// density from its first frame.
  static var saved: Bool { UserDefaults.standard.bool(forKey: key) }

  /// "#752" — the ledger number, as the full rows print it.
  nonisolated static func number(_ label: Int?) -> String { "#\(label.map(String.init) ?? "—")" }

  /// "Sep 29" — the compact row's date. Empty when the date doesn't parse.
  nonisolated static func shortDate(_ iso: String, calendar: Calendar = .current) -> String {
    guard let date = Formatters.parseISO(iso) else { return "" }
    return date.formatted(Formatters.dateStyle(date, calendar: calendar).month(.abbreviated).day())
  }
}

/// One compact line: ledger number, date, title, amount. At accessibility
/// sizes the title gets its own line, with the rest under it.
struct CompactRow: View {
  /// "#752", or "#—" for a row without one, as the full rows print it.
  let number: String
  let date: String
  let title: String
  let amount: String
  let amountColor: Color

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  /// Fits "Sep 30" at the current text size.
  @ScaledMetric(relativeTo: .footnote) private var dateWidth: CGFloat = 44
  /// Fits "#1234" at the current text size.
  @ScaledMetric(relativeTo: .footnote) private var numberWidth: CGFloat = 42

  var body: some View {
    let dateText = Text(date).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
    let numberText = Text(number).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
    let amountText = AmountText(amount)
      .monospacedDigit()
      .lineLimit(1)
      .fixedSize()
      .foregroundStyle(amountColor)
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.body.weight(.medium))
        HStack(alignment: .firstTextBaseline) {
          numberText
          dateText
          Spacer(minLength: 8)
          amountText
        }
      }
    } else {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        numberText.lineLimit(1).frame(width: numberWidth, alignment: .leading)
        dateText.frame(width: dateWidth, alignment: .leading)
        Text(title).lineLimit(1)
        Spacer(minLength: 8)
        amountText
      }
    }
  }
}

/// Keeps a list's drawn density in step with the saved setting. A list draws
/// from its own @State, changed inside an animation: a change to the
/// @AppStorage setting arrives outside any animation, so a list drawn from it
/// snapped between densities in one frame. A change made elsewhere (the
/// Filter menu, another segment) still reaches the list, animated.
struct CompactRowsSync: ViewModifier {
  @Binding var compact: Bool
  @AppStorage(CompactRows.key) private var saved = false

  func body(content: Content) -> some View {
    content
      .onChange(of: saved) { _, value in
        guard value != compact else { return }
        withAnimation(CompactRows.motion) { compact = value }
      }
      .onChange(of: compact) { _, value in
        if saved != value { saved = value }
      }
  }
}

/// Where a card's rows sit, kept as they lay out and as the list scrolls,
/// so a pinch can find the row under the fingers. A plain class, so keeping
/// it up to date redraws nothing.
@MainActor final class CompactRowsLayout {
  var frames: [String: CGRect] = [:]
  /// The part of the card on screen, in the card's coordinates.
  var onScreen: CGRect?
}

/// How far a pinching out spreads a card's rows apart, about `anchorY` (in
/// the card's coordinates).
struct CompactRowsSpread: Equatable {
  var factor: CGFloat = 0
  var anchorY: CGFloat = 0
}

extension EnvironmentValues {
  @Entry var compactRowsSpread = CompactRowsSpread()
  @Entry var compactRowsLayout: CompactRowsLayout? = nil
}

/// The rows card of a list that pinches to switch `compact`. Only the card
/// follows the fingers, so the header above it stays put: pinching in
/// shrinks it about the pinch, pinching out stretches it taller and spreads
/// its rows apart (never past its side edges, never cutting a row off).
/// Past the threshold the card steps a little further, with a tap, to say a
/// switch is armed; backing off disarms it. Letting go switches density,
/// keeping the row under the fingers where it was (near the top of the list,
/// the top instead), or, unarmed, only settles the card.
struct CompactRowsCard: ViewModifier {
  @Binding var compact: Bool
  let ids: [String]
  let visible: Set<String>
  let proxy: ScrollViewProxy

  /// The pinch under way; 1 when none is.
  @State private var magnification: CGFloat = 1
  /// The density letting go will switch to; nil when it won't switch.
  @State private var armed: Bool?
  @State private var pinching = false
  @State private var anchor: UnitPoint = .center
  @State private var spreadAnchor: UnitPoint = .top
  @State private var spreadY: CGFloat = 0
  /// The row under the fingers and where on screen it sat (0 top, 1 bottom).
  @State private var keep: (id: String, at: CGFloat)?
  @State private var layout = CompactRowsLayout()

  func body(content: Content) -> some View {
    let step = armed.map { $0 ? -CompactRows.armedStep : CompactRows.armedStep } ?? 0
    let stretch = CompactRows.liveStretch(magnification: magnification, compact: compact) + step
    let grow = max(stretch, 0)
    let shape = RoundedRectangle(cornerRadius: GroupedList.cardRadius)
    content
      .coordinateSpace(.named(CompactRows.space))
      .environment(\.compactRowsSpread, CompactRowsSpread(factor: grow, anchorY: spreadY))
      .environment(\.compactRowsLayout, layout)
      .onGeometryChange(for: CGRect?.self) { $0.bounds(of: .scrollView) } action: { layout.onScreen = $0 }
      .background {
        shape.fill(Color(.secondarySystemGroupedBackground))
          .scaleEffect(x: 1, y: 1 + grow, anchor: spreadAnchor)
      }
      .mask { shape.scaleEffect(x: 1, y: 1 + grow, anchor: spreadAnchor) }
      .scaleEffect(1 + min(stretch, 0), anchor: anchor)
      // Ahead of the rows' own taps, so the two fingers of a pinch don't
      // press a row and open it on release. One finger still scrolls and
      // taps as usual: a pinch needs two.
      .highPriorityGesture(
        MagnifyGesture()
          .onChanged { value in
            if !pinching { begin(value) }
            let m = value.magnification
            let target = CompactRows.target(magnification: m).flatMap { $0 == compact ? nil : $0 }
            if target != armed {
              withAnimation(CompactRows.click) {
                armed = target
                magnification = m
              }
            } else {
              withAnimation(CompactRows.following) { magnification = m }
            }
          }
          .onEnded { _ in
            pinching = false
            withAnimation(CompactRows.motion) {
              magnification = 1
              if let armed {
                compact = armed
                if let keep { proxy.scrollTo(keep.id, anchor: UnitPoint(x: 0.5, y: keep.at)) }
              }
              armed = nil
            }
          })
      .sensoryFeedback(.impact(weight: .light), trigger: armed) { _, new in new != nil }
      .accessibilityAction(named: compact ? "Show Full Rows" : "Show Compact Rows") {
        withAnimation(CompactRows.motion) { toggleKeepingTop() }
      }
      .padding(.horizontal, GroupedList.inset)
  }

  /// Notes where a pinch starts and the row it should keep in place.
  private func begin(_ value: MagnifyGesture.Value) {
    pinching = true
    anchor = value.startAnchor
    let y = value.startLocation.y
    // With the card's top on screen, keep the top: rows spread down from
    // it, and the list doesn't scroll, so the header stays in view.
    guard let screen = layout.onScreen, screen.minY > 0, screen.height > 0 else {
      spreadAnchor = .top
      spreadY = 0
      keep = nil
      return
    }
    spreadAnchor = UnitPoint(x: 0.5, y: value.startAnchor.y)
    spreadY = y
    let rows = layout.frames.filter { visible.contains($0.key) }
    let under = rows.first { $0.value.minY <= y && y < $0.value.maxY }
      ?? rows.min { abs($0.value.midY - y) < abs($1.value.midY - y) }
    keep = under.map { ($0.key, min(max((y - screen.minY) / screen.height, 0), 1)) }
  }

  /// For VoiceOver: switch, keeping the topmost visible row at the top.
  private func toggleKeepingTop() {
    // At the top of the list there is no place to keep, and scrolling
    // would push the header out of view.
    let top = ids.first { visible.contains($0) }.flatMap { $0 == ids.first ? nil : $0 }
    compact.toggle()
    if let top { proxy.scrollTo(top, anchor: .top) }
  }
}

/// A row of a pinching card (CompactRowsCard): keeps `visible` up to date
/// with whether it is on screen, notes where it sits, and moves apart from
/// its neighbours as the card is pinched out.
struct CompactRowsCell: ViewModifier {
  let id: String
  let visible: Binding<Set<String>>
  @Environment(\.compactRowsSpread) private var spread
  @Environment(\.compactRowsLayout) private var layout

  func body(content: Content) -> some View {
    let spread = spread
    content
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(CompactRows.space)) } action: { frame in
        layout?.frames[id] = frame
      }
      .visualEffect { content, proxy in
        content.offset(y: (proxy.frame(in: .named(CompactRows.space)).midY - spread.anchorY) * spread.factor)
      }
      .onScrollVisibilityChange(threshold: 0.5) { isVisible in
        if isVisible { visible.wrappedValue.insert(id) } else { visible.wrappedValue.remove(id) }
      }
  }
}

extension View {
  /// `groupedCard()` for a list's rows, pinching to switch `compact`
  /// (CompactRowsCard).
  func compactRowsCard(
    _ compact: Binding<Bool>, ids: [String], visible: Set<String>, proxy: ScrollViewProxy
  ) -> some View {
    modifier(CompactRowsCard(compact: compact, ids: ids, visible: visible, proxy: proxy))
  }

  /// A row of a card made with `compactRowsCard` (CompactRowsCell).
  func compactRowsCell(_ id: String, in visible: Binding<Set<String>>) -> some View {
    modifier(CompactRowsCell(id: id, visible: visible))
  }
}
