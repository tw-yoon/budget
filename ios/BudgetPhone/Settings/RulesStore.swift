import Foundation
import Observation

/// One Settings → Rules write. An enum rather than a closure, so the store
/// keeps the typed error (see TransactionDetailView.Write).
enum RuleWrite: Equatable, Sendable {
  case setCategory(id: String, category: String)
  case setEnabled(id: String, enabled: Bool)
  case delete(id: String)
  case takeOver(id: String)
}

/// What Settings → Rules shows (../src/components/RulesDashboard.tsx),
/// shared by the list, the detail screen and the Add sheet. Same failure
/// rules as the other stores: with nothing on screen an error is
/// full-screen; with data showing it becomes a banner and the data stays.
@MainActor
@Observable
final class RulesStore {
  private(set) var data: RulesResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// One write at a time.
  private(set) var isSaving = false
  private(set) var isApplying = false
  /// Bumped when Apply Now or Use Rule for These succeeds — the two rule
  /// actions that rewrite transaction categories — so the Activity tab reloads.
  private(set) var recategorizeCount = 0
  var banner: String?
  var notice: String?

  private let client: @MainActor () -> APIClient?
  private var loadGeneration = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  func rule(id: String) -> RuleDTO? {
    data?.rules.first { $0.id == id }
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
      let result = try await client.rules()
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

  /// Runs one write. Stale messages clear before the request. Success or
  /// failure, the list then reloads — the web reloads after a failed toggle
  /// too, which puts the switch back — and this write's own notice or
  /// banner is applied after the reload so the reload doesn't wipe it.
  func perform(_ write: RuleWrite) async {
    guard !isSaving else { return }
    guard let client = client() else {
      banner = APIError.notConfigured.message
      return
    }
    isSaving = true
    defer { isSaving = false }
    banner = nil
    notice = nil
    var ownNotice: String?
    var ownBanner: String?
    do throws(APIError) {
      switch write {
      case .setCategory(let id, let category):
        try await client.setRuleCategory(id: id, category)
      case .setEnabled(let id, let enabled):
        try await client.setRuleEnabled(id: id, enabled)
      case .delete(let id):
        try await client.deleteRule(id: id)
      case .takeOver(let id):
        let pattern = rule(id: id)?.pattern ?? ""
        let r = try await client.takeOverRule(id: id)
        recategorizeCount += 1
        ownNotice = RuleText.takeOverNotice(pattern: pattern, updated: r.updated)
      }
    } catch {
      if error == .cancelled { return }
      switch write {
      case .setCategory, .setEnabled: ownBanner = RuleText.updateFailed
      case .delete, .takeOver: ownBanner = error.message
      }
    }
    await load()
    if let ownNotice { notice = ownNotice }
    if let ownBanner { banner = ownBanner }
  }

  /// Apply Now. One at a time; stale messages clear first. The web reloads
  /// only after a successful apply.
  func apply() async {
    guard !isApplying else { return }
    guard let client = client() else {
      banner = APIError.notConfigured.message
      return
    }
    isApplying = true
    defer { isApplying = false }
    banner = nil
    notice = nil
    do throws(APIError) {
      let r = try await client.applyRules()
      recategorizeCount += 1
      await load()
      notice = RuleText.applyNotice(r)
    } catch {
      if error != .cancelled { banner = error.message }
    }
  }

  /// The Add sheet's submit. Throws so the sheet keeps its fields and shows why.
  func add(_ rule: NewRule) async throws(APIError) {
    guard let client = client() else { throw .notConfigured }
    banner = nil
    notice = nil
    try await client.createRule(rule)
    await load()
  }
}
