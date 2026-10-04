import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Categories: the store's failure rules and its writes.
  @Suite(.serialized)
  @MainActor
  struct CategoriesStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func store(
      gates: [Gate] = [], _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> CategoriesStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler, gates: gates))
      return CategoriesStore { c }
    }

    nonisolated static func fixture() -> (Int, Data) { (200, (try? TestData.fixture("categories-admin")) ?? Data()) }
    nonisolated static let fail: (Int, Data) = (500, Data(#"{"error":"Failed to load categories"}"#.utf8))
    nonisolated static func isGET(_ r: URLRequest) -> Bool { r.httpMethod == "GET" }
    nonisolated static func isWrite(_ r: URLRequest) -> Bool { r.httpMethod != "GET" }

    /// Answers GETs with the fixture and writes with `write`.
    nonisolated static func answering(_ write: (Int, Data)) -> (URLRequest) -> (Int, Data) {
      { r in r.httpMethod == "GET" ? fixture() : write }
    }

    func methods() -> [String] { StubURLProtocol.requests.compactMap(\.httpMethod) }

    // MARK: Loading

    @Test func aFirstLoadFailureIsFullScreen() async {
      let s = store { _ in Self.fail }
      await s.load()
      #expect(s.data == nil)
      #expect(s.error == .server(status: 500, message: "Failed to load categories"))
      #expect(s.banner == nil)
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
      #expect(s.data != nil)
      #expect(s.error == nil)
      #expect(s.banner == "Failed to load categories")
      #expect(s.category(id: "c1")?.name == "Sample Groceries")
    }

    @Test func aCancelledLoadOverDataIsSilent() async {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let s = store { _ in
        count.n += 1
        if count.n == 1 { return Self.fixture() }
        throw URLError(.cancelled)
      }
      await s.load()
      await s.load()
      #expect(s.data != nil)
      #expect(s.banner == nil)
      #expect(s.error == nil)
    }

    @Test func aCancelledWriteIsSilent() async {
      let s = store { r in
        if r.httpMethod == "GET" { return Self.fixture() }
        throw URLError(.cancelled)
      }
      await s.load()
      await s.perform(.create(name: "Sample Pets"))
      #expect(s.banner == nil)
      #expect(s.notice == nil)
      #expect(s.writeCount == 0)
    }

    @Test func aSuccessfulLoadClearsTheBanner() async {
      let s = store { _ in Self.fixture() }
      s.banner = "old"
      await s.load()
      #expect(s.banner == nil)
    }

    @Test func anOlderLoadFinishingLastIsIgnored() async {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let first = Gate(Self.isGET)
      let s = store(gates: [first]) { _ in
        count.n += 1
        return count.n == 1 ? Self.fixture() : Self.fail  // the held, older load answers last
      }
      let older = Task { await s.load() }
      await first.arrival()
      await s.load()
      first.open()
      await older.value
      #expect(s.data != nil)
      #expect(s.banner == nil, "the stale failure must not show")
    }

    // MARK: Writes

    @Test func aRenameShowsTheWebsNoticeAfterItsReload() async {
      let s = store(Self.answering(
        (200, Data(#"{"ok":true,"merged":false,"movedTransactions":3,"movedRules":0,"movedResolved":3,"movedSplits":0}"#.utf8))))
      await s.load()
      let prompt = await s.perform(.rename(id: "c1", name: "Sample Food", allowMerge: false))
      #expect(prompt == nil)
      #expect(s.notice == "Renamed \u{2014} 3 transaction(s) updated.")
      #expect(s.writeCount == 1)
      #expect(methods() == ["GET", "PATCH", "GET"])
    }

    @Test func aMergePromptIsReturnedWithoutReloading() async {
      let json = #"{"error":"x","merge":true,"targetName":"Example Dining","movingTransactions":2,"movingRules":1,"movingResolved":6,"movingSplits":0}"#
      let s = store(Self.answering((409, Data(json.utf8))))
      await s.load()
      let prompt = await s.perform(.rename(id: "c1", name: "Example Dining", allowMerge: false))
      #expect(prompt?.targetName == "Example Dining")
      #expect(s.writeCount == 0)
      #expect(s.banner == nil)
      #expect(!s.isSaving)
      #expect(methods() == ["GET", "PATCH"])
    }

    @Test func aFailedWriteIsABanner() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to create category"}"#.utf8))))
      await s.load()
      await s.perform(.create(name: "Sample Pets"))
      #expect(s.banner == "Failed to create category")
      #expect(s.notice == nil)
      #expect(s.writeCount == 0)
      #expect(methods() == ["GET", "POST"], "a failed write doesn't reload")
    }

    @Test func aWriteClearsStaleMessagesBeforeItsRequest() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      s.banner = "stale"
      s.notice = "stale"
      let running = Task { await s.perform(.createSub(categoryId: "c1", name: "Treats")) }
      await write.arrival()
      #expect(s.banner == nil)
      #expect(s.notice == nil)
      #expect(s.isSaving)
      write.open()
      await running.value
      #expect(!s.isSaving)
    }

    @Test func aSecondWriteWhileOneIsInFlightSendsNothing() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"ok":true}"#.utf8))))
      await s.load()
      let first = Task { await s.perform(.delete(id: "c1")) }
      await write.arrival()
      await s.perform(.delete(id: "c1"))
      write.open()
      await first.value
      #expect(methods().filter { $0 == "DELETE" }.count == 1)
    }

    @Test func deletingASubNamesItsCategoryInTheNotice() async {
      let s = store(Self.answering(
        (200, Data(#"{"ok":true,"movedTransactions":2,"movedRules":0,"movedSplits":0,"resetPlaidLabels":0}"#.utf8))))
      await s.load()
      await s.perform(.deleteSub(categoryId: "c1", name: "Snacks"))
      #expect(s.notice == #"Deleted \#u{2014} 2 transaction(s) moved back to "Sample Groceries"."#)
    }

    @Test func togglingAPrimaryShowsNoNotice() async throws {
      let s = store(Self.answering(
        (200, Data(#"{"ok":true,"merged":false,"movedTransactions":0,"movedRules":0,"movedResolved":0,"movedSplits":0}"#.utf8))))
      await s.load()
      await s.perform(.setPrimaries(id: "c1", primaries: ["FOOD_AND_DRINK", "BANK_FEES"]))
      #expect(s.notice == nil)
      #expect(s.writeCount == 1)
      let patch = try #require(StubURLProtocol.requests.first { $0.httpMethod == "PATCH" })
      let body = try #require(StubURLProtocol.body(of: patch))
      #expect(try JSONSerialization.jsonObject(with: body) as? NSDictionary
        == ["plaidPrimaries": ["FOOD_AND_DRINK", "BANK_FEES"]] as NSDictionary)
    }

    @Test func noServerIsABannerForAWrite() async {
      let s = CategoriesStore { nil }
      await s.perform(.create(name: "Sample Pets"))
      #expect(s.banner == APIError.notConfigured.message)
    }
  }
}
