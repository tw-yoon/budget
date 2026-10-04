import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// The ledger store, ProMode and CategoryCatalog against StubURLProtocol.
  /// Serialized: the stub's handler is shared.
  @Suite(.serialized)
  @MainActor
  struct TransactionsStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    func ok(_ json: String) -> (Int, Data) { (200, Data(json.utf8)) }

    // MARK: Paging

    @Test func loadsPagesInOrderAndStopsAtTheLast() async throws {
      let c = client { r in
        (200, try TestData.ledgerPage(TestData.page(of: r) == 1 ? ["a", "b"] : ["c"], page: TestData.page(of: r), totalPages: 2, total: 3))
      }
      let store = TransactionsStore { c }
      await store.reload()
      #expect(store.rows.map(\.id) == ["a", "b"])
      #expect(store.total == 3)
      #expect(store.hasMore)
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a", "b", "c"])
      #expect(!store.hasMore)
      await store.loadMore()
      #expect(StubURLProtocol.requests.count == 2, "no request past the last page")
    }

    @Test func aRowRepeatedAcrossPagesAppearsOnce() async throws {
      let c = client { r in
        (200, try TestData.ledgerPage(TestData.page(of: r) == 1 ? ["a", "b"] : ["b", "c"], page: TestData.page(of: r), totalPages: 2))
      }
      let store = TransactionsStore { c }
      await store.reload()
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a", "b", "c"])
    }

    @Test func aFailedNextPageKeepsTheRowsAndOffersRetry() async throws {
      var failPage2 = true
      let c = client { r in
        let p = TestData.page(of: r)
        if p == 2 && failPage2 { throw URLError(.timedOut) }
        return (200, try TestData.ledgerPage(p == 1 ? ["a"] : ["b"], page: p, totalPages: 2))
      }
      let store = TransactionsStore { c }
      await store.reload()
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a"])
      #expect(store.loadMoreFailed)
      #expect(store.error == nil)
      failPage2 = false
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a", "b"])
      #expect(!store.loadMoreFailed)
    }

    @Test func aQueryChangeStartsOverAndSendsTheNewParameters() async throws {
      let c = client { r in
        let search = TestData.query(of: r, "search")
        return (200, try TestData.ledgerPage(search == nil ? ["a", "b"] : ["m"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.reload()
      var q = store.query
      q.search = "sample"
      await store.apply(q)
      #expect(store.rows.map(\.id) == ["m"])
      #expect(TestData.query(of: StubURLProtocol.requests.last!, "search") == "sample")
      await store.apply(q)
      #expect(StubURLProtocol.requests.count == 2, "applying the same query again does nothing")
    }

    @Test func aResponseForAnOlderQueryIsDiscarded() async throws {
      let c = client { r in
        if TestData.query(of: r, "search") == nil {
          Thread.sleep(forTimeInterval: 0.15)  // the older, slower query
          return (200, try TestData.ledgerPage(["old"], page: 1, totalPages: 1))
        }
        return (200, try TestData.ledgerPage(["new"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      let older = Task { await store.reload() }
      try await Task.sleep(for: .milliseconds(30))
      var q = store.query
      q.search = "x"
      await store.apply(q)
      await older.value
      #expect(store.rows.map(\.id) == ["new"])
    }

    @Test func firstPageFailureIsFullScreenLaterIsABanner() async throws {
      var fail = true
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        return (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.reload()
      #expect(store.error != nil)
      fail = false
      await store.reload()
      #expect(store.error == nil)
      fail = true
      await store.reload()
      #expect(store.rows.map(\.id) == ["a"])
      #expect(store.banner != nil)
    }

    @Test func reloadClearsIsLoadingMoreSoInFlightPageRequestsDontStickTheFlag() async throws {
      let c = client { r in
        if TestData.page(of: r) == 2 {
          Thread.sleep(forTimeInterval: 0.15)  // delay page 2 so reload can interrupt
        }
        return (200, try TestData.ledgerPage(TestData.page(of: r) == 1 ? ["a"] : ["b"], page: TestData.page(of: r), totalPages: 2))
      }
      let store = TransactionsStore { c }
      await store.reload()
      #expect(store.rows.map(\.id) == ["a"])
      let loading = Task { await store.loadMore() }
      try await Task.sleep(for: .milliseconds(30))
      #expect(store.isLoadingMore)
      await store.reload()
      await loading.value
      #expect(!store.isLoadingMore)
      await store.loadMore()
      #expect(store.rows.map(\.id) == ["a", "b"])
    }

    // MARK: Sync

    @Test func syncNamesFailedBanksThenReloads() async throws {
      let summary = #"{"summary":[{"itemId":"i1","institution":"Example Bank","success":false,"error":"ITEM_LOGIN_REQUIRED"},{"itemId":"i2","institution":"Example Invest","success":true,"skipped":true},{"itemId":"i3","institution":"Sample Card Co","success":true,"added":3}]}"#
      let c = client { r in
        r.httpMethod == "POST" ? (200, Data(summary.utf8)) : (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.sync()
      #expect(store.banner == "Couldn't sync Example Bank (ITEM_LOGIN_REQUIRED)")
      #expect(store.rows.map(\.id) == ["a"])
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["POST", "GET"])
      #expect(StubURLProtocol.requests[0].url?.path() == "/api/plaid/sync")
    }

    @Test func syncClearsABannerBeforeTheNetworkCall() async throws {
      var failGet = false
      let summary = #"{"summary":[]}"#
      let c = client { r in
        if r.httpMethod == "POST" {
          Thread.sleep(forTimeInterval: 0.15)  // delay sync POST to observe banner clearing
        } else if r.httpMethod == "GET" && failGet {
          throw URLError(.cannotConnectToHost)
        }
        return r.httpMethod == "POST" ? (200, Data(summary.utf8)) : (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.reload()
      #expect(store.rows.map(\.id) == ["a"])
      failGet = true
      await store.reload()
      #expect(store.banner != nil)  // set a banner with a failed reload
      failGet = false
      let syncing = Task { await store.sync() }
      try await Task.sleep(for: .milliseconds(30))
      #expect(store.banner == nil, "banner clears before sync starts")
      await syncing.value
      #expect(store.rows.map(\.id) == ["a"])
    }

    // MARK: Writes

    @Test func aWriteReloadsOnlyThePageHoldingTheRow() async throws {
      var afterWrite = false
      let c = client { r in
        if r.httpMethod == "PATCH" {
          afterWrite = true
          return (200, Data(#"{"ok":true,"userCategory":"Dining"}"#.utf8))
        }
        let p = TestData.page(of: r)
        if p == 1 { return (200, try TestData.ledgerPage(["a", "b"], page: 1, totalPages: 2)) }
        // Page 2 after the write no longer holds "c" (it now fails the filter).
        return (200, try TestData.ledgerPage(afterWrite ? ["d"] : ["c", "d"], page: 2, totalPages: 2))
      }
      let store = TransactionsStore { c }
      await store.reload()
      await store.loadMore()
      try await store.setCategory("c", .set("Dining", subcategory: nil))
      #expect(store.rows.map(\.id) == ["a", "b", "d"])
      let methodsAndPages = StubURLProtocol.requests.map { "\($0.httpMethod!) \(TestData.page(of: $0))" }
      #expect(methodsAndPages == ["GET 1", "GET 2", "PATCH 0", "GET 2"])
      let body = try #require(StubURLProtocol.body(of: StubURLProtocol.requests[2]))
      #expect(String(decoding: body, as: UTF8.self).contains(#""category":"Dining""#))
    }

    @Test func aRefusedWriteThrowsTheServersMessageAndChangesNothing() async throws {
      let c = client { r in
        if r.httpMethod == "POST" {
          return (400, Data(#"{"error":"A split amount must be greater than zero"}"#.utf8))
        }
        return (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1))
      }
      let store = TransactionsStore { c }
      await store.reload()
      await #expect(throws: APIError.server(status: 400, message: "A split amount must be greater than zero")) {
        try await store.addSplit("a", NewSplit(amount: 0, category: "Dining", subcategory: nil))
      }
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["GET", "POST"])
    }

    @Test func writeEndpoints() async throws {
      let c = client { r in
        if r.httpMethod == "GET" { return (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1)) }
        return (200, Data(#"{"ok":true}"#.utf8))
      }
      let store = TransactionsStore { c }
      await store.reload()
      try await store.setLink("a", label: 700)
      try await store.deleteSplit("a", splitId: "sp-1")
      let writes = StubURLProtocol.requests.filter { $0.httpMethod != "GET" }
      #expect(writes.map { "\($0.httpMethod!) \($0.url!.path())" } == [
        "PATCH /api/transactions/a", "DELETE /api/transactions/a/splits/sp-1",
      ])
      #expect(String(decoding: StubURLProtocol.body(of: writes[0])!, as: UTF8.self) == #"{"linkedToLabel":700}"#)
    }

    @Test func linkCandidatesDecode() async throws {
      let c = client { _ in
        (200, Data(#"{"candidates":[{"id":"p1","label":700,"date":"2026-09-01T12:00:00.000Z","name":"Sample Store","amount":60,"category":"Shopping"}]}"#.utf8))
      }
      let store = TransactionsStore { c }
      let candidates = try await store.linkCandidates("r1")
      #expect(candidates.map(\.label) == [700])
      #expect(StubURLProtocol.requests[0].url?.path() == "/api/transactions/r1/link-candidates")
    }

    // MARK: ProMode

    @Test func proModeReadsTheKeyThenTheLegacyKey() async throws {
      var values = ["pro-mode": #"{"value":null}"#, "analytics-mode": #"{"value":"pro"}"#]
      let c = client { r in (200, Data(values[TestData.query(of: r, "key")!]!.utf8)) }
      let mode = ProMode { c }
      #expect(!mode.isPro, "Normal until loaded")
      await mode.load()
      #expect(mode.isPro, "falls back to the legacy key")

      values["pro-mode"] = #"{"value":"normal"}"#
      await mode.load()
      #expect(!mode.isPro, "the current key wins when stored")

      values["pro-mode"] = #"{"value":{"odd":true}}"#
      await mode.load()
      #expect(!mode.isPro, "a stored non-string is Normal, not a fallback")
    }

    @Test func proModeKeepsItsValueWhenTheReadFails() async throws {
      var fail = false
      let c = client { _ in
        if fail { throw URLError(.timedOut) }
        return (200, Data(#"{"value":"pro"}"#.utf8))
      }
      let mode = ProMode { c }
      await mode.load()
      fail = true
      await mode.load()
      #expect(mode.isPro)
    }

    @Test func proModeHasLoadedOnlyAfterAFirstSuccessfulRead() async throws {
      var fail = true
      let c = client { _ in
        if fail { throw URLError(.timedOut) }
        return (200, Data(#"{"value":"pro"}"#.utf8))
      }
      let mode = ProMode { c }
      #expect(!mode.hasLoaded)
      await mode.load()
      #expect(!mode.hasLoaded, "a failed read never sets it")
      fail = false
      await mode.load()
      #expect(mode.hasLoaded)
    }

    // MARK: CategoryCatalog

    @Test func catalogMergesDeclaredAndSeenSubcategories() async throws {
      let json = try TestData.fixture("categories")
      let c = client { _ in (200, json) }
      let catalog = CategoryCatalog { c }
      await catalog.load()
      #expect(catalog.names == ["Groceries", "Dining"])
      catalog.noteUsed("Groceries > Bulk")
      catalog.noteUsed("Dining")
      catalog.noteUsed(nil)
      #expect(catalog.subcategories(of: "Groceries") == ["Bulk", "Organic"])
      #expect(catalog.subcategories(of: "Dining").isEmpty)
    }

    @Test func catalogRebuildsDeclaredSubsOnReloadButKeepsSessionNotedOnes() async throws {
      var json = try TestData.fixture("categories")
      let c = client { _ in (200, json) }
      let catalog = CategoryCatalog { c }
      await catalog.load()
      #expect(catalog.subcategories(of: "Groceries") == ["Organic"])

      catalog.noteUsed("Groceries > Bulk")
      #expect(catalog.subcategories(of: "Groceries") == ["Bulk", "Organic"])

      // Settings dropped "Organic": the next load must drop it too, but the
      // session-noted "Bulk" — this device saw a row using it — stays.
      json = try JSONSerialization.data(withJSONObject: [
        "categories": [
          ["name": "Groceries", "subcategories": []],
          ["name": "Dining", "subcategories": []],
        ]
      ])
      await catalog.load()
      #expect(catalog.subcategories(of: "Groceries") == ["Bulk"])
    }
  }
}
