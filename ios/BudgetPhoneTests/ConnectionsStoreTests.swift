import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Connections: the store's failure rules and its writes.
  @Suite(.serialized)
  @MainActor
  struct ConnectionsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func store(
      gates: [Gate] = [], _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> ConnectionsStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler, gates: gates))
      return ConnectionsStore { c }
    }

    nonisolated static func fixture() -> (Int, Data) { (200, (try? TestData.fixture("connections")) ?? Data()) }
    nonisolated static let fail: (Int, Data) = (500, Data(#"{"error":"Failed to load accounts"}"#.utf8))
    nonisolated static func isWrite(_ r: URLRequest) -> Bool { r.httpMethod != "GET" }

    nonisolated static func answering(_ write: (Int, Data)) -> (URLRequest) -> (Int, Data) {
      { r in r.httpMethod == "GET" ? fixture() : write }
    }

    func methods() -> [String] { StubURLProtocol.requests.compactMap(\.httpMethod) }

    @Test func aFirstLoadFailureIsFullScreen() async {
      let s = store { _ in Self.fail }
      await s.load()
      #expect(s.data == nil)
      #expect(s.error == .server(status: 500, message: "Failed to load accounts"))
    }

    @Test func aFailureOverDataIsABannerAndTheDataStays() async {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let s = store { _ in
        count.n += 1
        return count.n == 1 ? Self.fixture() : Self.fail
      }
      await s.load()
      await s.load()
      #expect(s.data?.banks.count == 2)
      #expect(s.error == nil)
      #expect(s.banner == "Failed to load accounts")
    }

    @Test func aSuccessfulLoadClearsTheBanner() async {
      let s = store { _ in Self.fixture() }
      s.banner = "old"
      await s.load()
      #expect(s.banner == nil)
    }

    @Test func aCancelledLoadIsSilent() async {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let s = store { _ in
        count.n += 1
        if count.n == 1 { return Self.fixture() }
        throw URLError(.cancelled)
      }
      await s.load()
      await s.load()
      #expect(s.banner == nil)
      #expect(s.error == nil)
    }

    @Test func aRemovalReloads() async {
      let s = store(Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      s.banner = "stale"
      await s.perform(.removeCard(id: "d1"))
      #expect(methods() == ["GET", "DELETE", "GET"])
      #expect(s.banner == nil)
    }

    @Test func aFailedDisconnectShowsTheServerMessageWithoutReloading() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to disconnect bank"}"#.utf8))))
      await s.load()
      await s.perform(.disconnect(itemId: "item-sample-abc123"))
      #expect(s.banner == "Failed to disconnect bank")
      #expect(methods() == ["GET", "DELETE"])
      #expect(!s.isSaving)
    }

    @Test func aWriteClearsAStaleBannerBeforeItsRequest() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      s.banner = "stale"
      let running = Task { await s.perform(.removeCard(id: "d1")) }
      await write.arrival()
      #expect(s.banner == nil)
      #expect(s.isSaving)
      write.open()
      await running.value
      #expect(!s.isSaving)
    }

    @Test func aSecondWriteWhileOneIsInFlightSendsNothing() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      let first = Task { await s.perform(.removeCard(id: "d1")) }
      await write.arrival()
      await s.perform(.disconnect(itemId: "item-sample-abc123"))
      write.open()
      await first.value
      #expect(methods().filter { $0 == "DELETE" }.count == 1)
    }

    @Test func aCancelledWriteIsSilent() async {
      let s = store { r in
        if r.httpMethod == "GET" { return Self.fixture() }
        throw URLError(.cancelled)
      }
      await s.load()
      s.banner = "stale"
      await s.perform(.disconnect(itemId: "item-sample-abc123"))
      #expect(s.banner == nil)
      #expect(methods() == ["GET", "DELETE"])
    }

    @Test func onlyASuccessfulDisconnectCountsAsAnAccountsChange() async {
      let s = store(Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      await s.perform(.removeCard(id: "d1"))
      #expect(s.disconnectCount == 0)
      await s.perform(.disconnect(itemId: "item-sample-abc123"))
      #expect(s.disconnectCount == 1)
      let failing = store(Self.answering((500, Data(#"{"error":"Failed to disconnect bank"}"#.utf8))))
      await failing.load()
      await failing.perform(.disconnect(itemId: "item-sample-abc123"))
      #expect(failing.disconnectCount == 0)
    }

    @Test func aDisconnectMarksItsBankWhileInFlight() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      #expect(s.disconnectingItemId == nil)
      let running = Task { await s.perform(.disconnect(itemId: "item-sample-abc123")) }
      await write.arrival()
      #expect(s.disconnectingItemId == "item-sample-abc123")
      write.open()
      await running.value
      #expect(s.disconnectingItemId == nil)
    }

    @Test func deleteHistoryCallsTheHistoryRouteReloadsAndCountsAsAChange() async {
      let s = store(Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      s.banner = "stale"
      await s.perform(.deleteHistory(itemId: "item-sample-zzz999"))
      #expect(s.banner == nil)
      #expect(methods() == ["GET", "DELETE", "GET"])
      #expect(StubURLProtocol.requests[1].url?.path() == "/api/plaid/items/item-sample-zzz999/history")
      #expect(s.disconnectCount == 1)
    }

    @Test func aFailedDeleteHistoryShowsTheMessageAndChangesNothing() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to delete bank history"}"#.utf8))))
      await s.load()
      await s.perform(.deleteHistory(itemId: "item-sample-abc123"))
      #expect(s.banner == "Failed to delete bank history")
      #expect(s.disconnectCount == 0)
      #expect(methods() == ["GET", "DELETE"])
    }

    @Test func aDeleteMarksItsBankWhileInFlight() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      let running = Task { await s.perform(.deleteHistory(itemId: "item-sample-abc123")) }
      await write.arrival()
      #expect(s.disconnectingItemId == "item-sample-abc123")
      write.open()
      await running.value
      #expect(s.disconnectingItemId == nil)
    }

    @Test func addClearsAStaleBannerAndThrowsTheServerMessage() async {
      let s = store(Self.answering((400, Data(#"{"error":"Card name is required"}"#.utf8))))
      await s.load()
      s.banner = "stale"
      await #expect(throws: APIError.server(status: 400, message: "Card name is required")) {
        try await s.add(NewDebitCard(name: "", last4: "0002", accountId: "a1"))
      }
      #expect(s.banner == nil)
      #expect(methods() == ["GET", "POST"])
    }

    @Test func addReloadsOnSuccess() async throws {
      let s = store(Self.answering((200, Data(#"{"id":"d9"}"#.utf8))))
      await s.load()
      try await s.add(NewDebitCard(name: "Sample Debit", last4: "0002", accountId: "a1"))
      #expect(methods() == ["GET", "POST", "GET"])
    }
  }
}
