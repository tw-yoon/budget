import Foundation
import Testing
@testable import BudgetPhone

final class CardWritesStub: @unchecked Sendable {
  var failWrites = false
  var cancelWrites = false
  var ids = ["c1", "c2"]
}

extension StubbedNetworkTests {
  /// BenefitsStore's writes: method, path and body of each, the reload after
  /// success, and the failure rules.
  @Suite(.serialized)
  @MainActor
  struct CardWritesTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let stub = CardWritesStub()

    nonisolated static func answer(_ r: URLRequest, _ stub: CardWritesStub) throws -> (Int, Data) {
      if r.httpMethod == "GET" {
        let cards = stub.ids.map { TestData.cardJSON(id: $0, last4: "000\($0.suffix(1))") }
        return (200, Data(#"{"cards":[\#(cards.joined(separator: ","))]}"#.utf8))
      }
      if stub.cancelWrites { throw URLError(.cancelled) }
      if stub.failWrites { return (400, Data(#"{"error":"Sample failure"}"#.utf8)) }
      return (200, Data(#"{"ok":true}"#.utf8))
    }

    func store() async -> BenefitsStore {
      let stub = self.stub
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { try Self.answer($0, stub) })
      let s = BenefitsStore { c }
      await s.load()
      return s
    }

    /// The writes sent, in order (GETs left out).
    func writes() -> [URLRequest] { StubURLProtocol.requests.filter { $0.httpMethod != "GET" } }

    func body(_ r: URLRequest) throws -> [String: Any] {
      let data = try #require(StubURLProtocol.body(of: r))
      return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func gets() -> Int { StubURLProtocol.requests.filter { $0.httpMethod == "GET" }.count }

    @Test func eachWriteHitsItsRoute() async throws {
      let s = await store()
      let cases: [(CardWrite, String, String)] = [
        (.addCard(.preset(slug: "amex-gold", last4: "0001", startYear: 2024, startMonth: nil)), "POST", "/api/user-cards"),
        (.updateCard(id: "c1", UserCardPatch(annualFee: .set(95))), "PATCH", "/api/user-cards/c1"),
        (.deleteCard(id: "c1"), "DELETE", "/api/user-cards/c1"),
        (.saveRate(NewRewardRate(userCardId: "c1", category: "GAS", multiplier: 3, unit: "X")), "POST", "/api/rewards"),
        (.deleteRate(id: "r1"), "DELETE", "/api/rewards/r1"),
        (.addBenefit(NewBenefit(userCardId: "c1", name: "Sample", amount: 5, period: "ANNUAL", category: nil)), "POST", "/api/benefits"),
        (.updateBenefit(id: "b1", .perkActive(false)), "PATCH", "/api/benefits/b1"),
        (.deleteBenefit(id: "b1"), "DELETE", "/api/benefits/b1"),
      ]
      for (write, method, path) in cases {
        try await s.perform(write)
        let r = try #require(writes().last)
        #expect(r.httpMethod == method)
        #expect(r.url?.path() == path)
      }
      #expect(writes().count == cases.count)
      // Every write reloads: one GET each, after the first load.
      #expect(gets() == cases.count + 1)
    }

    @Test func bodiesAreExactlyWhatTheRoutesExpect() async throws {
      let s = await store()
      try await s.perform(.updateCard(id: "c1", UserCardPatch(membershipStartMonth: .clear)))
      let patch = try body(#require(writes().last))
      #expect(Set(patch.keys) == ["membershipStartMonth"] && patch["membershipStartMonth"] is NSNull)

      try await s.perform(.updateBenefit(id: "b1", .window(key: "2026-03", value: 0)))
      let window = try body(#require(writes().last))
      #expect(window["periodKey"] as? String == "2026-03" && window["value"] as? Double == 0)

      try await s.perform(.addCard(.custom(issuer: "AMEX", name: nil, last4: "0003", startYear: 2025, startMonth: 4)))
      let add = try body(#require(writes().last))
      #expect(add["issuer"] as? String == "AMEX" && add["name"] is NSNull && add["membershipStartMonth"] as? Int == 4)
      #expect(writes().last?.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }

    @Test func anEmptyCardPatchSendsNothing() async throws {
      let s = await store()
      try await s.perform(.updateCard(id: "c1", UserCardPatch()))
      #expect(writes().isEmpty)
    }

    @Test func aFailedWriteThrowsTheServerMessageAndKeepsTheData() async {
      let s = await store()
      stub.failWrites = true
      await #expect(throws: APIError.server(status: 400, message: "Sample failure")) {
        try await s.perform(.deleteRate(id: "r1"))
      }
      #expect(s.cards?.map(\.id) == ["c1", "c2"])
      #expect(s.error == nil && !s.isSaving)
    }

    @Test func aWriteClearsAStaleBannerFirst() async throws {
      let s = await store()
      s.banner = "Old"
      stub.failWrites = true
      _ = try? await s.perform(.deleteRate(id: "r1"))
      #expect(s.banner == nil)
    }

    nonisolated static func isWrite(_ r: URLRequest) -> Bool { r.httpMethod != "GET" }

    @Test func aWriteDuringAnotherSaysSoInsteadOfDroppingIt() async {
      let stub = self.stub
      let gate = Gate(Self.isWrite)
      let c = APIClient(
        baseURL: base, session: StubURLProtocol.session({ try Self.answer($0, stub) }, gates: [gate]))
      let s = BenefitsStore { c }
      await s.load()
      let first = Task { try? await s.perform(.deleteCard(id: "c1")) }
      await gate.arrival()
      do throws(APIError) {
        try await s.perform(.deleteRate(id: "r1"))
        Issue.record("the second write should throw")
      } catch {
        #expect(error == .server(status: 0, message: BenefitsStore.stillSaving))
      }
      gate.open()
      await first.value
      #expect(writes().count == 1)
    }

    @Test func noServerThrowsNotConfigured() async {
      let s = BenefitsStore { nil }
      await #expect(throws: APIError.notConfigured) { try await s.perform(.deleteRate(id: "r1")) }
    }

    @Test func removeIsOptimisticThenReloads() async throws {
      let s = await store()
      stub.ids = ["c2"]
      await s.remove(try #require(s.card(id: "c1")))
      let r = try #require(writes().last)
      #expect(r.httpMethod == "DELETE" && r.url?.path() == "/api/user-cards/c1")
      #expect(s.cards?.map(\.id) == ["c2"] && s.banner == nil)
    }

    @Test func aFailedRemoveBringsTheRowBackWithABanner() async throws {
      let s = await store()
      stub.failWrites = true
      await s.remove(try #require(s.card(id: "c1")))
      #expect(s.cards?.map(\.id) == ["c1", "c2"])
      #expect(s.banner == "Couldn't remove Amex ··0001.")
    }

    @Test func aCancelledRemoveIsSilent() async throws {
      let s = await store()
      stub.cancelWrites = true
      await s.remove(try #require(s.card(id: "c1")))
      #expect(s.banner == nil)
    }

    @Test func moveSendsEveryIdInTheNewOrder() async throws {
      let s = await store()
      await s.move(from: [1], to: 0)
      #expect(s.cards?.map(\.id) == ["c2", "c1"])
      let r = try #require(writes().last)
      #expect(r.httpMethod == "POST" && r.url?.path() == "/api/user-cards/reorder")
      #expect(try body(r)["ids"] as? [String] == ["c2", "c1"])
    }

    @Test func aMoveToTheSamePlaceSendsNothing() async {
      let s = await store()
      await s.move(from: [0], to: 0)
      #expect(writes().isEmpty)
    }

    @Test func aFailedMoveReloadsTheSavedOrderWithABanner() async {
      let s = await store()
      stub.failWrites = true
      await s.move(from: [1], to: 0)
      #expect(s.cards?.map(\.id) == ["c1", "c2"])
      #expect(s.banner == "Couldn't save the new order.")
    }
  }
}
