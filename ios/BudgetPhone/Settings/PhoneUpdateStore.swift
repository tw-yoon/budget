import Foundation
import Observation

/// Settings → About's Update iPhone: the Mac rebuilds this app and installs
/// it (ios/scripts/phone.sh install). The install closes the app, so the
/// outcome is usually read on the next launch.
@MainActor
@Observable
final class PhoneUpdateStore {
  private(set) var status: PhoneUpdateStatus?
  /// Why the Mac refused or couldn't be asked; nothing was started.
  private(set) var startError: String?
  var pollInterval: Duration = .seconds(3)
  var pollLimit: Duration = .seconds(1200)

  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  var installing: Bool { status?.installing == true }

  func load() async {
    guard let client = client() else { return }
    do throws(APIError) {
      status = try await client.phoneUpdateStatus()
      if installing { await follow(client) }
    } catch {
      if error != .cancelled { status = nil }
    }
  }

  func start() async {
    guard let client = client(), status?.available == true, !installing else { return }
    startError = nil
    do throws(APIError) {
      try await client.startPhoneUpdate()
    } catch {
      if error != .cancelled { startError = error.message }
      return
    }
    status?.installing = true
    status?.failed = nil
    await follow(client)
  }

  /// Polls until the install ends (if this app is still open by then).
  private func follow(_ client: APIClient) async {
    let clock = ContinuousClock()
    let deadline = clock.now + pollLimit
    while clock.now < deadline {
      do { try await Task.sleep(for: pollInterval) } catch { return }
      guard let s = try? await client.phoneUpdateStatus() else { continue }
      status = s
      if !s.installing { return }
    }
  }
}
