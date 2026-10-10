import Foundation
import Observation

/// Whether this iPhone can reach Budget on the Mac right now, for the dot on
/// Accounts (../docs/superpowers/specs/2026-10-09-ios-mac-status-dot-design.md).
enum MacLink: Equatable {
  /// No answer yet since launch or since the server changed.
  case checking
  /// The Mac answered.
  case connected
  /// No answer: Tailscale off, Mac asleep, or Budget not running.
  case unreachable
  /// The Mac answered 401: the phone's access token is wrong or was reset.
  case tokenRejected
  /// No server saved on this phone.
  case notConfigured
}

/// Asks the Mac a cheap question every so often and keeps the answer. The
/// question is `GET api/update/phone`: a few small files, no database.
@MainActor
@Observable
final class MacLinkStore {
  private(set) var link: MacLink = .checking
  /// When the Mac last answered, this launch.
  private(set) var lastContact: Date?

  /// How often Accounts asks again while it is on screen.
  static let interval: Duration = .seconds(30)

  private let client: @MainActor () -> APIClient?
  private let now: @MainActor () -> Date
  /// Only the most recent check may set the state.
  private var generation = 0

  init(
    client: @escaping @MainActor () -> APIClient?,
    now: @escaping @MainActor () -> Date = { .now }
  ) {
    self.client = client
    self.now = now
  }

  /// The state stays as it was while the check is in flight, so the dot
  /// doesn't flicker back to grey every 30 seconds.
  func check() async {
    generation += 1
    let current = generation
    guard let client = client() else {
      link = .notConfigured
      return
    }
    do {
      try await client.ping()
      guard current == generation else { return }
      answered()
    } catch {
      guard current == generation else { return }
      switch error {
      case .cancelled: return
      case .unauthorized: link = .tokenRejected
      case .notConfigured: link = .notConfigured
      case _ where error.isUnreachable: link = .unreachable
      // Any other HTTP answer still came from the Mac.
      default: answered()
      }
    }
  }

  /// A different server: what was known about the old one no longer holds.
  func serverChanged() {
    generation += 1
    link = .checking
    lastContact = nil
  }

  private func answered() {
    link = .connected
    lastContact = now()
  }
}

/// The dot's menu for a state: a title, a short line under it (the data's
/// age or what to do; a menu shows at most two lines there), and, when the
/// Mac can't be reached, what to check. Wording follows `ConnectionProblem`.
struct MacLinkText: Equatable {
  let title: String
  let detail: String?
  var checks: [String] = []

  init(_ link: MacLink, updated: Date?, now: Date) {
    let age = updated.map { Self.ago($0, now: now) }
    switch link {
    case .checking:
      title = "Checking Your Mac…"
      detail = age.map { "Last updated \($0)" }
    case .connected:
      title = "Connected to Your Mac"
      detail = age.map { "Updated \($0)" }
    case .unreachable:
      title = "Can't Reach Your Mac"
      detail = age.map { "Last updated \($0)" }
      checks = ["Tailscale is on", "Your Mac is awake", "Budget is running on it"]
    case .tokenRejected:
      title = "Access Token Not Accepted"
      detail = "Re-enter it in Settings → Server."
    case .notConfigured:
      title = "No Server Set"
      detail = "Add your Mac in Settings → Server."
    }
  }

  /// "just now" under a minute, else "2 minutes ago".
  static func ago(_ date: Date, now: Date) -> String {
    if now.timeIntervalSince(date) < 60 { return "just now" }
    let f = RelativeDateTimeFormatter()
    f.locale = Locale(identifier: "en_US")
    f.unitsStyle = .full
    f.dateTimeStyle = .numeric
    return f.localizedString(for: date, relativeTo: now)
  }
}
