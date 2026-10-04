import SwiftUI

/// How far the tab bar has shrunk, following the finger: each point
/// scrolled down shrinks it a little more, each point up brings it back, the
/// way Instagram's bar moves. Plain arithmetic, so it is unit tested; each
/// tracked scroll view keeps its own copy.
struct TabBarScrollRule {
  /// Scrolling this far takes the bar all the way from full to shrunk.
  static let travel: CGFloat = 140
  /// Within this distance of the top, the page counts as at the top.
  static let topZone: CGFloat = 1

  private var last: CGFloat?
  private var movingDown = true

  /// `offset` is the distance scrolled from the top (negative while pulling
  /// down), `maxOffset` the largest resting offset, `progress` the bar now
  /// (0 full, 1 shrunk). Returns the bar's new progress.
  mutating func update(offset: CGFloat, maxOffset: CGFloat, progress: CGFloat) -> CGFloat {
    // Rubber-banding past either end reads as no movement: the bounce at the
    // bottom is not an upward scroll, a pull-to-refresh not a downward one.
    let y = min(max(offset, 0), max(maxOffset, 0))
    defer { self.last = y }
    if y <= Self.topZone { return 0 }
    guard let last, y != last else { return progress }
    movingDown = y > last
    return min(max(progress + (y - last) / Self.travel, 0), 1)
  }

  /// Where the bar comes to rest once scrolling stops part way: it finishes
  /// the way it was going.
  func settled(_ progress: CGFloat) -> CGFloat {
    if progress <= 0 || progress >= 1 { return progress }
    return movingDown ? 1 : 0
  }
}

/// What `TabBarScrollRule` reads from a scroll view.
struct TabBarScrollOffsets: Equatable {
  var offset: CGFloat
  var maxOffset: CGFloat

  init(offset: CGFloat, maxOffset: CGFloat) {
    self.offset = offset
    self.maxOffset = maxOffset
  }

  /// UIKit puts the top of the content at `-contentInsets.top`; this counts
  /// from there, so 0 is at rest at the top.
  init(_ geometry: ScrollGeometry) {
    let insets = geometry.contentInsets
    offset = geometry.contentOffset.y + insets.top
    maxOffset = max(0, geometry.contentSize.height + insets.top + insets.bottom - geometry.containerSize.height)
  }
}

/// How far the tab bar has shrunk. RootView owns it; the bar reads it and
/// every tracked scroll view writes it.
@MainActor @Observable final class TabBarState {
  /// 0 is the full bar, 1 fully shrunk; in between while a finger drags.
  var progress: CGFloat = 0

  /// Every change to the bar's size runs through this, so it trails the
  /// finger slightly and coasts into full or small with a little give,
  /// rather than stopping dead. With Reduce Motion on it still follows the
  /// finger, through a short plain ease with no overshoot.
  static var motion: Animation {
    UIAccessibility.isReduceMotionEnabled
      ? .easeOut(duration: 0.12)
      : .spring(response: 0.55, dampingFraction: 0.72)
  }

  /// Brings the full bar back.
  func expand() {
    guard progress != 0 else { return }
    progress = 0
  }

  /// The tab on screen. Only its pages may resize the bar, so a page left
  /// behind while it is still gliding cannot shrink the bar again.
  var selected = AppTab.accounts
  /// Bumped by a tap on the tab already selected: its page scrolls to the top.
  var scrollToTopRequests = 0
}

extension EnvironmentValues {
  /// The tab a page belongs to; RootView sets it on each tab's content.
  @Entry var appTab: AppTab?
}

/// Reports this scroll view's movement to the tab bar, which shrinks while it
/// scrolls down. Put it on every List, Form and ScrollView shown inside a
/// tab. Sheets don't need it: they cover the bar. A newly shown page starts
/// with a fresh rule and the full bar, and only a scroll view on screen in
/// the selected tab writes: not one in a hidden tab or under a pushed screen.
struct TabBarScrollTracking: ViewModifier {
  /// Absent in previews and on the server setup screen; then it does nothing.
  @Environment(TabBarState.self) private var state: TabBarState?
  @State private var rule = TabBarScrollRule()
  @State private var isOnScreen = false
  @Environment(\.appTab) private var tab
  /// Room the page needs above the bar, such as the ledger's search field.
  var extraBottom: CGFloat = 0
  /// Bumped when this page should scroll to the top.
  @State private var topRequests = 0
  @AppStorage(AppTabBar.labelsKey) private var showsTabLabels = false
  /// The home indicator's height, or the keyboard's while it is up.
  @State private var bottomSafeArea: CGFloat = 0

  /// Room for the bar under the last row. Given here rather than once in
  /// RootView: a safe-area inset outside a tab's NavigationStack doesn't
  /// reach the scroll views inside it. A page's own extra room is added
  /// here too: a second bottom content margin would replace this one.
  private var barRoom: CGFloat {
    guard state != nil else { return extraBottom }
    return AppTabBar.contentInset(bottomSafeArea: bottomSafeArea, showsLabels: showsTabLabels) + extraBottom
  }

  func body(content: Content) -> some View {
    content
      .contentMargins(.bottom, barRoom)
      .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.bottom } action: { bottomSafeArea = $0 }
      .background(ScrollToTopProbe(requests: topRequests))
      .onScrollGeometryChange(for: TabBarScrollOffsets.self) { geometry in
        TabBarScrollOffsets(geometry)
      } action: { _, new in
        guard isOnScreen, let state, tab == nil || tab == state.selected else { return }
        let next = rule.update(offset: new.offset, maxOffset: new.maxOffset, progress: state.progress)
        if next != state.progress { state.progress = next }
      }
      // Let go part way: the bar finishes the way it was going.
      .onScrollPhaseChange { _, phase in
        guard phase == .idle, isOnScreen, let state, tab == nil || tab == state.selected else { return }
        let rest = rule.settled(state.progress)
        if rest != state.progress { state.progress = rest }
      }
      .onAppear {
        isOnScreen = true
        rule = TabBarScrollRule()
        state?.expand()
      }
      .onDisappear { isOnScreen = false }
      // Re-tapping the selected tab: only the page on screen scrolls up.
      .onChange(of: state?.scrollToTopRequests) {
        guard isOnScreen, let state, tab == nil || tab == state.selected else { return }
        topRequests += 1
      }
  }
}

extension View {
  /// See `TabBarScrollTracking`. `extraBottom` is room the page needs above
  /// the bar.
  func tabBarScrollTracking(extraBottom: CGFloat = 0) -> some View {
    modifier(TabBarScrollTracking(extraBottom: extraBottom))
  }
}

/// Scrolls the UIKit scroll view behind a List, Form or ScrollView to its top
/// each time `requests` changes. SwiftUI's ScrollPosition moves a ScrollView
/// but not a List or Form, so this does it the way the status-bar tap does.
private struct ScrollToTopProbe: UIViewRepresentable {
  let requests: Int

  final class Coordinator {
    var seen: Int
    init(seen: Int) { self.seen = seen }
  }

  func makeCoordinator() -> Coordinator { Coordinator(seen: requests) }

  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.isUserInteractionEnabled = false
    return view
  }

  func updateUIView(_ view: UIView, context: Context) {
    guard requests != context.coordinator.seen else { return }
    context.coordinator.seen = requests
    guard let scrollView = Self.scrollView(near: view) else { return }
    // Stop a glide still under way first, or it carries on over the scroll up.
    scrollView.setContentOffset(scrollView.contentOffset, animated: false)
    let top = CGPoint(x: scrollView.contentOffset.x, y: -scrollView.adjustedContentInset.top)
    scrollView.setContentOffset(top, animated: true)
  }

  /// The largest scroll view in the nearest ancestor that holds one: the
  /// page this probe sits behind.
  private static func scrollView(near view: UIView) -> UIScrollView? {
    var ancestor = view.superview
    while let current = ancestor {
      if let scroll = current as? UIScrollView, scrollsVertically(scroll) { return scroll }
      if let found = largest(in: current) { return found }
      ancestor = current.superview
    }
    return nil
  }

  private static func largest(in view: UIView) -> UIScrollView? {
    var best: UIScrollView?
    var stack = view.subviews
    while let next = stack.popLast() {
      if let scroll = next as? UIScrollView {
        guard scrollsVertically(scroll) else { continue }
        let area = scroll.bounds.width * scroll.bounds.height
        if area > (best.map { $0.bounds.width * $0.bounds.height } ?? 0) { best = scroll }
        continue
      }
      stack.append(contentsOf: next.subviews)
    }
    return best
  }

  /// A page's own scroll view, not a text view or a sideways scroller.
  private static func scrollsVertically(_ scroll: UIScrollView) -> Bool {
    !(scroll is UITextView)
      && (scroll.alwaysBounceVertical || scroll.contentSize.height > scroll.bounds.height)
  }
}
