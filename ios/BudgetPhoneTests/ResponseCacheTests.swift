import Foundation
import Testing
@testable import BudgetPhone

struct ResponseCacheTests {
  func fresh() -> ResponseCache {
    ResponseCache(root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
  }

  func files(_ cache: ResponseCache) -> [String] {
    let paths = FileManager.default.enumerator(atPath: cache.root.path)?.allObjects as? [String]
    return paths ?? []
  }

  @Test func roundTrips() {
    let cache = fresh()
    cache.write(Data("one".utf8), name: "ledger", request: "api/x?page=1", owner: "A")
    #expect(cache.read("ledger", request: "api/x?page=1", owner: "A") == Data("one".utf8))
  }

  @Test func anotherRequestReadsNilAndTheNewerWriteRemovesTheOlderFile() {
    let cache = fresh()
    cache.write(Data("one".utf8), name: "ledger", request: "api/x?page=1", owner: "A")
    #expect(cache.read("ledger", request: "api/x?page=2", owner: "A") == nil)
    cache.write(Data("two".utf8), name: "ledger", request: "api/x?page=2", owner: "A")
    #expect(cache.read("ledger", request: "api/x?page=1", owner: "A") == nil)
    #expect(files(cache).filter { $0.hasSuffix(".json") }.count == 1)
  }

  @Test func otherNamesAreKept() {
    let cache = fresh()
    cache.write(Data("one".utf8), name: "ledger", request: "r", owner: "A")
    cache.write(Data("two".utf8), name: "accounts", request: "r", owner: "A")
    #expect(cache.read("ledger", request: "r", owner: "A") != nil)
    #expect(cache.read("accounts", request: "r", owner: "A") != nil)
  }

  @Test func anotherOwnerReadsNilAndItsWriteRemovesTheFirstOwnersFolder() {
    let cache = fresh()
    cache.write(Data("one".utf8), name: "ledger", request: "r", owner: "A")
    #expect(cache.read("ledger", request: "r", owner: "B") == nil)
    cache.write(Data("two".utf8), name: "ledger", request: "r", owner: "B")
    #expect(cache.read("ledger", request: "r", owner: "B") == Data("two".utf8))
    #expect(files(cache).filter { $0.hasSuffix(".json") }.count == 1)
    #expect(cache.read("ledger", request: "r", owner: "A") == nil)
  }

  @Test func clearRemovesEverything() {
    let cache = fresh()
    cache.write(Data("one".utf8), name: "ledger", request: "r", owner: "A")
    cache.clear()
    #expect(!FileManager.default.fileExists(atPath: cache.root.path))
    #expect(cache.read("ledger", request: "r", owner: "A") == nil)
  }

  @Test func filesAreProtectedWhileLocked() {
    #expect(ResponseCache.writeOptions.contains(.completeFileProtection))
  }

  @Test func theTokenNeverAppearsInAPath() {
    let cache = fresh()
    cache.write(Data("one".utf8), name: "ledger", request: "r", owner: "http://x\nsample-secret-token")
    #expect(files(cache).allSatisfy { !$0.contains("sample-secret-token") })
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  struct ResponseSavingTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let query = [URLQueryItem(name: "page", value: "1")]

    func client(
      _ cache: ResponseCache, token: String? = "sample-token",
      _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler), token: token, cache: cache)
    }

    func fresh() -> ResponseCache {
      ResponseCache(root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
    }

    @Test func savesAfter200AndSavedReturnsIt() async throws {
      let cache = fresh()
      let json = try TestData.accountsJSON()
      let c = client(cache) { _ in (200, json) }
      let got: AccountsResponse = try await c.get("api/accounts", query: query, timeout: 5, saveAs: "accounts")
      let saved: AccountsResponse? = c.saved("accounts", "api/accounts", query: query)
      #expect(saved == got)
      let other: AccountsResponse? = c.saved("accounts", "api/accounts", query: [])
      #expect(other == nil)
    }

    @Test func aFailureOrUndecodableAnswerSavesNothing() async throws {
      let cache = fresh()
      let c500 = client(cache) { _ in (500, Data(#"{"error":"boom"}"#.utf8)) }
      await #expect(throws: APIError.self) {
        let _: AccountsResponse = try await c500.get("api/accounts", timeout: 5, saveAs: "accounts")
      }
      let bad = client(cache) { _ in (200, Data("{}".utf8)) }
      await #expect(throws: APIError.self) {
        let _: AccountsResponse = try await bad.get("api/accounts", timeout: 5, saveAs: "accounts")
      }
      let saved: AccountsResponse? = bad.saved("accounts", "api/accounts")
      #expect(saved == nil)
    }

    @Test func withoutSaveAsNothingIsSaved() async throws {
      let cache = fresh()
      let json = try TestData.accountsJSON()
      let c = client(cache) { _ in (200, json) }
      let _: AccountsResponse = try await c.get("api/accounts", timeout: 5)
      let saved: AccountsResponse? = c.saved("accounts", "api/accounts")
      #expect(saved == nil)
    }

    @Test func aDifferentTokenReadsNothing() async throws {
      let cache = fresh()
      let json = try TestData.accountsJSON()
      let c = client(cache) { _ in (200, json) }
      let _: AccountsResponse = try await c.get("api/accounts", timeout: 5, saveAs: "accounts")
      var other = c
      other.token = "another-token"
      let saved: AccountsResponse? = other.saved("accounts", "api/accounts")
      #expect(saved == nil)
    }
  }
}
