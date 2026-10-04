import Foundation
import Testing
@testable import BudgetPhone

/// Mutable answers a stub handler reads at response time.
final class AnalyticsStub: @unchecked Sendable {
  var failing: Set<String> = []
  var txCount = 4
  var limit = "null"
  var cancel = false
}

extension StubbedNetworkTests {
  /// The Analytics store's loads, failures and limit saves.
  @Suite(.serialized)
  @MainActor
  struct AnalyticsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let stub = AnalyticsStub()

    nonisolated static let cashflowJSON =
      #"{"months":[{"key":"2026-08","label":"Aug 2026","income":[{"source":"Paycheck","amount":300}],"spend":[{"category":"Groceries","amount":100}]}],"currentCash":0,"cashAsOf":null}"#
    nonisolated static let spendingJSON = #"{"days":[{"date":"2026-08-03","amount":100}]}"#

    nonisolated static func answer(_ r: URLRequest, _ stub: AnalyticsStub) throws -> (Int, Data) {
      if stub.cancel { throw URLError(.cancelled) }
      let path = r.url!.path()
      if stub.failing.contains(path) {
        return (500, Data(#"{"error":"Failed to compute analytics"}"#.utf8))
      }
      switch path {
      case "/api/analytics":
        return (200, Data(
          #"{"summary":{"totalSpent":100,"totalIncome":300,"net":200,"txCount":\#(stub.txCount)},"byCategory":[],"byMonth":[],"topMerchants":[{"name":"Sample Mart","amount":80,"count":\#(stub.txCount)}],"rangeMonths":6}"#.utf8))
      case "/api/analytics/cashflow": return (200, Data(cashflowJSON.utf8))
      case "/api/analytics/spending": return (200, Data(spendingJSON.utf8))
      case "/api/ui-state":
        return r.httpMethod == "PUT"
          ? (200, Data(#"{"ok":true}"#.utf8)) : (200, Data(#"{"value":\#(stub.limit)}"#.utf8))
      default: return (404, Data())
      }
    }

    func store(gates: [Gate] = []) -> AnalyticsStore {
      let stub = self.stub
      let c = APIClient(
        baseURL: base,
        session: StubURLProtocol.session({ try Self.answer($0, stub) }, gates: gates))
      return AnalyticsStore { c }
    }

    func paths() -> [String] { StubURLProtocol.requests.compactMap { $0.url?.path() } }

    nonisolated static func isAnalytics(_ r: URLRequest) -> Bool { r.url?.path() == "/api/analytics" }
    nonisolated static func isPUT(_ r: URLRequest) -> Bool { r.httpMethod == "PUT" }

    // MARK: Loading

    @Test func normalModeLoadsSummaryAndCashflowOnly() async {
      let s = store()
      await s.load(isPro: false)
      #expect(paths() == ["/api/analytics", "/api/analytics/cashflow"])
      #expect(TestData.query(of: StubURLProtocol.requests[0], "months") == "3")
      #expect(s.summary?.txCount == 4)
      #expect(s.cashflow?.count == 1)
      #expect(s.spending == nil)
      #expect(s.error == nil && s.banner == nil)
    }

    @Test func proModeAlsoLoadsSpendingAndTheLimit() async {
      stub.limit = "2500"
      let s = store()
      await s.load(isPro: true)
      #expect(paths() == [
        "/api/analytics", "/api/analytics/cashflow", "/api/analytics/spending", "/api/ui-state",
      ])
      #expect(TestData.query(of: StubURLProtocol.requests[3], "key") == "spendingMonthlyLimit")
      #expect(s.spending?.count == 1)
      #expect(s.limitOverride == 2500)
    }

    @Test func aClearedStoredLimitFallsBackToTheDefault() async {
      stub.limit = "2500"
      let s = store()
      await s.load(isPro: true)
      #expect(s.limitOverride == 2500)
      stub.limit = "null"
      await s.load(isPro: true)
      #expect(s.limitOverride == nil)
    }

    @Test func aNumericStringLimitIsRead() async {
      stub.limit = #""1800""#
      let s = store()
      await s.load(isPro: true)
      #expect(s.limitOverride == 1800)
    }

    @Test func anUnusableOrFailedLimitReadIsSilent() async {
      stub.limit = #""""#
      let s = store()
      await s.load(isPro: true)
      #expect(s.limitOverride == nil)
      stub.failing = ["/api/ui-state"]
      await s.load(isPro: true)
      #expect(s.limitOverride == nil)
      #expect(s.banner == nil)
    }

    @Test func withNothingLoadedAFailureIsFullScreen() async {
      stub.failing = ["/api/analytics", "/api/analytics/cashflow"]
      let s = store()
      await s.load(isPro: false)
      #expect(s.error == .server(status: 500, message: "Failed to compute analytics"))
      #expect(s.banner == nil)
      #expect(!s.hasData)
    }

    @Test func noServerIsNotConfigured() async {
      let s = AnalyticsStore { nil }
      await s.load(isPro: false)
      #expect(s.error == .notConfigured)
    }

    @Test func withDataShowingAFailureIsABannerAndTheDataStays() async {
      let s = store()
      await s.load(isPro: false)
      stub.failing = ["/api/analytics/cashflow"]
      await s.load(isPro: false)
      #expect(s.banner == "Failed to compute analytics")
      #expect(s.cashflow?.count == 1)
      #expect(s.error == nil)
    }

    @Test func aSpendingFailureInProIsABanner() async {
      let s = store()
      await s.load(isPro: false)
      stub.failing = ["/api/analytics/spending"]
      await s.load(isPro: true)
      #expect(s.banner == "Failed to compute analytics")
    }

    @Test func aSuccessfulLoadClearsTheBanner() async {
      let s = store()
      await s.load(isPro: false)
      s.banner = "Old"
      await s.load(isPro: false)
      #expect(s.banner == nil)
    }

    @Test func refreshClearsAStaleBannerBeforeItsCalls() async {
      let gate = Gate(Self.isAnalytics)
      let s = store(gates: [gate])
      s.banner = "Old"
      let task = Task { await s.refresh(isPro: false) }
      await gate.arrival()
      #expect(s.banner == nil)
      gate.open()
      await task.value
    }

    @Test func isLoadingIsTrueOnlyWhileALoadIsInFlight() async {
      let gate = Gate(Self.isAnalytics)
      let s = store(gates: [gate])
      #expect(!s.isLoading)
      let task = Task { await s.load(isPro: true) }
      await gate.arrival()
      #expect(s.isLoading)
      gate.open()
      await task.value
      #expect(!s.isLoading)
    }

    @Test func aFailedSpendingLoadEndsLoadingWithNoSpending() async {
      stub.failing = ["/api/analytics/spending"]
      let s = store()
      await s.load(isPro: true)
      #expect(!s.isLoading)
      #expect(s.spending == nil)
    }

    @Test func cancelledIsSilent() async {
      stub.cancel = true
      let s = store()
      await s.load(isPro: false)
      #expect(s.error == nil)
      #expect(s.banner == nil)
    }

    @Test func aStaleLoadIsDropped() async {
      let gate = Gate(Self.isAnalytics)
      let s = store(gates: [gate])
      stub.txCount = 1
      let first = Task { await s.load(isPro: false) }
      await gate.arrival()
      stub.txCount = 2
      await s.load(isPro: false)
      #expect(s.summary?.txCount == 2)
      stub.txCount = 1
      gate.open()
      await first.value
      #expect(s.summary?.txCount == 2, "the older load's answer must not win")
    }

    // MARK: Range

    @Test func changingTheRangeReloadsTheSummaryOnly() async {
      let s = store()
      await s.load(isPro: false)
      let before = StubURLProtocol.requests.count
      await s.changeRange(12)
      let sent = StubURLProtocol.requests.dropFirst(before)
      #expect(sent.map { $0.url?.path() } == ["/api/analytics"])
      #expect(TestData.query(of: sent.first!, "months") == "12")
      #expect(s.range == 12)
      #expect(!s.isLoadingSummary)
    }

    @Test func topMerchantsFollowTheSummary() async {
      let s = store()
      await s.load(isPro: false)
      #expect(s.topMerchants == [MerchantTotal(name: "Sample Mart", amount: 80, count: 4)])
      stub.txCount = 9
      await s.changeRange(12)
      #expect(s.topMerchants.map(\.count) == [9])
    }

    nonisolated static func isTwelveMonths(_ r: URLRequest) -> Bool {
      isAnalytics(r) && TestData.query(of: r, "months") == "12"
    }

    @Test func aLoadDuringARangeChangeEndsTheDimming() async {
      let gate = Gate(Self.isTwelveMonths)
      let s = store(gates: [gate])
      await s.load(isPro: false)
      let change = Task { await s.changeRange(12) }
      await gate.arrival()
      #expect(s.isLoadingSummary)
      await s.load(isPro: false)
      #expect(!s.isLoadingSummary)
      #expect(s.summary != nil)
      gate.open()
      await change.value
      #expect(!s.isLoadingSummary)
    }

    @Test func aFailedRangeChangeIsABanner() async {
      let s = store()
      await s.load(isPro: false)
      stub.failing = ["/api/analytics"]
      await s.changeRange(3)
      #expect(s.banner == "Failed to compute analytics")
      #expect(s.summary != nil)
    }

    // MARK: Limit

    @Test func savingTheLimitSendsExactlyTheKeyAndANumber() async throws {
      let s = store()
      await s.saveLimit(2500, current: 3000)
      #expect(s.limitOverride == 2500)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "PUT")
      #expect(request.url?.path() == "/api/ui-state")
      let body = try #require(StubURLProtocol.body(of: request))
      let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
      #expect(json.count == 2)
      #expect(json["key"] as? String == "spendingMonthlyLimit")
      #expect(!(json["value"] is String))
      #expect((json["value"] as? NSNumber)?.doubleValue == 2500)
    }

    @Test func anUnchangedLimitSendsNothing() async {
      let s = store()
      await s.saveLimit(3000, current: 3000)
      #expect(StubURLProtocol.requests.isEmpty)
      #expect(s.limitOverride == nil)
    }

    @Test func aNegativeLimitIsSavedAsZero() async throws {
      let s = store()
      await s.saveLimit(-50, current: 3000)
      #expect(s.limitOverride == 0)
      let request = try #require(StubURLProtocol.requests.first)
      let body = try #require(StubURLProtocol.body(of: request))
      let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
      #expect((json["value"] as? NSNumber)?.doubleValue == 0)
    }

    @Test func aFailedSaveKeepsTheValueAndShowsABanner() async {
      stub.failing = ["/api/ui-state"]
      let s = store()
      await s.saveLimit(2000, current: 3000)
      #expect(s.limitOverride == 2000)
      #expect(s.banner == "Couldn't save the limit to the server.")
    }

    @Test func aLoadDuringASaveDoesNotOverwriteTheLimit() async {
      stub.limit = "100"
      let put = Gate(Self.isPUT)
      let s = store(gates: [put])
      let save = Task { await s.saveLimit(2000, current: 3000) }
      await put.arrival()
      await s.load(isPro: true)
      #expect(s.limitOverride == 2000)
      put.open()
      await save.value
    }
  }
}
