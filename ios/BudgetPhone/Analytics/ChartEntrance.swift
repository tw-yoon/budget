import SwiftUI

/// The Analytics charts' entrance plays once per app session, each chart the
/// first time it is scrolled into view (so one below the fold waits for
/// you). A chart created while `hasPlayed` is false animates in; one created
/// later (a tab switch, pull-to-refresh, a month pan, a range or Normal/Pro
/// change, a background reload) simply appears. Not persisted. A phone-only
/// touch; the web has no entrance.
@MainActor
final class AnalyticsEntrance {
  static let session = AnalyticsEntrance()

  private(set) var hasPlayed = false

  /// A load finished or the tab was left. With data on screen, the charts
  /// it showed have had their entrance; nothing animates in after that.
  /// Without data (a full-screen error) the entrance still waits.
  func settle(hasData: Bool) {
    if hasData { hasPlayed = true }
  }

  /// A soft spring with the tab bar's response, damped so a chart settles
  /// in about half a second without overshooting its real values.
  static let motion = Animation.spring(response: 0.55, dampingFraction: 0.9)
  /// Reduce Motion: a plain fade instead.
  static let fade = Animation.easeOut(duration: 0.35)

  /// `progress` (0…1) for item `index` of `count`, each starting a little
  /// after the one before: the first item starts at 0, the last at
  /// `spread`, and all finish together at 1. Clamped to 0…1.
  nonisolated static func staggered(_ progress: Double, index: Int, count: Int, spread: Double = 0.35)
    -> Double
  {
    guard count > 1 else { return clamp(progress) }
    let start = Double(index) * spread / Double(count - 1)
    return clamp((progress - start) / (1 - spread))
  }

  nonisolated static func clamp(_ value: Double) -> Double { min(1, max(0, value)) }
}

/// Hands its content a 0…1 entrance progress, re-evaluated every frame of
/// the animation. Starts at 1 (no entrance) unless `animatesIn`, and then
/// plays once the chart is a third on screen; with Reduce Motion the content
/// stays at 1 and fades in instead.
struct ChartEntrance<Content: View>: View {
  @State private var progress: Double
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private let content: (Double) -> Content

  init(animatesIn: Bool, @ViewBuilder content: @escaping (Double) -> Content) {
    _progress = State(initialValue: animatesIn ? 0 : 1)
    self.content = content
  }

  var body: some View {
    let reduceMotion = reduceMotion
    EntranceFrame(progress: progress) { p in
      content(reduceMotion ? 1 : p)
        .opacity(reduceMotion ? p : 1)
    }
    .onScrollVisibilityChange(threshold: 0.33) { visible in
      // The model value is already 1 once started, so scrolling away and
      // back, or a tab switch, never restarts it.
      guard visible, progress < 1 else { return }
      withAnimation(reduceMotion ? AnalyticsEntrance.fade : AnalyticsEntrance.motion) {
        progress = 1
      }
    }
  }
}

/// Animatable, so SwiftUI rebuilds the content with each interpolated value
/// rather than letting the chart tween from its first frame to its last.
private struct EntranceFrame<Content: View>: View, Animatable {
  var progress: Double
  let content: (Double) -> Content

  nonisolated var animatableData: Double {
    get { progress }
    set { progress = newValue }
  }

  var body: some View { content(progress) }
}
