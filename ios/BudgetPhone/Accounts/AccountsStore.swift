import Foundation
import Observation

/// What the Accounts screen shows. Loads, refreshes and saves through
/// `APIClient`, and decides how a failure is surfaced: with nothing on
/// screen it becomes the full-screen error; with data already showing it
/// becomes a banner and the data stays.
@MainActor
@Observable
final class AccountsStore {
  private(set) var data: AccountsResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// True while a balance refresh is asking Plaid; drives the toolbar button.
  private(set) var isRefreshing = false
  /// A non-blocking message over data that is still valid.
  var banner: String?
  /// How old `data` is: the last successful load, or when the saved copy
  /// shown at launch was saved.
  private(set) var updatedAt: Date?

  /// Resolves the client at call time, so a server changed in Settings takes
  /// effect on the next load.
  private let client: @MainActor () -> APIClient?
  private let now: @MainActor () -> Date

  /// Bumped on every `load()` call; a completion only applies its result if
  /// it is still the most recent one. Guards against overlapping loads
  /// (`.task`, `scenePhase`, `onChange(server)`) finishing out of order.
  private var loadGeneration = 0

  init(
    client: @escaping @MainActor () -> APIClient?,
    now: @escaping @MainActor () -> Date = { .now }
  ) {
    self.client = client
    self.now = now
  }

  func load() async {
    loadGeneration += 1
    let generation = loadGeneration

    guard let client = client() else {
      data = nil
      updatedAt = nil
      error = .notConfigured
      return
    }
    // Nothing to show yet (or an earlier error is showing): show what the
    // last launch saved, else let the view fall back to its progress state
    // instead of leaving a stale error up for the length of the whole request.
    if data == nil {
      error = nil
      data = client.savedAccounts()
      updatedAt = data == nil ? nil : client.savedAccountsDate()
    }
    isLoading = true
    defer { if generation == loadGeneration { isLoading = false } }
    do {
      let result = try await client.accounts()
      guard generation == loadGeneration else { return }
      data = result
      updatedAt = now()
      error = nil
      banner = nil
    } catch {
      guard generation == loadGeneration else { return }
      if case .cancelled = error { return }
      if data == nil {
        self.error = error
      } else {
        banner = error.loadBanner
      }
    }
  }

  /// Live balances from Plaid, then a reload. Banks that failed are named in
  /// the banner; the reload happens regardless. Any banner from before this
  /// refresh is cleared up front; this refresh's own banner is applied after
  /// the reload, so the reload's own success doesn't wipe it back out.
  func refresh() async {
    // Pull-to-refresh and the toolbar button can overlap; one Plaid round
    // trip at a time is enough.
    guard !isRefreshing else { return }
    guard let client = client() else {
      error = .notConfigured
      return
    }
    isRefreshing = true
    defer { isRefreshing = false }
    banner = nil
    var refreshBanner: String?
    do {
      let result = try await client.refreshBalances()
      if !result.errors.isEmpty {
        refreshBanner =
          "Couldn't refresh "
          + result.errors.map { "\($0.institution) (\($0.error))" }
          .joined(separator: ", ")
      }
    } catch {
      if case .cancelled = error {} else { refreshBanner = error.message }
    }
    await load()
    if let refreshBanner { banner = refreshBanner }
  }

  /// Sends only the changed fields, then reloads. Throws so the edit form
  /// can keep the user's input and show the message.
  func save(_ patch: AccountPatch, to account: AccountDTO) async throws(APIError) {
    guard !patch.isEmpty else { return }
    guard let client = client() else { throw .notConfigured }
    try await client.updateAccount(id: account.id, patch: patch)
    await load()
  }
}
