import Foundation
import Observation

/// What the Subscriptions card and list show
/// (../src/components/SubscriptionsDashboard.tsx). Shared by both, so a
/// detect from the card's menu shows up in the list and the other way round.
/// Same failure rules as AccountsStore: with nothing on screen an error is
/// full-screen; with data showing it becomes a banner and the data stays.
@MainActor
@Observable
final class SubscriptionsStore {
  private(set) var data: SubscriptionsResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  private(set) var isDetecting = false
  /// A non-blocking warning over data that is still valid.
  var banner: String?
  /// The last detect's result ("Found 3 recurring charges.").
  var notice: String?

  private let client: @MainActor () -> APIClient?
  /// Bumped by every load; a completion applies only if it is still the latest.
  private var loadGeneration = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  func load() async {
    loadGeneration += 1
    let generation = loadGeneration
    guard let client = client() else {
      data = nil
      error = .notConfigured
      return
    }
    if data == nil {
      error = nil
      data = client.savedSubscriptions()
    }
    isLoading = true
    defer { if generation == loadGeneration { isLoading = false } }
    do throws(APIError) {
      let result = try await client.subscriptions()
      guard generation == loadGeneration else { return }
      data = result
      error = nil
      banner = nil
    } catch {
      guard generation == loadGeneration else { return }
      if error == .cancelled { return }
      if data == nil { self.error = error } else { banner = error.message }
    }
  }

  /// Detect from banks (Plaid), then a reload. One at a time. Stale
  /// messages clear before the call; this detect's own banner is applied
  /// after the reload, so the reload's success doesn't wipe it out.
  func detect() async {
    guard !isDetecting else { return }
    guard let client = client() else {
      error = .notConfigured
      return
    }
    isDetecting = true
    defer { isDetecting = false }
    banner = nil
    notice = nil
    var detectBanner: String?
    do throws(APIError) {
      notice = try await client.detectSubscriptions().notice
    } catch {
      if error != .cancelled { detectBanner = error.message }
    }
    await load()
    if let detectBanner { banner = detectBanner }
  }

  /// AddForm's submit. Throws so the sheet keeps its fields and shows why.
  func add(_ subscription: NewSubscription) async throws(APIError) {
    guard let client = client() else { throw .notConfigured }
    try await client.addSubscription(subscription)
    await load()
  }

  /// Removes the row at once, then deletes. A failure reloads (bringing the
  /// row back) and says so.
  func delete(_ subscription: SubscriptionDTO) async {
    guard let client = client() else { return }
    loadGeneration += 1  // an older GET must not bring the row back
    data?.subscriptions.removeAll { $0.id == subscription.id }
    do throws(APIError) {
      try await client.deleteSubscription(id: subscription.id)
      await load()
    } catch {
      await load()
      if error != .cancelled { banner = "Couldn't delete \(subscription.name)." }
    }
  }
}
