import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Categories: each call's method, path and exact body, and
  /// how the 409 bodies are read.
  @Suite(.serialized)
  struct CategoriesAPITests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    func only() throws -> URLRequest {
      #expect(StubURLProtocol.requests.count == 1)
      return try #require(StubURLProtocol.requests.first)
    }

    /// The body as an NSDictionary, so the comparison covers every key.
    func body(_ r: URLRequest) throws -> NSDictionary {
      let data = try #require(StubURLProtocol.body(of: r))
      return try #require(try JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    static let renamed = #"{"ok":true,"merged":false,"movedTransactions":3,"movedRules":0,"movedResolved":3,"movedSplits":0}"#

    @Test func getDecodesTheFixture() async throws {
      let c = client { _ in (200, try TestData.fixture("categories-admin")) }
      let d = try await c.categoriesAdmin()
      #expect(d.categories.count == 2)
      let r = try only()
      #expect(r.httpMethod == "GET")
      #expect(r.url?.path() == "/api/categories")
    }

    @Test func createSendsOnlyTheName() async throws {
      let c = client { _ in (200, Data(#"{"category":{"id":"c9","name":"Sample Pets"}}"#.utf8)) }
      try await c.createCategory(name: "Sample Pets")
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/categories")
      #expect(try body(r) == ["name": "Sample Pets"] as NSDictionary)
    }

    @Test func renameSendsNameAndAllowMerge() async throws {
      let c = client { _ in (200, Data(Self.renamed.utf8)) }
      let outcome = try await c.renameCategory(id: "c1", name: "Sample Food", allowMerge: false)
      #expect(outcome == .done(RenameResult(merged: false, movedTransactions: 3, movedSplits: 0)))
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/categories/c1")
      #expect(try body(r) == ["name": "Sample Food", "allowMerge": false] as NSDictionary)
    }

    @Test func aMerge409BecomesAPrompt() async throws {
      let json = #"{"error":"Merge not confirmed","merge":true,"targetName":"Example Dining","movingTransactions":2,"movingRules":1,"movingResolved":6,"movingSplits":0}"#
      let c = client { _ in (409, Data(json.utf8)) }
      let outcome = try await c.renameCategory(id: "c1", name: "Example Dining", allowMerge: false)
      #expect(outcome == .needsMerge(MergePrompt(
        targetName: "Example Dining", movingTransactions: 2, movingRules: 1, movingResolved: 6, movingSplits: 0)))
    }

    @Test func aPlain409StaysAServerError() async throws {
      let json = #"{"error":"\"Transfer\" cannot be renamed"}"#
      let c = client { _ in (409, Data(json.utf8)) }
      await #expect(throws: APIError.server(status: 409, message: "\"Transfer\" cannot be renamed")) {
        try await c.renameCategory(id: "c2", name: "Moves", allowMerge: false)
      }
    }

    @Test func setPlaidPrimariesSendsOnlyTheList() async throws {
      let c = client { _ in (200, Data(Self.renamed.utf8)) }
      try await c.setPlaidPrimaries(id: "c1", ["FOOD_AND_DRINK", "BANK_FEES"])
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/categories/c1")
      #expect(try body(r) == ["plaidPrimaries": ["FOOD_AND_DRINK", "BANK_FEES"]] as NSDictionary)
    }

    @Test func deleteSendsNoBody() async throws {
      let c = client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      try await c.deleteCategory(id: "c1")
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/categories/c1")
      #expect(r.url?.query() == nil, "the web never sends reassignTo")
      #expect(StubURLProtocol.body(of: r) == nil)
    }

    @Test func aDeleteRefusedInUseCarriesTheWebsMessage() async throws {
      let json = #"{"error":"Still in use","transactionCount":3,"ruleCount":1,"mappingCount":2,"splitCount":0}"#
      let c = client { _ in (409, Data(json.utf8)) }
      await #expect(throws: APIError.server(
        status: 409,
        message: CategoryRules.stillUsed(transactions: 3, rules: 1, mappings: 2, splits: 0))) {
        try await c.deleteCategory(id: "c1")
      }
    }

    @Test func createSubcategorySendsOnlyTheName() async throws {
      let c = client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      try await c.createSubcategory(categoryId: "c1", name: "Snacks")
      let r = try only()
      #expect(r.httpMethod == "POST")
      #expect(r.url?.path() == "/api/categories/c1/subcategories")
      #expect(try body(r) == ["name": "Snacks"] as NSDictionary)
    }

    @Test func renameSubcategorySendsFromToAndAllowMerge() async throws {
      let c = client { _ in (200, Data(#"{"ok":true,"merged":true,"movedTransactions":2,"movedRules":0,"movedSplits":1}"#.utf8)) }
      let outcome = try await c.renameSubcategory(categoryId: "c1", from: "Snacks", to: "Treats", allowMerge: true)
      #expect(outcome == .done(RenameResult(merged: true, movedTransactions: 2, movedSplits: 1)))
      let r = try only()
      #expect(r.httpMethod == "PATCH")
      #expect(r.url?.path() == "/api/categories/c1/subcategories")
      #expect(try body(r) == ["from": "Snacks", "to": "Treats", "allowMerge": true] as NSDictionary)
    }

    @Test func aSubcategoryMerge409BecomesAPrompt() async throws {
      let json = #"{"error":"Merge not confirmed","merge":true,"targetName":"Treats","movingTransactions":2,"movingRules":1}"#
      let c = client { _ in (409, Data(json.utf8)) }
      let outcome = try await c.renameSubcategory(categoryId: "c1", from: "Snacks", to: "Treats", allowMerge: false)
      #expect(outcome == .needsMerge(MergePrompt(
        targetName: "Treats", movingTransactions: 2, movingRules: 1, movingResolved: nil, movingSplits: nil)))
    }

    @Test func deleteSubcategoryPutsTheNameInTheQueryEncodingPlus() async throws {
      let c = client { _ in (200, Data(#"{"ok":true,"movedTransactions":0,"movedRules":0,"movedSplits":0,"resetPlaidLabels":1}"#.utf8)) }
      let result = try await c.deleteSubcategory(categoryId: "c1", name: "Snacks + Treats & More")
      #expect(result == SubcategoryDeleteResult(movedTransactions: 0, movedSplits: 0, resetPlaidLabels: 1))
      let r = try only()
      #expect(r.httpMethod == "DELETE")
      #expect(r.url?.path() == "/api/categories/c1/subcategories")
      // The server reads the query with URLSearchParams, which turns a bare "+" into a space.
      #expect(r.url?.query(percentEncoded: true) == "name=Snacks%20%2B%20Treats%20%26%20More")
      #expect(TestData.query(of: r, "name") == "Snacks + Treats & More")
    }
  }
}
