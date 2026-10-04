import Foundation

/// The ledger's search, filters and sort — TransactionLedger.tsx's state —
/// and the query string it sends.
struct TransactionQuery: Equatable, Sendable, Codable {
  enum Sort: String, Codable, Sendable, CaseIterable { case date, label }

  static let pageSize = 50

  var search = ""
  var accountId: String?
  var hideInternal = true
  var showLinked = false
  var sort: Sort = .date
  var ascending = false

  /// True when the filter menu has nothing set away from its defaults.
  /// Search is not a filter here; it has its own field.
  var filtersAreDefault: Bool {
    accountId == nil && hideInternal && !showLinked && sort == .date && !ascending
  }

  /// True when the search field sends a search (queryItems trims it).
  var hasSearch: Bool { !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  /// The web's URLSearchParams, in its order. Search and account are left
  /// out when empty, as the web does.
  func queryItems(page: Int) -> [URLQueryItem] {
    var items = [
      URLQueryItem(name: "page", value: String(page)),
      URLQueryItem(name: "limit", value: String(Self.pageSize)),
      URLQueryItem(name: "hideInternal", value: String(hideInternal)),
      URLQueryItem(name: "hideLinked", value: String(!showLinked)),
      URLQueryItem(name: "sort", value: sort.rawValue),
      URLQueryItem(name: "dir", value: ascending ? "asc" : "desc"),
    ]
    if hasSearch {
      items.append(URLQueryItem(name: "search", value: search.trimmingCharacters(in: .whitespacesAndNewlines)))
    }
    if let accountId, !accountId.isEmpty { items.append(URLQueryItem(name: "accountId", value: accountId)) }
    return items
  }
}
