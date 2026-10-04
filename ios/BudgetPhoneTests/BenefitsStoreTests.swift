import Foundation
import Testing
@testable import BudgetPhone

final class BenefitsStub: @unchecked Sendable {
  var fail = false
  var cancel = false
  var last4 = "0001"
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct BenefitsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let stub = BenefitsStub()

    nonisolated static func answer(_ r: URLRequest, _ stub: BenefitsStub) throws -> (Int, Data) {
      if stub.cancel { throw URLError(.cancelled) }
      if stub.fail { return (500, Data(#"{"error":"Failed to load cards"}"#.utf8)) }
      return (200, Data(#"{"cards":[\#(TestData.cardJSON(id: "c1", last4: stub.last4))]}"#.utf8))
    }

    func store(gates: [Gate] = []) -> BenefitsStore {
      let stub = self.stub
      let c = APIClient(baseURL: base, session: StubURLProtocol.session({ try Self.answer($0, stub) }, gates: gates))
      return BenefitsStore { c }
    }

    nonisolated static func any(_ r: URLRequest) -> Bool { true }

    @Test func loads() async {
      let s = store()
      await s.load()
      #expect(s.cards?.map(\.id) == ["c1"])
      #expect(s.error == nil && s.banner == nil && !s.isLoading)
    }

    @Test func withNothingLoadedAFailureIsFullScreen() async {
      stub.fail = true
      let s = store()
      await s.load()
      #expect(s.error == .server(status: 500, message: "Failed to load cards"))
      #expect(s.banner == nil)
    }

    @Test func noServerIsNotConfigured() async {
      let s = BenefitsStore { nil }
      await s.load()
      #expect(s.error == .notConfigured)
    }

    @Test func withDataAFailureIsABannerAndTheDataStays() async {
      let s = store()
      await s.load()
      stub.fail = true
      await s.load()
      #expect(s.banner == "Failed to load cards")
      #expect(s.cards != nil && s.error == nil)
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
      let gate = Gate(Self.any)
      let s = store(gates: [gate])
      stub.last4 = "1111"
      let first = Task { await s.load() }
      await gate.arrival()
      stub.last4 = "2222"
      await s.load()
      #expect(s.cards?.first?.last4 == "2222")
      stub.last4 = "1111"
      gate.open()
      await first.value
      #expect(s.cards?.first?.last4 == "2222")
    }

    @Test func artURLUsesTheCurrentServer() {
      #expect(store().artURL("/api/card-art/c1.png")?.absoluteString
        == "http://budget-mac.local:3000/api/card-art/c1.png")
      #expect(BenefitsStore { nil }.artURL("/api/card-art/c1.png") == nil)
    }
  }
}

/// What a launch shows before the server answers: the cards saved last time,
/// with their faces requested at once.
extension StubbedNetworkTests.BenefitsStoreTests {
  func store(
    cache: ResponseCache, token: String = "sample-token", gates: [Gate] = [],
    unreachable: Bool = false, art: CardArtCache? = nil
  ) -> BenefitsStore {
    let stub = self.stub
    let session = StubURLProtocol.session(
      { r in
        if unreachable { throw URLError(.cannotConnectToHost) }
        return try Self.answer(r, stub)
      }, gates: gates)
    let c = APIClient(baseURL: base, session: session, token: token, cache: cache)
    let art = art ?? CardArtCache(
      session: session, directory: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString),
      token: { nil })
    return BenefitsStore(client: { c }, art: art)
  }

  /// One card, c1 ending 0001 with a face, saved for `token`.
  func saveCards(in cache: ResponseCache, token: String = "sample-token") async throws {
    let body = Data(
      #"{"cards":[\#(TestData.cardJSON(id: "c1", artUrl: "/api/card-art/c1.png"))]}"#.utf8)
    let c = APIClient(
      baseURL: base, session: StubURLProtocol.session { _ in (200, body) }, token: token,
      cache: cache)
    _ = try await c.userCards()
  }

  @Test func savedCardsShowWhenTheServerIsUnreachableAndTheirFacesAreFetched() async throws {
    let cache = TestData.cache()
    try await saveCards(in: cache)
    let art = CardArtCache(
      session: StubURLProtocol.session { _ in throw URLError(.cannotConnectToHost) },
      directory: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString),
      token: { nil })
    let s = store(cache: cache, unreachable: true, art: art)
    await s.load()
    await art.settle()
    #expect(s.cards?.map(\.last4) == ["0001"])
    #expect(s.error == nil)
    #expect(s.banner != nil)
    #expect(StubURLProtocol.requests.contains { $0.url?.path() == "/api/card-art/c1.png" })
  }

  @Test func savedCardsShowWhileLoadingThenTheServersAnswerReplacesThem() async throws {
    let cache = TestData.cache()
    try await saveCards(in: cache)
    stub.last4 = "2222"
    // Not `any`: the saved card's face is fetched alongside.
    let gate = Gate { $0.url?.path() == "/api/user-cards" }
    let s = store(cache: cache, gates: [gate])
    let load = Task { await s.load() }
    await gate.arrival()
    #expect(s.cards?.map(\.last4) == ["0001"])
    #expect(s.isLoading)
    gate.open()
    await load.value
    #expect(s.cards?.map(\.last4) == ["2222"])
    #expect(s.error == nil && s.banner == nil)
  }

  @Test func withNothingSavedAFailureIsStillFullScreen() async {
    let s = store(cache: TestData.cache(), unreachable: true)
    await s.load()
    #expect(s.cards == nil)
    guard case .unreachable = s.error else {
      Issue.record("expected .unreachable, got \(String(describing: s.error))")
      return
    }
    #expect(s.banner == nil)
  }

  @Test func cardsSavedUnderAnotherTokenAreNotShown() async throws {
    let cache = TestData.cache()
    try await saveCards(in: cache, token: "other-token")
    let s = store(cache: cache, unreachable: true)
    await s.load()
    #expect(s.cards == nil)
    #expect(s.error != nil)
  }
}
