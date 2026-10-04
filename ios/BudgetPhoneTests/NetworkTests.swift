import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// APIClient and AccountsStore against StubURLProtocol. Serialized because
  /// the stub's handler is shared state.
  @Suite(.serialized)
  @MainActor
  struct NetworkTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    @Test func sendsTheTokenAsABearerHeader() async throws {
      let json = try TestData.accountsJSON()
      var c = client { _ in (200, json) }
      c.token = "sample-token"
      _ = try await c.accounts()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer sample-token")
    }

    @Test func sendsNoAuthorizationWithoutAToken() async throws {
      let json = try TestData.accountsJSON()
      _ = try await client { _ in (200, json) }.accounts()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func status401IsUnauthorized() async {
      let c = client { _ in (401, Data(#"{"error":"Sign-in required."}"#.utf8)) }
      await #expect(throws: APIError.unauthorized) { try await c.accounts() }
      #expect(APIError.unauthorized.message == "The server rejected the access token. Paste the current one in Settings → Server.")
    }

    @Test func accountsHitsTheRightURLAndDecodes() async throws {
      let json = try TestData.accountsJSON()
      let response = try await client { _ in (200, json) }.accounts()
      #expect(response.summary.accountCount == 2)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "GET")
      #expect(request.url?.absoluteString == "http://budget-mac.local:3000/api/accounts")
    }

    @Test func updateSendsOnlyThePatchKeys() async throws {
      try await client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
        .updateAccount(id: "acc-card", patch: AccountPatch(manualCreditLimit: .set(6000)))
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "PATCH")
      #expect(request.url?.path() == "/api/accounts/acc-card")
      let body = try #require(StubURLProtocol.body(of: request))
      #expect(String(decoding: body, as: UTF8.self) == #"{"manualCreditLimit":6000}"#)
    }

    @Test func serverErrorCarriesTheRoutesMessage() async {
      let c = client { _ in (400, Data(#"{"error":"manualDueDay must be a whole number from 1 to 31"}"#.utf8)) }
      await #expect(throws: APIError.server(status: 400, message: "manualDueDay must be a whole number from 1 to 31")) {
        try await c.updateAccount(id: "x", patch: AccountPatch(manualDueDay: .set(40)))
      }
    }

    @Test func connectionFailureIsUnreachable() async {
      let c = client { _ in throw URLError(.cannotConnectToHost) }
      do {
        _ = try await c.accounts()
        Issue.record("expected a throw")
      } catch {
        guard case .unreachable = error else {
          Issue.record("expected .unreachable, got \(error)")
          return
        }
      }
    }

    @Test func wrongShapeIsDecoding() async {
      let c = client { _ in (200, Data(#"{"nope":1}"#.utf8)) }
      do {
        _ = try await c.accounts()
        Issue.record("expected a throw")
      } catch {
        guard case .decoding = error else {
          Issue.record("expected .decoding, got \(error)")
          return
        }
      }
    }

    @Test func storeWithoutAServerIsNotConfigured() async {
      let store = AccountsStore { nil }
      await store.load()
      #expect(store.error == .notConfigured)
      #expect(store.data == nil)
    }

    @Test func firstLoadFailureIsFullScreenLaterFailureIsABanner() async throws {
      let json = try TestData.accountsJSON()
      var fail = true
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        return (200, json)
      }
      let store = AccountsStore { c }

      await store.load()
      #expect(store.data == nil)
      #expect(store.error != nil)

      fail = false
      await store.load()
      #expect(store.data != nil)
      #expect(store.error == nil)

      fail = true
      await store.load()
      #expect(store.data != nil, "a failed reload keeps what is on screen")
      #expect(store.error == nil)
      #expect(store.banner != nil)
    }

    @Test func aFailedReloadOverDataSaysWhyInPlainLanguage() async throws {
      let json = try TestData.accountsJSON()
      var status = 200
      var unreachable = false
      let c = client { _ in
        if unreachable { throw URLError(.cannotConnectToHost) }
        return (status, status == 200 ? json : Data("{}".utf8))
      }
      let store = AccountsStore { c }
      await store.load()
      unreachable = true
      await store.load()
      #expect(store.banner == "Showing saved data — can't reach your Mac.")
      unreachable = false
      status = 401
      await store.load()
      #expect(store.banner == "Showing saved data — access token not accepted. Re-enter it in Settings → Server.")
      #expect(store.data != nil && store.error == nil)
    }

    @Test func aBadGatewayWithNothingShowingIsCantReach() async {
      let c = client { _ in (502, Data()) }
      let store = AccountsStore { c }
      await store.load()
      #expect(store.error?.isUnreachable == true)
    }

    @Test func refreshNamesFailedBanksAndStillReloads() async throws {
      let json = try TestData.accountsJSON()
      let refresh = #"{"updated":[],"liabilities":[],"errors":[{"itemId":"i1","institution":"Example Bank","error":"ITEM_LOGIN_REQUIRED"}]}"#
      let c = client { request in
        request.httpMethod == "POST" ? (200, Data(refresh.utf8)) : (200, json)
      }
      let store = AccountsStore { c }
      await store.refresh()
      #expect(store.banner == "Couldn't refresh Example Bank (ITEM_LOGIN_REQUIRED)")
      #expect(store.data?.summary.accountCount == 2)
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["POST", "GET"])
    }

    @Test func saveSkipsAnEmptyPatchAndReloadsAfterARealOne() async throws {
      let json = try TestData.accountsJSON()
      let c = client { request in
        request.httpMethod == "PATCH" ? (200, Data(#"{"ok":true}"#.utf8)) : (200, json)
      }
      let store = AccountsStore { c }
      let card = try TestData.accounts().groups[1].accounts[0]

      try await store.save(AccountPatch(), to: card)
      #expect(StubURLProtocol.requests.isEmpty)

      try await store.save(AccountPatch(displayName: .set("Travel")), to: card)
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["PATCH", "GET"])
    }

    // MARK: - F2a: progress instead of a stale error while a load is in flight

    @Test func aNewLoadWithNoDataClearsThePriorErrorWhileInFlight() async throws {
      let json = try TestData.accountsJSON()
      var fail = true
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        Thread.sleep(forTimeInterval: 0.05)
        return (200, json)
      }
      let store = AccountsStore { c }

      await store.load()
      #expect(store.error != nil)

      fail = false
      let task = Task { await store.load() }
      try await Task.sleep(for: .milliseconds(10))
      #expect(store.error == nil, "a new load with no data on screen should clear the old error, not leave it showing")
      #expect(store.isLoading)
      await task.value
      #expect(store.data != nil)
    }

    // MARK: - Visible refresh button

    @Test func refreshIsFlaggedWhileInFlightAndASecondTapIsIgnored() async throws {
      let json = try TestData.accountsJSON()
      let refresh = #"{"updated":[],"liabilities":[],"errors":[]}"#
      let c = client { request in
        if request.httpMethod == "POST" {
          Thread.sleep(forTimeInterval: 0.05)
          return (200, Data(refresh.utf8))
        }
        return (200, json)
      }
      let store = AccountsStore { c }
      #expect(store.isRefreshing == false)

      let first = Task { await store.refresh() }
      try await Task.sleep(for: .milliseconds(10))
      #expect(store.isRefreshing, "the toolbar shows progress while Plaid is being asked")
      await store.refresh()  // a second tap while the first is running
      await first.value

      #expect(store.isRefreshing == false)
      #expect(StubURLProtocol.requests.filter { $0.httpMethod == "POST" }.count == 1)
      #expect(store.data != nil)
    }

    // MARK: - F2b: a stale banner doesn't survive a later successful load

    @Test func aSuccessfulLoadClearsABannerLeftByAnEarlierFailedReload() async throws {
      let json = try TestData.accountsJSON()
      var fail = false
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        return (200, json)
      }
      let store = AccountsStore { c }

      await store.load()
      #expect(store.data != nil)

      fail = true
      await store.load()
      #expect(store.banner != nil, "a failed reload over existing data should set the banner")

      fail = false
      await store.load()
      #expect(store.banner == nil, "a later successful load must clear the stale banner")
    }

    @Test func refreshClearsAnExistingBannerBeforeRunningButItsOwnBannerSurvivesTheReload() async throws {
      let json = try TestData.accountsJSON()
      let refresh = #"{"updated":[],"liabilities":[],"errors":[{"itemId":"i1","institution":"Example Bank","error":"ITEM_LOGIN_REQUIRED"}]}"#
      let c = client { request in
        request.httpMethod == "POST" ? (200, Data(refresh.utf8)) : (200, json)
      }
      let store = AccountsStore { c }
      store.banner = "a stale banner from earlier"

      await store.refresh()
      #expect(store.banner == "Couldn't refresh Example Bank (ITEM_LOGIN_REQUIRED)",
        "refresh's own banner must survive the reload it triggers, not just the stale one it cleared")
    }

    // MARK: - F2c: cancellation is a silent no-op, not a failure

    @Test func cancelledRequestSurfacesAsAPIErrorCancelled() async {
      let c = client { _ in throw URLError(.cancelled) }
      await #expect(throws: APIError.cancelled) {
        _ = try await c.accounts()
      }
    }

    @Test func cancellationWithNoDataOnScreenShowsNoError() async {
      let c = client { _ in throw URLError(.cancelled) }
      let store = AccountsStore { c }
      await store.load()
      #expect(store.error == nil)
      #expect(store.data == nil)
    }

    @Test func swiftCancellationErrorIsAlsoSilent() async {
      let c = client { _ in throw CancellationError() }
      let store = AccountsStore { c }
      await store.load()
      #expect(store.error == nil)
      #expect(store.data == nil)
    }

    @Test func cancellationDuringAReloadLeavesTheBannerAndDataAlone() async throws {
      let json = try TestData.accountsJSON()
      var shouldCancel = false
      let c = client { _ in
        if shouldCancel { throw URLError(.cancelled) }
        return (200, json)
      }
      let store = AccountsStore { c }
      await store.load()
      #expect(store.data != nil)

      shouldCancel = true
      await store.load()
      #expect(store.banner == nil)
      #expect(store.data != nil)
    }

    // MARK: - F2d: only the latest load's result is applied

    @Test func outOfOrderLoadsKeepOnlyTheLatestRequestsResult() async throws {
      let olderJSON = try TestData.accountsJSON()  // accountCount 2
      let newerJSON = Data(
        #"{"groups":[],"summary":{"totalAssets":0,"totalLiabilities":0,"netWorth":0,"accountCount":0,"lastRefreshed":null}}"#
          .utf8)
      let lock = NSLock()
      var callCount = 0
      let c = client { _ in
        lock.lock()
        callCount += 1
        let n = callCount
        lock.unlock()
        if n == 1 {
          Thread.sleep(forTimeInterval: 0.05)
          return (200, olderJSON)
        }
        return (200, newerJSON)
      }
      let store = AccountsStore { c }

      let firstLoad = Task { await store.load() }
      try await Task.sleep(for: .milliseconds(10))
      await store.load()
      await firstLoad.value

      #expect(
        store.data?.summary.accountCount == 0,
        "the second load started later and must win even though the first, slower response arrived after it")
    }
  }
}

/// What a launch shows before the server answers: the accounts saved last time.
extension StubbedNetworkTests.NetworkTests {
  func client(
    cache: ResponseCache, token: String = "sample-token", gates: [Gate] = [],
    _ handler: @escaping (URLRequest) throws -> (Int, Data)
  ) -> APIClient {
    APIClient(
      baseURL: base, session: StubURLProtocol.session(handler, gates: gates), token: token,
      cache: cache)
  }

  /// The accounts fixture, saved for `token` as an earlier launch would have.
  func saveAccounts(in cache: ResponseCache, token: String = "sample-token") async throws {
    let json = try TestData.accountsJSON()
    _ = try await client(cache: cache, token: token) { _ in (200, json) }.accounts()
  }

  @Test func savedAccountsShowWhenTheServerIsUnreachable() async throws {
    let cache = TestData.cache()
    try await saveAccounts(in: cache)
    let c = client(cache: cache) { _ in throw URLError(.cannotConnectToHost) }
    let store = AccountsStore { c }
    await store.load()
    #expect(try store.data == TestData.accounts())
    #expect(store.error == nil)
    #expect(store.banner != nil, "with saved data showing, a failure is a banner")
  }

  @Test func savedAccountsShowWhileLoadingThenTheServersAnswerReplacesThem() async throws {
    let cache = TestData.cache()
    try await saveAccounts(in: cache)
    var root = try #require(
      JSONSerialization.jsonObject(with: TestData.accountsJSON()) as? [String: Any])
    root["groups"] = []
    let fresh = try JSONSerialization.data(withJSONObject: root)
    let gate = Gate { _ in true }
    let c = client(cache: cache, gates: [gate]) { _ in (200, fresh) }
    let store = AccountsStore { c }
    let load = Task { await store.load() }
    await gate.arrival()
    #expect(try store.data == TestData.accounts())
    #expect(store.isLoading)
    gate.open()
    await load.value
    #expect(store.data?.groups.isEmpty == true)
    #expect(store.error == nil && store.banner == nil)
  }

  @Test func withNothingSavedAFailureIsStillFullScreen() async {
    let c = client(cache: TestData.cache()) { _ in throw URLError(.cannotConnectToHost) }
    let store = AccountsStore { c }
    await store.load()
    #expect(store.data == nil)
    guard case .unreachable = store.error else {
      Issue.record("expected .unreachable, got \(String(describing: store.error))")
      return
    }
    #expect(store.banner == nil)
  }

  @Test func accountsSavedUnderAnotherTokenAreNotShown() async throws {
    let cache = TestData.cache()
    try await saveAccounts(in: cache, token: "other-token")
    let c = client(cache: cache) { _ in throw URLError(.cannotConnectToHost) }
    let store = AccountsStore { c }
    await store.load()
    #expect(store.data == nil)
    guard case .unreachable = store.error else {
      Issue.record("expected .unreachable, got \(String(describing: store.error))")
      return
    }
    #expect(store.banner == nil)
  }
}
