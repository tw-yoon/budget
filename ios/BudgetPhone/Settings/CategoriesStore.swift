import Foundation
import Observation

/// One Settings → Categories write. An enum rather than a closure, so the
/// store keeps the typed error (see TransactionDetailView.Write).
enum CategoryWrite: Equatable, Sendable {
  case create(name: String)
  case rename(id: String, name: String, allowMerge: Bool)
  case setPrimaries(id: String, primaries: [String])
  case delete(id: String)
  case createSub(categoryId: String, name: String)
  case renameSub(categoryId: String, from: String, to: String, allowMerge: Bool)
  case deleteSub(categoryId: String, name: String)
}

/// What Settings → Categories shows (../src/components/SettingsCategories.tsx),
/// shared by the list and the detail screen. Same failure rules as the
/// other stores: with nothing on screen an error is full-screen; with data
/// showing it becomes a banner and the data stays. Opens with the list
/// saved last time while the server answers, as Subscriptions.
@MainActor
@Observable
final class CategoriesStore {
  private(set) var data: CategoriesAdminResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// One write at a time; also stands in for the web's double-save guard.
  private(set) var isSaving = false
  /// Bumped by every successful write, so the ledger's pickers can reload.
  private(set) var writeCount = 0
  var banner: String?
  var notice: String?

  private let client: @MainActor () -> APIClient?
  private var loadGeneration = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  func category(id: String) -> AdminCategory? {
    data?.categories.first { $0.id == id }
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
      data = client.savedCategories()
    }
    isLoading = true
    defer { if generation == loadGeneration { isLoading = false } }
    do throws(APIError) {
      let result = try await client.categoriesAdmin()
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

  /// Runs one write. Stale messages clear before the request; on success
  /// the list reloads (keeping its rows) and the web's notice, if it shows
  /// one, is applied after the reload so the reload doesn't wipe it.
  /// Returns the server's merge prompt when a rename needs confirming; the
  /// caller asks, then performs the same rename with `allowMerge: true`.
  @discardableResult
  func perform(_ write: CategoryWrite) async -> MergePrompt? {
    guard !isSaving else { return nil }
    guard let client = client() else {
      banner = APIError.notConfigured.message
      return nil
    }
    isSaving = true
    defer { isSaving = false }
    banner = nil
    notice = nil
    var ownNotice: String?
    do throws(APIError) {
      switch write {
      case .create(let name):
        try await client.createCategory(name: name)
      case .rename(let id, let name, let allowMerge):
        switch try await client.renameCategory(id: id, name: name, allowMerge: allowMerge) {
        case .done(let r): ownNotice = CategoryRules.renameNotice(r, to: name)
        case .needsMerge(let prompt): return prompt
        }
      case .setPrimaries(let id, let primaries):
        try await client.setPlaidPrimaries(id: id, primaries)
      case .delete(let id):
        try await client.deleteCategory(id: id)
      case .createSub(let categoryId, let name):
        try await client.createSubcategory(categoryId: categoryId, name: name)
      case .renameSub(let categoryId, let from, let to, let allowMerge):
        switch try await client.renameSubcategory(
          categoryId: categoryId, from: from, to: to, allowMerge: allowMerge)
        {
        case .done(let r): ownNotice = CategoryRules.renameNotice(r, to: to)
        case .needsMerge(let prompt): return prompt
        }
      case .deleteSub(let categoryId, let name):
        let categoryName = category(id: categoryId)?.name ?? ""
        let r = try await client.deleteSubcategory(categoryId: categoryId, name: name)
        ownNotice = CategoryRules.subDeleteNotice(r, category: categoryName)
      }
    } catch {
      if error != .cancelled { banner = error.message }
      return nil
    }
    writeCount += 1
    await load()
    if let ownNotice { notice = ownNotice }
    return nil
  }
}
