import Foundation
import Testing
@testable import BudgetPhone

struct SetupHandoffTests {
  /// A fresh, empty defaults suite per test.
  private func emptyDefaults(_ name: String) throws -> UserDefaults {
    let defaults = try #require(UserDefaults(suiteName: "SetupHandoffTests.\(name)"))
    defaults.removePersistentDomain(forName: "SetupHandoffTests.\(name)")
    return defaults
  }

  private let env = [
    "BUDGET_SETUP_SERVER": "https://test-mac.example.ts.net/",
    "BUDGET_SETUP_TOKEN": " tok-123\n",
  ]

  @Test func savesServerAndTokenWhenNothingIsSaved() throws {
    let defaults = try emptyDefaults("fresh")
    let tokens = MemoryTokenStore()
    SetupHandoff.apply(environment: env, defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == "https://test-mac.example.ts.net")
    #expect(tokens.read() == "tok-123")
  }

  @Test func neverReplacesASavedServer() throws {
    let defaults = try emptyDefaults("saved")
    defaults.set("https://other.example.ts.net", forKey: ServerAddress.storageKey)
    let tokens = MemoryTokenStore("old-token")
    SetupHandoff.apply(environment: env, defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == "https://other.example.ts.net")
    #expect(tokens.read() == "old-token")
  }

  @Test func ignoresAnAddressThatDoesNotParse() throws {
    let defaults = try emptyDefaults("bad")
    let tokens = MemoryTokenStore()
    SetupHandoff.apply(
      environment: ["BUDGET_SETUP_SERVER": "not a url", "BUDGET_SETUP_TOKEN": "tok-123"],
      defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == nil)
    #expect(tokens.read() == nil)
  }

  @Test func ignoresALaunchWithoutAServer() throws {
    let defaults = try emptyDefaults("none")
    let tokens = MemoryTokenStore()
    SetupHandoff.apply(environment: ["BUDGET_SETUP_TOKEN": "tok-123"], defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == nil)
    #expect(tokens.read() == nil)
  }

  @Test func savesTheServerWithoutAToken() throws {
    let defaults = try emptyDefaults("notoken")
    let tokens = MemoryTokenStore()
    SetupHandoff.apply(
      environment: ["BUDGET_SETUP_SERVER": "https://test-mac.example.ts.net"],
      defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == "https://test-mac.example.ts.net")
    #expect(tokens.read() == nil)
  }
}
