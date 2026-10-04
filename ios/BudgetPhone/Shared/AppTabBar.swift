import SwiftUI

/// The tab bar. The app draws its own because Apple's cannot shrink this
/// way: while a page scrolls down this one keeps all five tabs and gets a
/// little smaller. Icons only; Settings → Accessibility → Tab Bar Labels adds
/// labels and keeps the bar full size. Apple's bar is hidden (RootView).
struct AppTabBar: View {
  @Binding var selection: AppTab
  /// 0 full, 1 shrunk; in between while a finger drags the page.
  let progress: CGFloat
  let showsLabels: Bool
  /// Called on every tap, the selected tab included: a tap always brings the
  /// full bar back.
  var expand: () -> Void = {}
  /// Called on a tap on the tab already selected.
  var reselect: () -> Void = {}

  /// The Tab Bar Labels setting, kept on this iPhone only.
  static let labelsKey = "tabBar.labels"

  enum Metrics {
    static let fullHeight: CGFloat = 58
    /// With Tab Bar Labels on.
    static let labelledHeight: CGFloat = 62
    static let compactHeight: CGFloat = 44
    /// Space at each side of the bar.
    static let fullMargin: CGFloat = 21
    /// From the bottom of the screen to the bottom of the bar.
    static let bottomGap: CGFloat = 21
    /// Between a list's last row and the top of the full bar.
    static let clearance: CGFloat = 8
    static let fullIcon: CGFloat = 23
    /// The shrunk bar is the full one scaled down by this, toward its bottom
    /// centre.
    static let compactScale: CGFloat = compactHeight / fullHeight
    /// With labels, a fixed box for the icon, so every label starts at the
    /// same height whatever the symbol's own size.
    static let iconBox: CGFloat = 26
  }

  /// How big the bar is drawn for a given progress. With labels on, it never
  /// shrinks.
  /// The size eases in and out (smoothstep), so it glides into full and
  /// small rather than stopping dead at either end.
  nonisolated static func scale(progress: CGFloat, showsLabels: Bool) -> CGFloat {
    guard !showsLabels else { return 1 }
    let p = min(max(progress, 0), 1)
    let eased = p * p * (3 - 2 * p)
    return 1 - (1 - Metrics.compactScale) * eased
  }

  /// Extra bottom inset for each tab's content, on top of its safe area, so
  /// a list's last row can scroll clear of the full bar. `bottomSafeArea` is
  /// the home indicator's height, or the keyboard's while it is up; the bar
  /// sits behind the keyboard, so then nothing extra is needed.
  nonisolated static func contentInset(bottomSafeArea: CGFloat, showsLabels: Bool) -> CGFloat {
    let height = showsLabels ? Metrics.labelledHeight : Metrics.fullHeight
    return max(0, Metrics.bottomGap + height + Metrics.clearance - bottomSafeArea)
  }

  var body: some View {
    HStack(spacing: 0) {
      ForEach(AppTab.allCases, id: \.self) { item($0) }
    }
    .padding(.horizontal, 4)
    .frame(height: showsLabels ? Metrics.labelledHeight : Metrics.fullHeight)
    // Not interactive glass: that one stretches and wobbles under a tap.
    .glassEffect(.regular, in: .capsule)
    .padding(.horizontal, Metrics.fullMargin)
    // Shrinks as one picture toward its bottom centre, so every icon moves in
    // a straight line (the middle one straight down) and nothing re-lays out.
    // It follows the finger while the page scrolls, through a soft spring
    // (TabBarState.motion).
    .scaleEffect(Self.scale(progress: progress, showsLabels: showsLabels), anchor: .bottom)
    .animation(TabBarState.motion, value: progress)
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(.isTabBar)
  }

  /// One tab. The button fills the bar's height, so a shrunk icon is still
  /// easy to hit; only the highlight is inset.
  private func item(_ tab: AppTab) -> some View {
    let selected = tab == selection
    return Button {
      if selection == tab { reselect() }
      selection = tab
      expand()
    } label: {
      VStack(spacing: 2) {
        Image(systemName: tab.systemImage)
          .symbolVariant(.fill)
          .font(.system(size: Metrics.fullIcon, weight: .medium))
          .frame(height: showsLabels ? Metrics.iconBox : nil)
        if showsLabels {
          // A fixed size, like Apple's tab labels; the large content viewer
          // covers big text sizes.
          Text(tab.title)
            .font(.system(size: 10, weight: .medium))
            .lineLimit(1)
            .accessibilityHidden(true)
        }
      }
      .foregroundStyle(selected ? Color.accentColor : Color.primary)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background {
        if selected {
          Capsule().fill(.quaternary).padding(.vertical, 4)
        }
      }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(tab.title)
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityShowsLargeContentViewer {
      Label(tab.title, systemImage: tab.systemImage)
        .symbolVariant(.fill)
    }
  }
}

#Preview("Icons") {
  @Previewable @State var tab = AppTab.activity
  AppTabBar(selection: $tab, progress: 0, showsLabels: false)
}

#Preview("Shrunk") {
  @Previewable @State var tab = AppTab.activity
  AppTabBar(selection: $tab, progress: 1, showsLabels: false)
}

#Preview("Labels") {
  @Previewable @State var tab = AppTab.activity
  AppTabBar(selection: $tab, progress: 1, showsLabels: true)
}
