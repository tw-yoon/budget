import Foundation
import Testing
@testable import BudgetPhone

struct ServerAddressTests {
  @Test(arguments: [
    ("http://budget-mac.local:3000", "http://budget-mac.local:3000"),
    ("  http://100.64.0.1:3000/ ", "http://100.64.0.1:3000"),
    ("https://budget.example.ts.net//", "https://budget.example.ts.net"),
  ])
  func accepts(_ input: String, _ expected: String) {
    #expect(ServerAddress.normalize(input)?.absoluteString == expected)
  }

  @Test(arguments: ["", "   ", "budget-mac.local:3000", "ftp://budget-mac.local", "http://"])
  func rejects(_ input: String) {
    #expect(ServerAddress.normalize(input) == nil)
  }

  @Test func readsTheSavedValue() throws {
    let defaults = try #require(UserDefaults(suiteName: "ServerAddressTests"))
    defaults.removePersistentDomain(forName: "ServerAddressTests")
    #expect(ServerAddress.saved(in: defaults) == nil)
    defaults.set("http://budget-mac.local:3000/", forKey: ServerAddress.storageKey)
    #expect(ServerAddress.saved(in: defaults)?.absoluteString == "http://budget-mac.local:3000")
  }
}
