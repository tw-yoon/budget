import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Rules: the store's failure rules and its writes.
  @Suite(.serialized)
  @MainActor
  struct RulesStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func store(
      gates: [Gate] = [], _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> RulesStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler, gates: gates))
      return RulesStore { c }
    }

    nonisolated static func fixture() -> (Int, Data) { (200, (try? TestData.fixture("rules")) ?? Data()) }
    nonisolated static let fail: (Int, Data) = (500, Data(#"{"error":"Failed to load rules"}"#.utf8))
    nonisolated static func isGET(_ r: URLRequest) -> Bool { r.httpMethod == "GET" }
    nonisolated static func isWrite(_ r: URLRequest) -> Bool { r.httpMethod != "GET" }

    /// Answers GETs with the fixture and everything else with `write`.
    nonisolated static func answering(_ write: (Int, Data)) -> (URLRequest) -> (Int, Data) {
      { r in r.httpMethod == "GET" ? fixture() : write }
    }

    func methods() -> [String] { StubURLProtocol.requests.compactMap(\.httpMethod) }

    // MARK: Loading

    @Test func aFirstLoadFailureIsFullScreen() async {
      let s = store { _ in Self.fail }
      await s.load()
      #expect(s.data == nil)
      #expect(s.error == .server(status: 500, message: "Failed to load rules"))
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
      #expect(s.rule(id: "r1")?.pattern == "Sample Mart")
      #expect(s.error == nil)
      #expect(s.banner == "Failed to load rules")
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

    // MARK: Writes

    @Test func aFailedToggleShowsTheWebsMessageAndReloads() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to update rule"}"#.utf8))))
      await s.load()
      await s.perform(.setEnabled(id: "r1", enabled: false))
      #expect(s.banner == "Failed to update the rule.")
      #expect(methods() == ["GET", "PATCH", "GET"], "the reload puts the switch back")
      #expect(!s.isSaving)
    }

    @Test func aFailedCategorySaveShowsTheWebsMessage() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to update rule"}"#.utf8))))
      await s.load()
      await s.perform(.setCategory(id: "r1", category: "Example Dining"))
      #expect(s.banner == "Failed to update the rule.")
      #expect(methods() == ["GET", "PATCH", "GET"])
    }

    @Test func aFailedTakeOverShowsTheServerMessageAndReloads() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to take over"}"#.utf8))))
      await s.load()
      await s.perform(.takeOver(id: "r1"))
      #expect(s.banner == "Failed to take over")
      #expect(s.notice == nil)
      #expect(methods() == ["GET", "POST", "GET"])
    }

    @Test func aFailedDeleteShowsTheServerMessage() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to delete rule"}"#.utf8))))
      await s.load()
      await s.perform(.delete(id: "r1"))
      #expect(s.banner == "Failed to delete rule")
    }

    @Test func takeOverShowsTheWebsNoticeAfterItsReload() async {
      let s = store(Self.answering((200, Data(#"{"updated":3}"#.utf8))))
      await s.load()
      await s.perform(.takeOver(id: "r1"))
      #expect(s.notice == "\"Sample Mart\" now sets 3 more transactions.")
      #expect(s.banner == nil)
      #expect(methods() == ["GET", "POST", "GET"])
    }

    @Test func aWriteClearsStaleMessagesBeforeItsRequest() async {
      let write = Gate(Self.isWrite)
      let s = store(gates: [write], Self.answering((200, Data(#"{"rule":{"id":"r1"}}"#.utf8))))
      await s.load()
      s.banner = "stale"
      s.notice = "stale"
      let running = Task { await s.perform(.setEnabled(id: "r1", enabled: false)) }
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
      let first = Task { await s.perform(.delete(id: "r1")) }
      await write.arrival()
      await s.perform(.delete(id: "r2"))
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
      await s.perform(.delete(id: "r1"))
      #expect(s.banner == nil)
      #expect(s.notice == nil)
      #expect(methods() == ["GET", "DELETE"])
    }

    // MARK: Apply

    @Test func applyShowsTheWebsNoticeAfterItsReload() async {
      let s = store(Self.answering((200, Data(#"{"updated":12,"kept":1}"#.utf8))))
      await s.load()
      await s.apply()
      #expect(s.notice == "Re-categorized 12 transactions. 1 matching transaction set by hand was kept.")
      #expect(methods() == ["GET", "POST", "GET"])
      #expect(!s.isApplying)
    }

    @Test func applyClearsStaleMessagesBeforeItsRequest() async {
      let post = Gate(Self.isWrite)
      let s = store(gates: [post], Self.answering((200, Data(#"{"updated":0,"kept":0}"#.utf8))))
      await s.load()
      s.banner = "stale"
      s.notice = "stale"
      let running = Task { await s.apply() }
      await post.arrival()
      #expect(s.banner == nil)
      #expect(s.notice == nil)
      post.open()
      await running.value
    }

    @Test func aFailedApplyIsABannerWithNoReload() async {
      let s = store(Self.answering((500, Data(#"{"error":"Failed to apply rules"}"#.utf8))))
      await s.load()
      await s.apply()
      #expect(s.banner == "Failed to apply rules")
      #expect(methods() == ["GET", "POST"])
    }

    @Test func aSecondApplyWhileOneIsInFlightSendsNothing() async {
      let apply = Gate(Self.isWrite)
      let s = store(gates: [apply], Self.answering((200, Data(#"{"updated":0,"kept":0}"#.utf8))))
      await s.load()
      let first = Task { await s.apply() }
      await apply.arrival()
      #expect(s.isApplying)
      await s.apply()
      apply.open()
      await first.value
      #expect(methods().filter { $0 == "POST" }.count == 1)
    }

    // MARK: Add

    @Test func addThrowsTheServerMessageToTheSheet() async {
      let s = store(Self.answering((400, Data(#"{"error":"Pattern is required"}"#.utf8))))
      await s.load()
      await #expect(throws: APIError.server(status: 400, message: "Pattern is required")) {
        try await s.add(NewRule(field: "EITHER", matchType: "CONTAINS", pattern: " ", category: "Sample Groceries"))
      }
    }

    @Test func addClearsAStaleBannerEvenWhenItFails() async {
      let s = store(Self.answering((400, Data(#"{"error":"Pattern is required"}"#.utf8))))
      await s.load()
      s.banner = "stale"
      s.notice = "stale"
      _ = try? await s.add(NewRule(field: "EITHER", matchType: "CONTAINS", pattern: " ", category: "Sample Groceries"))
      #expect(s.banner == nil)
      #expect(s.notice == nil)
    }

    @Test func addReloadsOnSuccess() async throws {
      let s = store(Self.answering((201, Data(#"{"rule":{"id":"r9"}}"#.utf8))))
      await s.load()
      try await s.add(NewRule(field: "EITHER", matchType: "CONTAINS", pattern: "Sample Mart", category: "Sample Groceries"))
      #expect(methods() == ["GET", "POST", "GET"])
    }

    // MARK: Recategorizing (tells the Activity tab to reload)

    @Test func aSuccessfulApplyCountsAsARecategorize() async {
      let s = store(Self.answering((200, Data(#"{"updated":2,"kept":0}"#.utf8))))
      await s.load()
      await s.apply()
      #expect(s.recategorizeCount == 1)
    }

    @Test func aSuccessfulTakeOverCountsAsARecategorize() async {
      let s = store(Self.answering((200, Data(#"{"updated":3}"#.utf8))))
      await s.load()
      await s.perform(.takeOver(id: "r1"))
      #expect(s.recategorizeCount == 1)
    }

    @Test func failuresAndRuleEditsDoNotCountAsARecategorize() async {
      let fails = store(Self.answering((500, Data(#"{"error":"Failed"}"#.utf8))))
      await fails.load()
      await fails.apply()
      await fails.perform(.takeOver(id: "r1"))
      #expect(fails.recategorizeCount == 0)

      let edits = store(Self.answering((200, Data(#"{"rule":{"id":"r1"}}"#.utf8))))
      await edits.load()
      await edits.perform(.setEnabled(id: "r1", enabled: false))
      await edits.perform(.setCategory(id: "r1", category: "Example Dining"))
      #expect(edits.recategorizeCount == 0, "a rule edit changes no transaction until Apply Now")
    }
  }
}
