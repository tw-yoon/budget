import Foundation
import Testing
@testable import BudgetPhone

/// A row write shows on the row at once, as route.ts would send it back.
struct InstantRowTests {
  @Test func aCategoryWithASubIsTheOverrideItsParentAndItsSub() throws {
    let t = try TestData.transaction("tx-fee").withCategory(.set("Dining", subcategory: "Coffee"))
    #expect(t.userCategory == "Dining > Coffee")
    #expect(t.category == "Dining")
    #expect(t.categoryDetailed == "Coffee")
    #expect(t.categoryLabel == "Dining > Coffee")
  }

  @Test func aResetGoesBackToPlaidsCategory() throws {
    let before = try TestData.transaction("tx-purchase")
    let t = before.withCategory(.reset)
    #expect(t.userCategory == nil)
    #expect(t.category == before.plaidCategory)
    #expect(t.categoryDetailed == before.plaidCategoryDetailed)
  }

  @Test func unlinkingDropsThePurchasesCategoryAndLinkingTakesIt() throws {
    let purchase = try TestData.transaction("tx-purchase")
    let unlinked = try TestData.transaction("tx-refund").withLink(nil)
    #expect(unlinked.linkedTo == nil)
    #expect(unlinked.category == unlinked.plaidCategory)
    let linked = unlinked.withLink(purchase)
    #expect(linked.linkedTo == LinkedTargetDTO(
      id: purchase.id, label: purchase.label, name: purchase.title, category: "Shopping > Clothes"))
    #expect(linked.category == "Shopping")
    #expect(linked.categoryDetailed == "Clothes")
    let ownCategory = unlinked.withCategory(.set("Dining", subcategory: nil)).withLink(purchase)
    #expect(ownCategory.userCategory == nil, "the link owns the category now")
    #expect((ownCategory.category, ownCategory.categoryDetailed) == ("Shopping", "Clothes"))
  }

  @Test func addingAndRemovingSplitsKeepsTheRemainder() throws {
    let fee = try TestData.transaction("tx-fee")  // 5.00, unsplit
    let split = fee.withSplit(NewSplit(amount: 2, category: "Dining", subcategory: "Coffee"))
    #expect(split.splits.map(\.userCategory) == ["Dining > Coffee"])
    #expect(split.splitRemainder == 3)
    let all = split.withSplit(NewSplit(amount: 3, category: "Dining", subcategory: nil))
    #expect(all.splitRemainder == nil, "fully allocated: no leftover line")
    let back = all.withoutSplit(all.splits[1].id).withoutSplit(all.splits[0].id)
    #expect(back.splits.isEmpty)
    #expect(back.splitRemainder == nil, "an unsplit row has no remainder")
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct InstantStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    nonisolated static func isWrite(_ r: URLRequest) -> Bool { r.httpMethod != "GET" }

    func session(_ gate: Gate, write: (Int, Data), get: @escaping () throws -> Data) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(
        { r in r.httpMethod == "GET" ? (200, try get()) : write }, gates: [gate]))
    }

    @Test func aCategoryShowsWhileItSavesAndAFailurePutsTheRowBack() async throws {
      let gate = Gate(Self.isWrite)
      let c = session(gate, write: (500, Data(#"{"error":"Failed to update"}"#.utf8))) {
        try TestData.ledgerPage(["a"], page: 1, totalPages: 1)
      }
      let store = TransactionsStore { c }
      await store.reload()
      let before = try #require(store.row("a"))
      let write = Task { () -> APIError? in
        do throws(APIError) {
          try await store.setCategory("a", .set("Dining", subcategory: nil))
          return nil
        } catch { return error }
      }
      await gate.arrival()
      #expect(store.row("a")?.categoryLabel == "Dining")
      gate.open()
      #expect(await write.value == .server(status: 500, message: "Failed to update"))
      #expect(store.row("a") == before)
    }

    @Test func afterASaveTheServersRowWins() async throws {
      let gate = Gate(Self.isWrite)
      let c = session(gate, write: (200, Data(#"{"ok":true}"#.utf8))) {
        try TestData.ledgerPage(["a"], page: 1, totalPages: 1)
      }
      let store = TransactionsStore { c }
      await store.reload()
      let server = try #require(store.row("a"))
      let write = Task { try? await store.setCategory("a", .set("Dining", subcategory: nil)) }
      await gate.arrival()
      #expect(store.row("a")?.category == "Dining")
      gate.open()
      await write.value
      #expect(store.row("a") == server, "the re-read page replaces the instant copy")
    }

    @Test func aRenameShowsWhileItSavesAndAFailurePutsItBack() async {
      let gate = Gate(Self.isWrite)
      let c = session(gate, write: (500, Data(#"{"error":"Failed to rename"}"#.utf8))) {
        try TestData.fixture("categories-admin")
      }
      let s = CategoriesStore { c }
      await s.load()
      let running = Task { await s.perform(.rename(id: "c1", name: "Sample Food", allowMerge: false)) }
      await gate.arrival()
      #expect(s.category(id: "c1")?.name == "Sample Food")
      gate.open()
      await running.value
      #expect(s.category(id: "c1")?.name == "Sample Groceries")
      #expect(s.banner == "Failed to rename")
    }

    @Test func aDeleteHidesTheCategoryAndAMergePromptKeepsTheOldName() async {
      let gate = Gate(Self.isWrite)
      let c = session(gate, write: (500, Data(#"{"error":"In use"}"#.utf8))) {
        try TestData.fixture("categories-admin")
      }
      let s = CategoriesStore { c }
      await s.load()
      let order = s.data?.categories.map(\.id)
      let running = Task { await s.perform(.delete(id: "c1")) }
      await gate.arrival()
      #expect(s.category(id: "c1") == nil)
      gate.open()
      await running.value
      #expect(s.data?.categories.map(\.id) == order, "back in its place")

      let json = #"{"error":"x","merge":true,"targetName":"Transfer","movingTransactions":2,"movingRules":1,"movingResolved":6,"movingSplits":0}"#
      let merge = APIClient(baseURL: base, session: StubURLProtocol.session(
        { r in r.httpMethod == "GET" ? (200, try TestData.fixture("categories-admin")) : (409, Data(json.utf8)) }))
      let m = CategoriesStore { merge }
      await m.load()
      #expect(await m.perform(.rename(id: "c1", name: "Transfer", allowMerge: false)) != nil)
      #expect(m.category(id: "c1")?.name == "Sample Groceries", "not renamed until the merge is confirmed")
    }

    @Test func aRuleSwitchFlipsWhileItSavesAndAFailureFlipsItBack() async {
      let gate = Gate(Self.isWrite)
      let c = session(gate, write: (500, Data(#"{"error":"Failed"}"#.utf8))) {
        try TestData.fixture("rules")
      }
      let s = RulesStore { c }
      await s.load()
      let running = Task { await s.perform(.setEnabled(id: "r1", enabled: false)) }
      await gate.arrival()
      #expect(s.rule(id: "r1")?.enabled == false)
      gate.open()
      await running.value
      #expect(s.rule(id: "r1")?.enabled == true)
      #expect(s.banner == RuleText.updateFailed)
    }
  }
}
