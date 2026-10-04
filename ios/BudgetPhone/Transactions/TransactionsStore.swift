import Foundation
import Observation

/// The ledger: its query, the pages loaded so far, Sync, and the row writes.
/// Failures follow the Accounts rules — full screen while nothing has loaded,
/// a banner over rows that are still showing.
@MainActor
@Observable
final class TransactionsStore {
  private(set) var query = TransactionQuery()
  /// Loaded pages in order; `rows` flattens them.
  private var pages: [[TransactionDTO]] = []
  private(set) var total: Int?
  private(set) var totalPages = 0

  private(set) var error: APIError?
  private(set) var isLoading = false
  private(set) var isLoadingMore = false
  /// The last next-page request failed; the view offers Retry.
  private(set) var loadMoreFailed = false
  private(set) var isSyncing = false
  var banner: String?

  private let client: @MainActor () -> APIClient?
  /// Bumped whenever the query changes or page 1 reloads; a response only
  /// applies if its generation is still current.
  private var generation = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// Every loaded row once, in page order. A sync between two page requests
  /// can shift a row across a page boundary; the first copy wins.
  var rows: [TransactionDTO] {
    var seen = Set<String>()
    return pages.joined().filter { seen.insert($0.id).inserted }
  }

  var hasMore: Bool { pages.count < totalPages }

  func row(_ id: String) -> TransactionDTO? {
    pages.lazy.joined().first { $0.id == id }
  }

  /// New search, filters or sort: start over at page 1.
  func apply(_ query: TransactionQuery) async {
    guard query != self.query else { return }
    self.query = query
    await reload()
  }

  /// Page 1 of the current query, replacing everything loaded.
  func reload() async {
    generation += 1
    let current = generation
    guard let client = client() else {
      error = .notConfigured
      return
    }
    if pages.isEmpty { error = nil }
    isLoading = true
    loadMoreFailed = false
    isLoadingMore = false
    defer { if current == generation { isLoading = false } }
    do throws(APIError) {
      let r = try await client.transactions(query, page: 1)
      guard current == generation else { return }
      pages = [r.transactions]
      total = r.total
      totalPages = r.totalPages
      error = nil
      banner = nil
    } catch {
      guard current == generation, error != .cancelled else { return }
      if pages.isEmpty { self.error = error } else { banner = error.message }
    }
  }

  /// The next page, appended. Called when the last row appears.
  func loadMore() async {
    guard hasMore, !isLoadingMore, !isLoading, let client = client() else { return }
    let current = generation
    let page = pages.count + 1
    isLoadingMore = true
    loadMoreFailed = false
    defer { if current == generation { isLoadingMore = false } }
    do throws(APIError) {
      let r = try await client.transactions(query, page: page)
      guard current == generation, pages.count == page - 1 else { return }
      pages.append(r.transactions)
      total = r.total
      totalPages = r.totalPages
    } catch {
      guard current == generation, error != .cancelled else { return }
      loadMoreFailed = true
    }
  }

  /// "Sync transactions": Plaid first, then page 1. Banks that failed are
  /// named in the banner; the reload happens regardless.
  func sync() async {
    guard !isSyncing, let client = client() else { return }
    isSyncing = true
    banner = nil
    defer { isSyncing = false }
    var syncBanner: String?
    do throws(APIError) {
      let failed = try await client.syncTransactions().summary.filter { !$0.success }
      if !failed.isEmpty {
        syncBanner = "Couldn't sync "
          + failed.map { "\($0.institution) (\($0.error ?? "unknown error"))" }.joined(separator: ", ")
      }
    } catch {
      if error != .cancelled { syncBanner = error.message }
    }
    await reload()
    if let syncBanner { banner = syncBanner }
  }

  // MARK: - Writes. Each re-reads the page holding the row, so the list and
  // the detail screen show the server's result. Errors are thrown for the
  // detail screen to show; nothing is changed locally on failure.

  func setCategory(_ id: String, _ update: CategoryUpdate) async throws(APIError) {
    try await requireClient().updateCategory(transactionId: id, update)
    await reloadPage(containing: id)
  }

  func setLink(_ id: String, label: Int?) async throws(APIError) {
    try await requireClient().updateLink(transactionId: id, LinkUpdate(linkedToLabel: label))
    await reloadPage(containing: id)
  }

  func addSplit(_ id: String, _ split: NewSplit) async throws(APIError) {
    try await requireClient().addSplit(transactionId: id, split)
    await reloadPage(containing: id)
  }

  func deleteSplit(_ id: String, splitId: String) async throws(APIError) {
    try await requireClient().deleteSplit(transactionId: id, splitId: splitId)
    await reloadPage(containing: id)
  }

  func linkCandidates(_ id: String) async throws(APIError) -> [LinkCandidate] {
    try await requireClient().linkCandidates(transactionId: id)
  }

  private func requireClient() throws(APIError) -> APIClient {
    guard let client = client() else { throw .notConfigured }
    return client
  }

  /// Re-fetches the one page a row came from and swaps it in. After a write
  /// the row may no longer match the filters (a category set to Transfer
  /// with transfers hidden); it then simply drops out of the list.
  func reloadPage(containing id: String) async {
    guard let index = pages.firstIndex(where: { $0.contains { $0.id == id } }) else {
      await reload()
      return
    }
    guard let client = client() else { return }
    let current = generation
    do throws(APIError) {
      let r = try await client.transactions(query, page: index + 1)
      guard current == generation, index < pages.count else { return }
      pages[index] = r.transactions
      total = r.total
      totalPages = r.totalPages
    } catch {
      guard current == generation, error != .cancelled else { return }
      banner = error.message
    }
  }
}
