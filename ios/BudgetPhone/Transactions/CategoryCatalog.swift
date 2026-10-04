import Foundation
import Observation

/// The category list the pickers offer: GET /api/categories, plus the
/// subcategories seen on loaded rows and saved this session — the web's
/// `categories` and `knownSubs`. Shared by the row editor and the split
/// sheet (and later the Rules screen).
@MainActor
@Observable
final class CategoryCatalog {
  private(set) var names: [String] = []
  /// Declared in Settings as of the last successful load — replaced whole
  /// each time, so a subcategory removed there disappears here too.
  private var declaredSubs: [String: Set<String>] = [:]
  /// Seen on a loaded row or saved this session; never dropped by a reload,
  /// since the row that used it may still be showing.
  private var seenSubs: [String: Set<String>] = [:]
  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// Keeps what it had when the call fails; the pickers still offer the
  /// row's own category via `Ledger.categoryOptions`.
  func load() async {
    guard let client = client() else { return }
    do throws(APIError) {
      let r = try await client.categories()
      names = r.categories.map(\.name)
      var rebuilt: [String: Set<String>] = [:]
      for c in r.categories {
        rebuilt[c.name, default: []].formUnion(c.subcategories.map(\.name))
      }
      declaredSubs = rebuilt
    } catch {}
  }

  /// Records the subcategory in a "Parent > Sub" value, if it has one.
  func noteUsed(_ userCategory: String?) {
    guard let userCategory else { return }
    let (parent, sub) = CategoryPath.split(userCategory)
    if let sub { seenSubs[parent, default: []].insert(sub) }
  }

  func subcategories(of parent: String) -> [String] {
    declaredSubs[parent, default: []].union(seenSubs[parent] ?? [])
      .sorted { $0.localizedCompare($1) == .orderedAscending }
  }
}
