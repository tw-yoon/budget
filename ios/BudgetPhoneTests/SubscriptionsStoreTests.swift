import Foundation
import Testing
@testable import BudgetPhone

/// Answers the stub handler reads at response time.
final class SubscriptionsStub: @unchecked Sendable {
  var failing: Set<String> = []  // "METHOD /path"
  var detect = #"{"found":2,"errors":[]}"#
  var name = "Sample Stream"
  var cancel = false
  var deleted = false  // set by the DELETE route; GET then omits s1
  var armed = false  // lets a gate skip the setup load
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct SubscriptionsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let stub = SubscriptionsStub()

    nonisolated static func answer(_ r: URLRequest, _ stub: SubscriptionsStub) throws -> (Int, Data) {
      if stub.cancel { throw URLError(.cancelled) }
      let key = "\(r.httpMethod ?? "") \(r.url!.path())"
      if stub.failing.contains(key) {
        let message = r.httpMethod == "POST" && r.url!.path() == "/api/subscriptions"
          ? "Amount must be a positive number" : "Failed to load subscriptions"
        return (r.httpMethod == "POST" && r.url!.path() == "/api/subscriptions" ? 400 : 500,
                Data(#"{"error":"\#(message)"}"#.utf8))
      }
      switch key {
      case "GET /api/subscriptions":
        let s1 = #"{"id":"s1","name":"\#(stub.name)","amount":10,"cadence":"MONTHLY","cadenceLabel":"Monthly","monthlyCost":10,"nextDate":null,"merchantName":null,"accountName":null,"source":"MANUAL","isActive":true},"#
        let s2 = #"{"id":"s2","name":"Example Music","amount":5,"cadence":"MONTHLY","cadenceLabel":"Monthly","monthlyCost":5,"nextDate":null,"merchantName":null,"accountName":null,"source":"AUTO","isActive":true}"#
        return (200, Data(#"{"subscriptions":[\#(stub.deleted ? "" : s1)\#(s2)],"monthlyTotal":15}"#.utf8))
      case "POST /api/subscriptions/detect": return (200, Data(stub.detect.utf8))
      case "POST /api/subscriptions": return (200, Data(#"{"id":"s3"}"#.utf8))
      case "DELETE /api/subscriptions/s1":
        stub.deleted = true
        return (200, Data(#"{"ok":true}"#.utf8))
      default: return (404, Data())
      }
    }

    func store(gates: [Gate] = []) -> SubscriptionsStore {
      let stub = self.stub
      let c = APIClient(baseURL: base, session: StubURLProtocol.session({ try Self.answer($0, stub) }, gates: gates))
      return SubscriptionsStore { c }
    }

    func sent() -> [String] { StubURLProtocol.requests.map { "\($0.httpMethod ?? "") \($0.url!.path())" } }

    nonisolated static func isGET(_ r: URLRequest) -> Bool { r.httpMethod == "GET" }
    nonisolated static func isDetect(_ r: URLRequest) -> Bool { r.url?.path() == "/api/subscriptions/detect" }
    nonisolated static func isDelete(_ r: URLRequest) -> Bool { r.httpMethod == "DELETE" }

    // MARK: Load

    @Test func loads() async {
      let s = store()
      await s.load()
      #expect(s.data?.subscriptions.count == 2)
      #expect(s.error == nil && s.banner == nil)
    }

    @Test func withNothingLoadedAFailureIsFullScreen() async {
      stub.failing = ["GET /api/subscriptions"]
      let s = store()
      await s.load()
      #expect(s.error == .server(status: 500, message: "Failed to load subscriptions"))
      #expect(s.banner == nil)
    }

    @Test func noServerIsNotConfigured() async {
      let s = SubscriptionsStore { nil }
      await s.load()
      #expect(s.error == .notConfigured)
    }

    @Test func withDataAFailureIsABannerAndTheDataStays() async {
      let s = store()
      await s.load()
      stub.failing = ["GET /api/subscriptions"]
      await s.load()
      #expect(s.banner == "Failed to load subscriptions")
      #expect(s.data != nil)
      #expect(s.error == nil)
    }

    @Test func aSuccessfulLoadClearsTheBanner() async {
      let s = store()
      await s.load()
      s.banner = "Old"
      await s.load()
      #expect(s.banner == nil)
    }

    @Test func cancelledIsSilent() async {
      stub.cancel = true
      let s = store()
      await s.load()
      #expect(s.error == nil && s.banner == nil)
    }

    @Test func aStaleLoadIsDropped() async {
      let gate = Gate(Self.isGET)
      let s = store(gates: [gate])
      stub.name = "Old Name"
      let first = Task { await s.load() }
      await gate.arrival()
      stub.name = "New Name"
      await s.load()
      #expect(s.data?.subscriptions.first?.name == "New Name")
      stub.name = "Old Name"
      gate.open()
      await first.value
      #expect(s.data?.subscriptions.first?.name == "New Name")
    }

    // MARK: Detect

    @Test func detectPostsThenReloadsAndShowsTheNotice() async {
      let s = store()
      await s.detect()
      #expect(sent() == ["POST /api/subscriptions/detect", "GET /api/subscriptions"])
      #expect(s.notice == "Found 2 recurring charges.")
      #expect(!s.isDetecting)
    }

    @Test func detectClearsStaleMessagesBeforeItsCall() async {
      let gate = Gate(Self.isDetect)
      let s = store(gates: [gate])
      s.banner = "Old"
      s.notice = "Old notice"
      let task = Task { await s.detect() }
      await gate.arrival()
      #expect(s.banner == nil && s.notice == nil)
      #expect(s.isDetecting)
      gate.open()
      await task.value
    }

    @Test func aSecondDetectWhileOneRunsSendsNothing() async {
      let gate = Gate(Self.isDetect)
      let s = store(gates: [gate])
      let first = Task { await s.detect() }
      await gate.arrival()
      await s.detect()
      #expect(sent() == ["POST /api/subscriptions/detect"])
      gate.open()
      await first.value
    }

    @Test func aFailedDetectIsABannerThatSurvivesTheReload() async {
      stub.failing = ["POST /api/subscriptions/detect"]
      let s = store()
      await s.detect()
      #expect(s.banner == "Failed to load subscriptions")
      #expect(s.notice == nil)
      #expect(s.data != nil, "the list still reloads")
    }

    // MARK: Add

    @Test func addPostsThenReloads() async throws {
      let s = store()
      try await s.add(NewSubscription(name: "Sample Stream", amount: 10, cadence: "MONTHLY", nextDate: nil))
      #expect(sent() == ["POST /api/subscriptions", "GET /api/subscriptions"])
    }

    @Test func aRejectedAddThrowsTheServersMessageAndDoesNotReload() async {
      stub.failing = ["POST /api/subscriptions"]
      let s = store()
      await #expect(throws: APIError.server(status: 400, message: "Amount must be a positive number")) {
        try await s.add(NewSubscription(name: "Sample Stream", amount: 10, cadence: "MONTHLY", nextDate: nil))
      }
      #expect(sent() == ["POST /api/subscriptions"])
    }

    // MARK: Delete

    @Test func deleteRemovesTheRowAtOnce() async throws {
      let gate = Gate(Self.isDelete)
      let s = store(gates: [gate])
      await s.load()
      let row = try #require(s.data?.subscriptions.first)
      let task = Task { await s.delete(row) }
      await gate.arrival()
      #expect(s.data?.subscriptions.map(\.id) == ["s2"])
      gate.open()
      await task.value
      #expect(sent().contains("DELETE /api/subscriptions/s1"))
      #expect(sent().last == "GET /api/subscriptions")
    }

    @Test func deleteDropsALoadStartedBeforeIt() async throws {
      let stub = self.stub
      let loadGate = Gate { Self.isGET($0) && stub.armed }
      let deleteGate = Gate(Self.isDelete)
      let s = store(gates: [loadGate, deleteGate])
      await s.load()
      let row = try #require(s.data?.subscriptions.first)
      stub.armed = true
      let load = Task { await s.load() }
      await loadGate.arrival()
      let delete = Task { await s.delete(row) }
      await deleteGate.arrival()
      #expect(s.data?.subscriptions.map(\.id) == ["s2"])
      // The held GET answers now, still listing s1, and must not be applied.
      loadGate.open()
      await load.value
      #expect(s.data?.subscriptions.map(\.id) == ["s2"])
      deleteGate.open()
      await delete.value
      #expect(s.data?.subscriptions.map(\.id) == ["s2"])
    }

    @Test func aFailedDeleteBringsTheRowBackWithABanner() async throws {
      let s = store()
      await s.load()
      stub.failing = ["DELETE /api/subscriptions/s1"]
      let row = try #require(s.data?.subscriptions.first)
      await s.delete(row)
      #expect(s.data?.subscriptions.map(\.id) == ["s1", "s2"])
      #expect(s.banner == "Couldn't delete Sample Stream.")
    }
  }
}

/// What a launch shows before the server answers: the list saved last time.
extension StubbedNetworkTests.SubscriptionsStoreTests {
  func store(
    cache: ResponseCache, token: String = "sample-token", gates: [Gate] = [],
    unreachable: Bool = false
  ) -> SubscriptionsStore {
    let stub = self.stub
    let c = APIClient(
      baseURL: base,
      session: StubURLProtocol.session(
        { r in
          if unreachable { throw URLError(.cannotConnectToHost) }
          return try Self.answer(r, stub)
        }, gates: gates),
      token: token, cache: cache)
    return SubscriptionsStore { c }
  }

  /// The list with s1 named "Sample Stream", saved for `token`.
  func saveSubscriptions(in cache: ResponseCache, token: String = "sample-token") async {
    await store(cache: cache, token: token).load()
  }

  @Test func savedSubscriptionsShowWhenTheServerIsUnreachable() async {
    let cache = TestData.cache()
    await saveSubscriptions(in: cache)
    let s = store(cache: cache, unreachable: true)
    await s.load()
    #expect(s.data?.subscriptions.map(\.name) == ["Sample Stream", "Example Music"])
    #expect(s.error == nil)
    #expect(s.banner != nil)
  }

  @Test func savedSubscriptionsShowWhileLoadingThenTheServersAnswerReplacesThem() async {
    let cache = TestData.cache()
    await saveSubscriptions(in: cache)
    stub.name = "Example Video"
    let gate = Gate(Self.isGET)
    let s = store(cache: cache, gates: [gate])
    let load = Task { await s.load() }
    await gate.arrival()
    #expect(s.data?.subscriptions.first?.name == "Sample Stream")
    #expect(s.isLoading)
    gate.open()
    await load.value
    #expect(s.data?.subscriptions.first?.name == "Example Video")
    #expect(s.error == nil && s.banner == nil)
  }

  @Test func withNothingSavedAFailureIsStillFullScreen() async {
    let s = store(cache: TestData.cache(), unreachable: true)
    await s.load()
    #expect(s.data == nil)
    guard case .unreachable = s.error else {
      Issue.record("expected .unreachable, got \(String(describing: s.error))")
      return
    }
    #expect(s.banner == nil)
  }

  @Test func subscriptionsSavedUnderAnotherTokenAreNotShown() async {
    let cache = TestData.cache()
    await saveSubscriptions(in: cache, token: "other-token")
    let s = store(cache: cache, unreachable: true)
    await s.load()
    #expect(s.data == nil)
    #expect(s.error != nil)
  }
}
