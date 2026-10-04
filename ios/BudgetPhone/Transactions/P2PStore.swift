import Foundation
import Observation

/// One categorizer feed (Venmo or Zelle). A category change shows at once
/// and is sent in the background; if the server refuses it, the message goes
/// in the banner and the list reloads — P2pCategorizer's behaviour.
@MainActor
@Observable
final class P2PStore {
  let source: P2PSource
  private(set) var data: P2PResponse?
  private(set) var error: APIError?
  private(set) var isLoading = false
  private(set) var isImporting = false
  var banner: String?
  /// The import result, shown until the next import or dismissal.
  var notice: String?

  private let client: @MainActor () -> APIClient?
  private var generation = 0

  init(source: P2PSource, client: @escaping @MainActor () -> APIClient?) {
    self.source = source
    self.client = client
  }

  var totals: P2PTotals { P2PTotals(data?.transactions ?? []) }

  /// The picker's options for a row: the feed's list, plus the row's own
  /// category if a link gave it one that isn't in the list.
  func options(for row: P2PTransaction) -> [String] {
    let list = data?.categories ?? []
    return list.contains(row.category) ? list : list + [row.category]
  }

  func load() async {
    generation += 1
    let current = generation
    guard let client = client() else {
      error = .notConfigured
      return
    }
    if data == nil { error = nil }
    isLoading = true
    defer { if current == generation { isLoading = false } }
    do throws(APIError) {
      let r = try await client.p2p(source)
      guard current == generation else { return }
      data = r
      error = nil
      banner = nil
    } catch {
      guard current == generation, error != .cancelled else { return }
      if data == nil { self.error = error } else { banner = error.loadBanner }
    }
  }

  func setCategory(_ id: String, to category: String) async {
    guard let client = client(), let current = data,
      let index = current.transactions.firstIndex(where: { $0.id == id })
    else { return }
    var rows = current.transactions
    let old = rows[index]
    rows[index] = P2PTransaction(
      id: old.id, label: old.label, date: old.date, note: old.note,
      counterparty: old.counterparty, direction: old.direction, amount: old.amount,
      category: category, linkedTo: old.linkedTo)
    data = P2PResponse(transactions: rows, categories: current.categories)
    do throws(APIError) {
      try await client.setP2PCategory(source, id: id, category: category)
    } catch {
      guard error != .cancelled else { return }
      await load()
      // P2pCategorizer.tsx: `body.error ?? fallback` — only a route that
      // actually sent `{error}` gets to speak for itself. `APIClient.send`
      // falls back to the HTTP status text when the body had no `error`
      // field, so that exact text is the tell that there was none.
      if case .server(let status, let message) = error,
        message != HTTPURLResponse.localizedString(forStatusCode: status)
      {
        banner = message
      } else {
        banner = "Failed to save category — reloading."
      }
    }
  }

  func runImport() async {
    guard source.canImport, !isImporting, let client = client() else { return }
    isImporting = true
    defer { isImporting = false }
    notice = nil
    banner = nil
    do throws(APIError) {
      notice = try await client.importP2P(source).notice
      await load()
    } catch {
      if error != .cancelled { banner = error.message }
    }
  }
}
