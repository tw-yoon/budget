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

  @Test func detectsAServerOrTokenChange() {
    func changed(_ oldS: String, _ oldT: String?, _ newS: String, _ newT: String) -> Bool {
      ServerForm.changed(oldServer: oldS, oldToken: oldT, newServer: newS, newToken: newT)
    }
    let host = "https://budget.example.ts.net"
    #expect(!changed(host, "token-a", host + "/", " token-a "))
    #expect(!changed("", nil, "", ""))
    #expect(changed(host, "token-a", "https://other.example.ts.net", "token-a"))
    #expect(changed(host, "token-a", host, "token-b"))
    #expect(changed(host, nil, host, "token-a"))
  }
}
