import Foundation
import Testing
@testable import BudgetPhone

/// The success and error counts that drive the save haptics.
struct SaveFeedbackTests {
  @Test func countsSuccessesAndFailuresButNotCancels() {
    var f = SaveFeedback()
    f.record(nil)
    f.record(.server(status: 400, message: "No"))
    f.record(.cancelled)
    f.record(succeeded: false)
    f.record(succeeded: true)
    #expect(f.successes == 2)
    #expect(f.failures == 2)
  }
}

extension StubbedNetworkTests {
  /// Which ledger and rule saves count for the haptics.
  @Suite(.serialized)
  @MainActor
  struct SaveFeedbackStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func ledger(_ write: @escaping (URLRequest) throws -> (Int, Data)) -> TransactionsStore {
      let c = APIClient(
        baseURL: base,
        session: StubURLProtocol.session { r in
          r.httpMethod == "GET" ? (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1)) : try write(r)
        })
      return TransactionsStore { c }
    }

    nonisolated static let ok: (Int, Data) = (200, Data(#"{"ok":true}"#.utf8))
    nonisolated static let refused: (Int, Data) = (400, Data(#"{"error":"Sample refusal"}"#.utf8))

    @Test func eachSuccessfulRowWriteCountsOnce() async throws {
      let s = ledger { _ in Self.ok }
      await s.reload()
      #expect(s.feedback == SaveFeedback(), "a load is not a save")
      try await s.setCategory("a", .set("Dining", subcategory: nil))
      try await s.setLink("a", label: 700)
      try await s.setLink("a", label: nil)
      try await s.addSplit("a", NewSplit(amount: 5, category: "Dining", subcategory: nil))
      try await s.deleteSplit("a", splitId: "sp-1")
      #expect(s.feedback.successes == 5)
      #expect(s.feedback.failures == 0)
    }

    @Test func aRefusedRowWriteCountsAsAFailureAndStillThrows() async {
      let s = ledger { _ in Self.refused }
      await s.reload()
      await #expect(throws: APIError.server(status: 400, message: "Sample refusal")) {
        try await s.setCategory("a", .set("Dining", subcategory: nil))
      }
      _ = try? await s.addSplit("a", NewSplit(amount: 5, category: "Dining", subcategory: nil))
      #expect(s.feedback.failures == 2)
      #expect(s.feedback.successes == 0)
    }

    @Test func aCancelledRowWriteCountsAsNeither() async {
      let s = ledger { _ in throw URLError(.cancelled) }
      await s.reload()
      _ = try? await s.setLink("a", label: nil)
      #expect(s.feedback == SaveFeedback())
    }

    @Test func aCleanSyncIsASuccess() async {
      let s = ledger { _ in (200, Data(#"{"summary":[{"itemId":"i1","institution":"Example Bank","success":true}]}"#.utf8)) }
      await s.sync()
      #expect(s.feedback.successes == 1 && s.feedback.failures == 0)
    }

    @Test func aSyncWithAFailedBankIsAFailure() async {
      let s = ledger { _ in
        (200, Data(#"{"summary":[{"itemId":"i1","institution":"Example Bank","success":false,"error":"ITEM_LOGIN_REQUIRED"}]}"#.utf8))
      }
      await s.sync()
      #expect(s.feedback.failures == 1 && s.feedback.successes == 0)
    }

    @Test func aFailedSyncIsAFailureAndACancelledOneIsSilent() async {
      let failing = ledger { _ in throw URLError(.cannotConnectToHost) }
      await failing.sync()
      #expect(failing.feedback.failures == 1)
      let cancelled = ledger { _ in throw URLError(.cancelled) }
      await cancelled.sync()
      #expect(cancelled.feedback == SaveFeedback())
    }

    func rules(_ write: (Int, Data)) -> RulesStore {
      let c = APIClient(
        baseURL: base,
        session: StubURLProtocol.session { r in
          r.httpMethod == "GET" ? (200, (try? TestData.fixture("rules")) ?? Data()) : write
        })
      return RulesStore { c }
    }

    let rule = NewRule(field: "EITHER", matchType: "CONTAINS", pattern: "Sample Mart", category: "Sample Groceries")

    @Test func anAddedRuleIsASuccess() async throws {
      let s = rules((201, Data(#"{"rule":{"id":"r9"}}"#.utf8)))
      await s.load()
      try await s.add(rule)
      #expect(s.feedback.successes == 1 && s.feedback.failures == 0)
    }

    @Test func aRefusedRuleIsAFailure() async {
      let s = rules((400, Data(#"{"error":"Pattern is required"}"#.utf8)))
      await s.load()
      _ = try? await s.add(rule)
      #expect(s.feedback.failures == 1 && s.feedback.successes == 0)
    }

    @Test func otherRuleWritesPlayNothing() async {
      let s = rules((200, Data(#"{"ok":true}"#.utf8)))
      await s.load()
      let id = s.data?.rules.first?.id ?? "r1"
      await s.perform(.setEnabled(id: id, enabled: false))
      #expect(s.feedback == SaveFeedback())
    }
  }
}
