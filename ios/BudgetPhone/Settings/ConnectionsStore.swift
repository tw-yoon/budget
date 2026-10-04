import Foundation
import Observation

/// One Settings → Connections write. An enum rather than a closure, so the
/// store keeps the typed error (see TransactionDetailView.Write).
enum ConnectionWrite: Equatable, Sendable {
  case removeCard(id: String)
  case disconnect(itemId: String)
  /// Delete… / Delete History…: everything the bank recorded.
  case deleteHistory(itemId: String)

  /// The bank this write changes, if any.
  var bankItemId: String? {
    switch self {
    case .removeCard: nil
    case .disconnect(let itemId), .deleteHistory(let itemId): itemId
    }
  }
}

/// What Settings → Connections shows (../src/components/SettingsConnections.tsx):
/// debit cards and connected banks. Same failure rules as the other stores:
/// with nothing on screen an error is full-screen; with data showing it
/// becomes a banner and the data stays.
@MainActor
@Observable
final class ConnectionsStore {
  private(set) var data: ConnectionsResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// One write at a time.
  private(set) var isSaving = false
  /// The bank whose disconnect or delete is in flight, for its row's spinner.
  private(set) var disconnectingItemId: String?
  /// Bumped after each successful disconnect or history delete, so Settings
  /// can tell the other tabs their accounts and transactions changed.
  private(set) var disconnectCount = 0
  var banner: String?

  private let client: @MainActor () -> APIClient?
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
    if data == nil { error = nil }
    isLoading = true
    defer { if generation == loadGeneration { isLoading = false } }
    do throws(APIError) {
      let result = try await client.connections()
      guard generation == loadGeneration else { return }
      data = result
      error = nil
      banner = nil
    } catch {
      guard generation == loadGeneration else { return }
      if error == .cancelled { return }
      if data == nil { self.error = error } else { banner = error.loadBanner }
    }
  }

  /// Runs one write. A stale banner clears before the request; success
  /// reloads, failure shows the server's message and leaves the list as is.
  func perform(_ write: ConnectionWrite) async {
    guard !isSaving else { return }
    guard let client = client() else {
      banner = APIError.notConfigured.message
      return
    }
    isSaving = true
    defer { isSaving = false }
    disconnectingItemId = write.bankItemId
    defer { disconnectingItemId = nil }
    banner = nil
    do throws(APIError) {
      switch write {
      case .removeCard(let id): try await client.removeDebitCard(id: id)
      case .disconnect(let itemId): try await client.disconnectBank(itemId: itemId)
      case .deleteHistory(let itemId): try await client.deleteBankHistory(itemId: itemId)
      }
    } catch {
      if error != .cancelled { banner = error.message }
      return
    }
    if write.bankItemId != nil { disconnectCount += 1 }
    await load()
  }

  /// The Add sheet's submit. Throws so the sheet keeps its fields and shows why.
  func add(_ card: NewDebitCard) async throws(APIError) {
    guard let client = client() else { throw .notConfigured }
    banner = nil
    try await client.addDebitCard(card)
    await load()
  }
}
