import Foundation
import Testing
@testable import BudgetPhone

struct AccessTokenTests {
  @Test func normalizeTrimsAndRejectsEmpty() {
    #expect(AccessToken.normalize("  abc123\n") == "abc123")
    #expect(AccessToken.normalize("   ") == nil)
    #expect(AccessToken.normalize("") == nil)
  }

  @Test func memoryStoreRoundTrips() {
    let store = MemoryTokenStore()
    #expect(store.read() == nil)
    store.write("abc")
    #expect(store.read() == "abc")
    store.write(nil)
    #expect(store.read() == nil)
  }
}
