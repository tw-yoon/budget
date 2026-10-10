import Foundation
import Testing
@testable import BudgetPhone

private let feed = #"""
{"transactions":[
 {"id":"v1","label":801,"date":"2026-09-10T12:00:00.000Z","note":"dinner","counterparty":"Sample Friend","direction":"out","amount":40,"category":"Dining","linkedTo":null},
 {"id":"v2","label":802,"date":"2026-09-11T12:00:00.000Z","note":"","counterparty":null,"direction":"in","amount":15,"category":"Dining","linkedTo":null},
 {"id":"v3","label":803,"date":"2026-09-12T12:00:00.000Z","note":"rent share","counterparty":"Sample Roommate","direction":"out","amount":500,"category":"Transfer","linkedTo":null},
 {"id":"v4","label":null,"date":"2026-09-13T12:00:00.000Z","note":"?","counterparty":"Sample Person","direction":"in","amount":20,"category":"Uncategorized","linkedTo":null},
 {"id":"v5","label":805,"date":"2026-09-14T12:00:00.000Z","note":"tickets back","counterparty":"Sample Friend","direction":"in","amount":30,"category":"Concerts","linkedTo":{"id":"p9","label":650,"name":"Sample Tickets","category":"Concerts"}}
],"categories":["Uncategorized","Dining","Travel","Transfer"]}
"""#

struct P2PModelTests {
  func response() throws -> P2PResponse {
    try JSONDecoder().decode(P2PResponse.self, from: Data(feed.utf8))
  }

  @Test func totalsSkipUncategorizedAndTransfer() throws {
    let t = P2PTotals(try response().transactions)
    #expect(t.sent == 40)
    #expect(t.received == 45)
    #expect(t.net == -5)
  }

  @Test func signedAmountUsesARealMinus() throws {
    let rows = try response().transactions
    #expect(rows[0].signedAmount == "\u{2212}$40.00")
    #expect(rows[1].signedAmount == "+$15.00")
    #expect(rows[3].isIgnored)
  }

  @Test func importNotice() {
    #expect(P2PImportResult(imported: 12, reconciledCashouts: 1).notice == "Imported 12 payments · reconciled 1 cash-out.")
    #expect(P2PImportResult(imported: 3, reconciledCashouts: 2).notice == "Imported 3 payments · reconciled 2 cash-outs.")
    #expect(P2PImportResult(imported: 0, reconciledCashouts: 0).notice == "No statements found in your Downloads folder.")
  }

  @Test func dateLineHasNoTrailingSeparatorWhenTheDateFailsToParse() throws {
    let rows = try response().transactions
    #expect(rows[0].dateLine == "#801 · Sep 10, 2026")
    let broken = P2PTransaction(
      id: "x", label: 9, date: "not-a-date", note: "", counterparty: nil,
      direction: .out, amount: 1, category: "Dining", linkedTo: nil)
    #expect(broken.dateLine == "#9")
  }

  @Test func sources() {
    #expect(P2PSource.venmo.endpoint == "api/venmo")
    #expect(P2PSource.venmo.canImport)
    #expect(!P2PSource.zelle.canImport)
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct P2PStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func store(_ source: P2PSource = .venmo, _ handler: @escaping (URLRequest) throws -> (Int, Data)) -> P2PStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler))
      return P2PStore(source: source) { c }
    }

    @Test func optionsIncludeALinkedRowsInheritedCategory() async throws {
      let s = store { _ in (200, Data(feed.utf8)) }
      await s.load()
      let rows = try #require(s.data?.transactions)
      #expect(s.options(for: rows[0]) == ["Uncategorized", "Dining", "Travel", "Transfer"])
      #expect(s.options(for: rows[4]) == ["Uncategorized", "Dining", "Travel", "Transfer", "Concerts"])
    }

    @Test func aCategoryChangeShowsAtOnceAndSendsTheWebsBody() async throws {
      let s = store(.zelle) { r in
        r.httpMethod == "PATCH" ? (200, Data(#"{"ok":true}"#.utf8)) : (200, Data(feed.utf8))
      }
      await s.load()
      await s.setCategory("v1", to: "Travel")
      #expect(s.data?.transactions[0].category == "Travel")
      let patch = try #require(StubURLProtocol.requests.last)
      #expect(patch.url?.path() == "/api/zelle/v1")
      #expect(String(decoding: StubURLProtocol.body(of: patch)!, as: UTF8.self) == #"{"userCategory":"Travel"}"#)
    }

    @Test func aRefusedChangeShowsTheMessageAndReloads() async throws {
      let s = store { r in
        r.httpMethod == "PATCH" ? (400, Data(#"{"error":"Invalid category"}"#.utf8)) : (200, Data(feed.utf8))
      }
      await s.load()
      await s.setCategory("v1", to: "Nope")
      #expect(s.banner == "Invalid category")
      #expect(s.data?.transactions[0].category == "Dining", "the reload restores the server's value")
      #expect(StubURLProtocol.requests.map(\.httpMethod) == ["GET", "PATCH", "GET"])
    }

    @Test func aServerErrorWithNoBodyShowsTheFixedSentenceNotTheStatusText() async throws {
      let s = store { r in
        r.httpMethod == "PATCH" ? (400, Data(#"{}"#.utf8)) : (200, Data(feed.utf8))
      }
      await s.load()
      await s.setCategory("v1", to: "Nope")
      #expect(s.banner == "Failed to save category — reloading.")
      #expect(s.data?.transactions[0].category == "Dining", "the reload restores the server's value")
    }

    @Test func aConnectionErrorShowsTheFixedMessageAndReloads() async throws {
      let s = store { r in
        if r.httpMethod == "PATCH" {
          throw URLError(.cannotConnectToHost)
        }
        return (200, Data(feed.utf8))
      }
      await s.load()
      await s.setCategory("v1", to: "Nope")
      #expect(s.banner == "Failed to save category — reloading.")
      #expect(s.data?.transactions[0].category == "Dining", "the reload restores the server's value")
    }

    @Test func successfulLoadClearsABanner() async throws {
      let s = store { _ in (200, Data(feed.utf8)) }
      s.banner = "Something"
      await s.load()
      #expect(s.banner == nil)
    }

    @Test func runImportClearsABannerBeforeTheNetworkCall() async throws {
      let s = store { r in
        if r.httpMethod == "POST" {
          Thread.sleep(forTimeInterval: 0.1)
          return (200, Data(#"{"imported":2,"reconciledCashouts":0,"unmatchedCashouts":0,"accountHolder":""}"#.utf8))
        }
        return (200, Data(feed.utf8))
      }
      s.banner = "Old error"
      let task = Task {
        await s.runImport()
      }
      try await Task.sleep(for: .milliseconds(30))
      #expect(s.banner == nil, "banner clears before the network call completes")
      await task.value
    }

    @Test func importShowsTheNoticeAndReloads() async throws {
      let s = store { r in
        r.httpMethod == "POST"
          ? (200, Data(#"{"imported":4,"reconciledCashouts":1,"unmatchedCashouts":0,"accountHolder":""}"#.utf8))
          : (200, Data(feed.utf8))
      }
      await s.runImport()
      #expect(s.notice == "Imported 4 payments · reconciled 1 cash-out.")
      #expect(StubURLProtocol.requests.map { "\($0.httpMethod!) \($0.url!.path())" } == ["POST /api/venmo/import", "GET /api/venmo"])
    }

    // MARK: Haptics (SaveFeedback)

    @Test func aSavedCategoryIsASuccess() async {
      let s = store(.zelle) { r in
        r.httpMethod == "PATCH" ? (200, Data(#"{"ok":true}"#.utf8)) : (200, Data(feed.utf8))
      }
      await s.load()
      #expect(s.feedback == SaveFeedback(), "a load is not a save")
      await s.setCategory("v1", to: "Travel")
      #expect(s.feedback.successes == 1 && s.feedback.failures == 0)
    }

    @Test func aRefusedCategoryIsAFailure() async {
      let s = store { r in
        r.httpMethod == "PATCH" ? (400, Data(#"{"error":"Invalid category"}"#.utf8)) : (200, Data(feed.utf8))
      }
      await s.load()
      await s.setCategory("v1", to: "Nope")
      #expect(s.feedback.failures == 1 && s.feedback.successes == 0)
    }

    @Test func anImportIsASuccessAndAFailedOneAFailure() async {
      let s = store { r in
        r.httpMethod == "POST"
          ? (200, Data(#"{"imported":1,"reconciledCashouts":0,"unmatchedCashouts":0,"accountHolder":""}"#.utf8))
          : (200, Data(feed.utf8))
      }
      await s.runImport()
      #expect(s.feedback.successes == 1 && s.feedback.failures == 0)
      let failing = store { r in
        r.httpMethod == "POST" ? (500, Data(#"{"error":"Sample failure"}"#.utf8)) : (200, Data(feed.utf8))
      }
      await failing.runImport()
      #expect(failing.feedback.failures == 1 && failing.feedback.successes == 0)
    }

    @Test func zelleNeverImports() async throws {
      let s = store(.zelle) { _ in (200, Data(feed.utf8)) }
      await s.runImport()
      #expect(StubURLProtocol.requests.isEmpty)
    }
  }
}
