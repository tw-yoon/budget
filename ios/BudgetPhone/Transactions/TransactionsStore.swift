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
  /// Sync and the row writes, for their haptics (TransactionsView).
  private(set) var feedback = SaveFeedback()
  /// Set once the ledger has tried to reopen at the row the last launch was
  /// on (LedgerPosition), so it happens on the first load only. In the store
  /// rather than the view, which is rebuilt on every segment switch.
  @ObservationIgnored var positionRestored = false

  private let client: @MainActor () -> APIClient?
  /// Bumped whenever the query changes or page 1 reloads; a response only
  /// applies if its generation is still current.
  private var generation = 0
  /// Page 1 of the last few queries, newest last, in memory only. Going back
  /// to one shows it at once while the server is asked again.
  private var recent: [(query: TransactionQuery, page: TransactionsResponse)] = []
  static let recentLimit = 10

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
    if let kept = recent.last(where: { $0.query == query })?.page {
      pages = [kept.transactions]
      total = kept.total
      totalPages = kept.totalPages
      error = nil
    }
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
    if pages.isEmpty {
      error = nil
      // The page the last launch saved for this query, until the server answers.
      if let saved = client.savedTransactions(query) {
        pages = [saved.transactions]
        total = saved.total
        totalPages = saved.totalPages
      }
    }
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
      remember(r, for: query)
    } catch {
      guard current == generation, error != .cancelled else { return }
      if pages.isEmpty { self.error = error } else { banner = error.loadBanner }
    }
  }

  /// Data changed elsewhere (Settings), so the kept pages may be out of date.
  func forgetRecent() { recent = [] }

  private func remember(_ page: TransactionsResponse, for query: TransactionQuery) {
    recent.removeAll { $0.query == query }
    recent.append((query, page))
    if recent.count > Self.recentLimit { recent.removeFirst() }
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
    forgetRecent()
    defer { isSyncing = false }
    var syncBanner: String?
    var cancelled = false
    do throws(APIError) {
      let failed = try await client.syncTransactions().summary.filter { !$0.success }
      if !failed.isEmpty {
        syncBanner = "Couldn't sync "
          + failed.map { "\($0.institution) (\($0.error ?? "unknown error"))" }.joined(separator: ", ")
      }
    } catch {
      cancelled = error == .cancelled
      if !cancelled { syncBanner = error.message }
    }
    // A bank that failed to sync makes the whole sync a failure.
    if !cancelled { feedback.record(succeeded: syncBanner == nil) }
    await reload()
    if let syncBanner { banner = syncBanner }
  }

  // MARK: - Writes. Each re-reads the page holding the row, so the list and
  // the detail screen show the server's result. Errors are thrown for the
  // detail screen to show; nothing is changed locally on failure.

  func setCategory(_ id: String, _ update: CategoryUpdate) async throws(APIError) {
    try await write(.category(update), id)
  }

  func setLink(_ id: String, label: Int?) async throws(APIError) {
    try await write(.link(label), id)
  }

  func addSplit(_ id: String, _ split: NewSplit) async throws(APIError) {
    try await write(.addSplit(split), id)
  }

  func deleteSplit(_ id: String, splitId: String) async throws(APIError) {
    try await write(.deleteSplit(splitId), id)
  }

  private enum Write {
    case category(CategoryUpdate)
    case link(Int?)
    case addSplit(NewSplit)
    case deleteSplit(String)
  }

  /// Sends one row write, notes its outcome for the haptic, then re-reads
  /// the row's page.
  private func write(_ write: Write, _ id: String) async throws(APIError) {
    do throws(APIError) {
      let client = try requireClient()
      switch write {
      case .category(let update): try await client.updateCategory(transactionId: id, update)
      case .link(let label): try await client.updateLink(transactionId: id, LinkUpdate(linkedToLabel: label))
      case .addSplit(let split): try await client.addSplit(transactionId: id, split)
      case .deleteSplit(let splitId): try await client.deleteSplit(transactionId: id, splitId: splitId)
      }
    } catch {
      feedback.record(error)
      throw error
    }
    feedback.record(nil)
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
    // The write may have changed rows in the other kept queries too.
    forgetRecent()
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
