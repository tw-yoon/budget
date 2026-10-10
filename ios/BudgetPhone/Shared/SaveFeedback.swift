import SwiftUI

/// Counts a store's saves that worked and failed, so a view on screen can
/// play a haptic for each (`saveFeedback`). Phone-only: the web has no
/// haptics. A cancelled save counts as neither.
struct SaveFeedback: Equatable, Sendable {
  private(set) var successes = 0
  private(set) var failures = 0

  /// A save's outcome: nil when it worked.
  mutating func record(_ error: APIError?) {
    guard let error else {
      successes += 1
      return
    }
    if error != .cancelled { failures += 1 }
  }

  /// An outcome known only as worked or not (Sync, whose failures are
  /// per bank).
  mutating func record(succeeded: Bool) {
    if succeeded { successes += 1 } else { failures += 1 }
  }
}

extension View {
  /// A success tap when a save works, an error buzz when one fails.
  func saveFeedback(_ feedback: SaveFeedback) -> some View {
    self
      .sensoryFeedback(.success, trigger: feedback.successes)
      .sensoryFeedback(.error, trigger: feedback.failures)
  }
}
