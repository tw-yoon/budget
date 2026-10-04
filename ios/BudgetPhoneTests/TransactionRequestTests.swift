import Foundation
import Testing
@testable import BudgetPhone

struct TransactionRequestTests {
  func json<T: Encodable>(_ value: T) throws -> String {
    let e = JSONEncoder()
    e.outputFormatting = .sortedKeys
    return String(decoding: try e.encode(value), as: UTF8.self)
  }

  func dict(_ items: [URLQueryItem]) -> [String: String] {
    Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
  }

  @Test func defaultQueryMatchesTheWeb() {
    let items = TransactionQuery().queryItems(page: 1)
    #expect(items.map(\.name) == ["page", "limit", "hideInternal", "hideLinked", "sort", "dir"])
    #expect(dict(items) == [
      "page": "1", "limit": "50", "hideInternal": "true", "hideLinked": "true",
      "sort": "date", "dir": "desc",
    ])
    #expect(TransactionQuery().filtersAreDefault)
  }

  @Test func everyFilterMapsToItsParameter() {
    var q = TransactionQuery()
    q.search = "  sample mart "
    q.accountId = "acc-card"
    q.hideInternal = false
    q.showLinked = true
    q.sort = .label
    q.ascending = true
    #expect(dict(q.queryItems(page: 3)) == [
      "page": "3", "limit": "50", "hideInternal": "false", "hideLinked": "false",
      "sort": "label", "dir": "asc", "search": "sample mart", "accountId": "acc-card",
    ])
    #expect(!q.filtersAreDefault)
  }

  @Test func blankSearchAndAccountAreOmitted() {
    var q = TransactionQuery()
    q.search = "   "
    q.accountId = ""
    #expect(!q.queryItems(page: 1).contains { $0.name == "search" || $0.name == "accountId" })
    #expect(q.filtersAreDefault == false, "an empty-string account is still a choice away from nil")
  }

  @Test func categoryBodies() throws {
    #expect(try json(CategoryUpdate.set("Groceries", subcategory: " Organic ")) == #"{"category":"Groceries","subcategory":"Organic"}"#)
    #expect(try json(CategoryUpdate.set("Groceries", subcategory: "  ")) == #"{"category":"Groceries","subcategory":null}"#)
    #expect(try json(CategoryUpdate.reset) == #"{"category":null}"#)
  }

  @Test func linkBodies() throws {
    #expect(try json(LinkUpdate(linkedToLabel: 700)) == #"{"linkedToLabel":700}"#)
    #expect(try json(LinkUpdate(linkedToLabel: nil)) == #"{"linkedToLabel":null}"#)
  }

  @Test func splitBody() throws {
    #expect(try json(NewSplit(amount: 30.5, category: "Household", subcategory: nil))
      == #"{"amount":30.5,"category":"Household","subcategory":null}"#)
    #expect(try json(NewSplit(amount: 10, category: "Groceries", subcategory: " Organic"))
      == #"{"amount":10,"category":"Groceries","subcategory":"Organic"}"#)
  }

  @Test func uiStateValueDistinguishesNothingFromNonStrings() throws {
    func decode(_ s: String) throws -> UIStateValue {
      try JSONDecoder().decode(UIStateValue.self, from: Data(s.utf8))
    }
    #expect(try decode(#"{"value":"pro"}"#).string == "pro")
    #expect(try decode(#"{"value":"pro"}"#).isStored)
    #expect(try !decode(#"{"value":null}"#).isStored)
    #expect(try !decode(#"{}"#).isStored)
    #expect(try decode(#"{"value":{"x":1}}"#).isStored)
    #expect(try decode(#"{"value":{"x":1}}"#).string == nil)
  }
}
