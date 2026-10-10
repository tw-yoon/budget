import Foundation
import Synchronization

/// One screen load, split where the time went. In milliseconds.
struct LoadTime: Sendable, Equatable, Identifiable {
  let id = UUID()
  let date: Date
  /// The route without its query, e.g. "api/transactions".
  let path: String
  /// From sending the request to holding the whole answer.
  let request: Double
  /// The server's own share, from its `Server-Timing` header; nil when it sent none.
  let server: Double?
  /// Turning the answer into the screen's data.
  let reading: Double

  var total: Double { request + reading }
  /// Everything in the request that wasn't the server: Tailscale, Wi-Fi, download.
  var network: Double? { server.map { max(0, request - $0) } }
}

/// The last loads of the main screens, newest first, in memory only, for
/// Settings → Load Times (Pro mode). Nothing leaves the phone.
final class LoadTimes: Sendable {
  static let shared = LoadTimes()
  static let limit = 50

  private let entries = Mutex<[LoadTime]>([])

  var all: [LoadTime] { entries.withLock { $0 } }

  func record(_ entry: LoadTime) {
    entries.withLock {
      $0.insert(entry, at: 0)
      if $0.count > Self.limit { $0.removeLast($0.count - Self.limit) }
    }
  }

  /// `app;dur=12.3` (the web's `serverTiming` in ../src/lib/server-timing.ts) → 12.3.
  static func serverMilliseconds(_ header: String?) -> Double? {
    guard let header else { return nil }
    for metric in header.split(separator: ",") {
      let parts = metric.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
      guard parts.first == "app" else { continue }
      for p in parts.dropFirst() where p.hasPrefix("dur=") {
        return Double(p.dropFirst(4))
      }
    }
    return nil
  }
}

extension Duration {
  var milliseconds: Double {
    Double(components.seconds) * 1000 + Double(components.attoseconds) / 1e15
  }
}
