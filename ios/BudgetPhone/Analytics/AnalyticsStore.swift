import Foundation
import Observation

/// What the Analytics tab shows (../src/components/AnalyticsDashboard.tsx):
/// the summary cards, the cash-flow series the category and trend charts
/// window over, and in Pro mode the daily spend and saved monthly limit.
/// Same failure rules as AccountsStore: with nothing on screen an error is
/// full-screen; with data showing it becomes a banner and the data stays.
@MainActor
@Observable
final class AnalyticsStore {
  /// SpendingGraph's LIMIT_KEY in /api/ui-state.
  static let limitKey = "spendingMonthlyLimit"
  /// AnalyticsDashboard's RANGES.
  static let ranges = [3, 6, 12]

  /// The web opens on 6 months; the phone opens on 3 by the owner's choice.
  /// Only this range's summary is saved, since it is the one a launch shows.
  nonisolated static let launchRange = 3

  private(set) var range = AnalyticsStore.launchRange
  private(set) var summary: AnalyticsSummary?
  /// The range's top merchants, from the same call as `summary`. Phone-only:
  /// the server sends them but the web page doesn't show them.
  private(set) var topMerchants: [MerchantTotal] = []
  /// True while a range change waits for its summary; the cards dim.
  private(set) var isLoadingSummary = false
  private(set) var cashflow: [CashflowMonth]?
  private(set) var spending: [DailySpend]?
  /// The saved limit; nil means the graph uses its computed default.
  private(set) var limitOverride: Double?
  /// True while a load is in flight; the Spending card spins only then.
  private(set) var isLoading = false
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  /// A non-blocking message over data that is still valid.
  var banner: String?

  var hasData: Bool { summary != nil || cashflow != nil }

  private let client: @MainActor () -> APIClient?
  /// Bumped by every load; a completion applies only if it is still the
  /// latest (overlapping `.task`, `scenePhase`, pull and Pro changes).
  private var loadGeneration = 0
  /// Bumped by loads and range changes, which both write `summary`.
  private var summaryGeneration = 0
  private var limitSaves = 0
  private var limitSavesInFlight = 0

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// The tab's GETs, one after another. The first failure decides the
  /// message; a limit read never does (the web ignores it too).
  func load(isPro: Bool) async {
    loadGeneration += 1
    summaryGeneration += 1
    let generation = loadGeneration
    let summaryGen = summaryGeneration
    guard let client = client() else {
      summary = nil
      topMerchants = []
      cashflow = nil
      spending = nil
      error = .notConfigured
      return
    }
    isLoading = true
    defer { if generation == loadGeneration { isLoading = false } }
    // Nothing showing yet: whatever the last launch saved shows until the
    // server answers. Once there is data the cache is never read again, so a
    // later failure (or a switch to Pro) can't bring back an old answer.
    if !hasData {
      error = nil
      if let saved = client.savedAnalytics(months: range) {
        summary = saved.summary
        topMerchants = saved.topMerchants ?? []
      }
      cashflow = client.savedCashflow()?.months
      if isPro, spending == nil { spending = client.savedSpending()?.days }
    }
    var failure: APIError?

    do throws(APIError) {
      let result = try await client.analytics(months: range)
      // This load now owns the summary, so a range change it superseded can
      // no longer clear the dimming itself.
      if summaryGen == summaryGeneration { isLoadingSummary = false }
      guard generation == loadGeneration else { return }
      if summaryGen == summaryGeneration {
        summary = result.summary
        topMerchants = result.topMerchants ?? []
      }
    } catch {
      if summaryGen == summaryGeneration { isLoadingSummary = false }
      guard generation == loadGeneration else { return }
      failure = failure ?? error
    }

    do throws(APIError) {
      let result = try await client.cashflow()
      guard generation == loadGeneration else { return }
      cashflow = result.months
    } catch {
      guard generation == loadGeneration else { return }
      failure = failure ?? error
    }

    if isPro {
      do throws(APIError) {
        let result = try await client.spending()
        guard generation == loadGeneration else { return }
        spending = result.days
      } catch {
        guard generation == loadGeneration else { return }
        failure = failure ?? error
      }
      await loadLimit(client, generation: generation)
      guard generation == loadGeneration else { return }
    }

    report(failure)
  }

  /// Pull-to-refresh: clears a stale banner first, then reloads. Analytics
  /// never calls Plaid.
  func refresh(isPro: Bool) async {
    banner = nil
    await load(isPro: isPro)
  }

  /// The range picker: reloads the summary only, keeping the old cards
  /// (dimmed) until the new ones arrive.
  func changeRange(_ months: Int) async {
    range = months
    summaryGeneration += 1
    let generation = summaryGeneration
    guard let client = client() else { return }
    banner = nil
    isLoadingSummary = true
    defer { if generation == summaryGeneration { isLoadingSummary = false } }
    do throws(APIError) {
      let result = try await client.analytics(months: months)
      guard generation == summaryGeneration else { return }
      summary = result.summary
      topMerchants = result.topMerchants ?? []
    } catch {
      guard generation == summaryGeneration else { return }
      if error == .cancelled { return }
      if hasData { banner = error.loadBanner } else { self.error = error }
    }
  }

  /// SpendingGraph's setLimit: applies at once, then saves. The web falls
  /// back silently to localStorage; the phone has nowhere else to keep the
  /// value, so a failed save shows a banner.
  func saveLimit(_ value: Double, current: Double) async {
    let value = max(0, value)
    guard value != current else { return }
    limitSaves += 1
    let mine = limitSaves
    limitOverride = value
    banner = nil
    guard let client = client() else { return }
    limitSavesInFlight += 1
    defer { limitSavesInFlight -= 1 }
    do throws(APIError) {
      try await client.putUIState(key: Self.limitKey, value: value)
    } catch {
      if error != .cancelled && mine == limitSaves {
        banner = "Couldn't save the limit to the server."
      }
    }
  }

  /// loadSynced's read. Silent on failure or an unusable value. Dropped if a
  /// save was in flight at its start or end, or one started meanwhile.
  private func loadLimit(_ client: APIClient, generation: Int) async {
    guard limitSavesInFlight == 0 else { return }
    let saves = limitSaves
    guard let stored = try? await client.uiState(Self.limitKey) else { return }
    guard generation == loadGeneration, saves == limitSaves, limitSavesInFlight == 0 else { return }
    // Cleared or unusable on the server means the default again.
    limitOverride = stored.number
  }

  /// A load's outcome: success clears both messages; a failure is
  /// full-screen with nothing to show, else a banner. `.cancelled` is silent.
  private func report(_ failure: APIError?) {
    guard let failure else {
      error = nil
      banner = nil
      return
    }
    if failure == .cancelled { return }
    if hasData { banner = failure.loadBanner } else { error = failure }
  }
}
