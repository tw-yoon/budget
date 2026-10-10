import Foundation
import Observation

/// Settings → About's Mac row: the Mac's version, and Install, which starts
/// the update and waits for Budget to come back (SettingsUpdates.tsx on the web).
@MainActor
@Observable
final class UpdateStore {
  enum Phase: Equatable {
    case idle
    case updating
    case updated(to: String)
    case failed(String)
    case stillNotBack
  }

  private(set) var status: UpdateStatus?
  private(set) var phase: Phase = .idle
  /// Why the Mac refused or couldn't be asked to start; nothing was started.
  private(set) var startError: String?
  var pollInterval: Duration = .seconds(3)
  var pollLimit: Duration = .seconds(600)

  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// A failure hides the row: Settings' server form covers connection trouble.
  /// Not while an update runs (the server is down on purpose and install()
  /// is polling), and not while the row shows an outcome. Opened while an
  /// update runs (started from the web or another device), it follows that
  /// update instead of offering Install.
  func load() async {
    guard phase != .updating, let client = client() else { return }
    do throws(APIError) {
      let s = try await client.updateStatus()
      guard phase != .updating else { return }
      status = s
      if phase == .stillNotBack || { if case .failed = phase { true } else { false } }() {
        phase = .idle
      }
      if s.updating { await follow(client) }
    } catch {
      if error != .cancelled && phase == .idle { status = nil }
    }
  }

  func install() async {
    guard let client = client(), status != nil, phase != .updating else { return }
    startError = nil
    do throws(APIError) {
      try await client.startUpdate()
    } catch {
      if error != .cancelled { startError = error.message }
      return
    }
    await follow(client)
  }

  /// Polls until the running update ends, fails, or the limit passes.
  private func follow(_ client: APIClient) async {
    phase = .updating
    let clock = ContinuousClock()
    let deadline = clock.now + pollLimit
    while clock.now < deadline {
      do { try await Task.sleep(for: pollInterval) } catch {
        phase = .idle
        return
      }
      let s: UpdateStatus?
      do throws(APIError) { s = try await client.updateStatus() } catch { s = nil }
      switch UpdatePoll.outcome(s) {
      case .waiting: continue
      case .done:
        status = s
        phase = .updated(to: s?.version ?? "")
        return
      case .failed(let log):
        status = s
        phase = .failed(log)
        return
      }
    }
    phase = .stillNotBack
  }
}
