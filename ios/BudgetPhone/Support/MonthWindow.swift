import Foundation

/// useMonthWindow (../src/components/charts/useMonthWindow.ts) as a value
/// type: a span of months ending at `end` (exclusive), with pan (move the
/// window) and zoom (resize the span). Each chart keeps its own. Opens on
/// the most recent `defaultSpan` months once there is data. `maxSpan` is
/// the phone's own cap on months per chart; the web has none.
struct MonthWindow: Equatable, Sendable {
  private(set) var end = 0
  private(set) var span = 1
  private(set) var total = 0
  let defaultSpan: Int
  let maxSpan: Int
  private var opened = false

  init(defaultSpan: Int, maxSpan: Int = .max) {
    self.defaultSpan = min(defaultSpan, maxSpan)
    self.maxSpan = maxSpan
  }

  /// clampView.
  static func clamp(end: Int, span: Int, total: Int) -> (end: Int, span: Int) {
    let s = min(max(1, span), max(1, total))
    let e = min(max(s, end), total)
    return (e, s)
  }

  /// The hook's effect: track the month count, and open on the latest
  /// months the first time there are any.
  mutating func setTotal(_ total: Int) {
    self.total = total
    if total > 0 && !opened {
      opened = true
      (end, span) = Self.clamp(end: total, span: min(defaultSpan, total), total: total)
    }
  }

  mutating func pan(_ dir: Int) { (end, span) = Self.clamp(end: end + dir, span: span, total: total) }
  mutating func zoom(_ dir: Int) {
    (end, span) = Self.clamp(end: end, span: min(span + dir, maxSpan), total: total)
  }

  var startIdx: Int { max(0, end - span) }
  /// The months shown, as indexes into the series.
  var range: Range<Int> { min(startIdx, total)..<min(end, total) }
  var canEarlier: Bool { end - span > 0 }
  var canLater: Bool { end < total }
  var canZoomIn: Bool { span > 1 }
  var canZoomOut: Bool { span < min(total, maxSpan) }

  /// The charts' range line: "—", "Jun 2026", or "Apr 2026 – Jun 2026".
  static func label(_ labels: [String]) -> String {
    switch labels.count {
    case 0: "—"
    case 1: labels[0]
    default: "\(labels[0]) – \(labels[labels.count - 1])"
    }
  }
}
