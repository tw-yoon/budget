import Foundation
import Observation

/// The shared Normal / Pro setting, as useProMode.ts reads it: the
/// `pro-mode` key, else the legacy `analytics-mode` key, and only the string
/// "pro" means Pro. Until it has loaded — and whenever it cannot — the phone
/// behaves as Normal, so a Pro control never appears and then vanishes.
/// Settings changes it through `choose`. Unlike the web, the phone
/// never pushes the legacy value forward; the web does that migration.
@MainActor
@Observable
final class ProMode {
  nonisolated static let key = "pro-mode"
  nonisolated static let legacyKey = "analytics-mode"

  private(set) var isPro = false
  /// True after the first successful or saved read, or a choice — useProMode's
  /// `!loading`. Until then `isPro` is just the untrue-but-safe default, so
  /// callers that would otherwise show a Normal-mode-only hint should wait
  /// for this.
  private(set) var hasLoaded = false
  /// The last choice didn't reach the server. The choice still applies here;
  /// Settings shows a banner and clears this on dismiss. Stale failures
  /// (from a choice that was superseded) are not flagged.
  var saveFailed = false
  /// Reads and choices are counted apart, so a load never makes a choice's
  /// failure look stale. A read is dropped if a newer read started, if a
  /// choice was made after it started, or if a save was in flight at its
  /// start or end — the server may not hold that choice yet. This stands in
  /// for useProMode's `chosen`, which drops every read after a choice.
  private var reads = 0
  private var choices = 0
  private var savesInFlight = 0
  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// resolveProMode.
  static func resolve(_ value: UIStateValue) -> Bool { value.string == "pro" }

  func load() async {
    guard let client = client() else { return }
    // Until the first read, the setting the last launch saved, resolved the
    // same way, so a Pro screen opens as Pro.
    if !hasLoaded, let pro = Self.saved(client) {
      isPro = pro
      hasLoaded = true
    }
    reads += 1
    let read = reads, choice = choices, savingAtStart = savesInFlight > 0
    do throws(APIError) {
      let stored = try await client.uiState(Self.key)
      let pro = stored.isStored ? Self.resolve(stored) : Self.resolve(try await client.uiState(Self.legacyKey))
      guard read == reads, choice == choices, !savingAtStart, savesInFlight == 0 else { return }
      isPro = pro
      hasLoaded = true
    } catch {
      // Keep whatever was last known; a failed read is not a mode change.
    }
  }

  /// The saved answers: the key when stored, else the legacy key; nil when
  /// neither was saved.
  private static func saved(_ client: APIClient) -> Bool? {
    if let stored = client.savedUIState(key), stored.isStored { return resolve(stored) }
    return client.savedUIState(legacyKey).map(resolve)
  }

  /// useProMode's choose: applies at once, then saves.
  func choose(_ pro: Bool) async {
    choices += 1
    let mine = choices
    isPro = pro
    hasLoaded = true
    saveFailed = false
    guard let client = client() else { return }
    savesInFlight += 1
    defer { savesInFlight -= 1 }
    do throws(APIError) {
      try await client.putUIState(key: Self.key, value: pro ? "pro" : "normal")
      // The next launch opens with this choice, not the value read before it.
      if mine == choices { client.saveUIState(Self.key, string: pro ? "pro" : "normal") }
    } catch {
      if error != .cancelled && mine == choices { saveFailed = true }
    }
  }
}
