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
