import Foundation
import Testing
@testable import BudgetPhone

struct LoadTimesTests {
  func entry(_ path: String, request: Double, server: Double? = nil, reading: Double = 0) -> LoadTime {
    LoadTime(date: .now, path: path, request: request, server: server, reading: reading)
  }

  @Test func readsTheServersDurationFromItsHeader() {
    #expect(LoadTimes.serverMilliseconds("app;dur=12.3") == 12.3)
    #expect(LoadTimes.serverMilliseconds("db;dur=4, app;desc=\"x\";dur=7") == 7)
    #expect(LoadTimes.serverMilliseconds("db;dur=4") == nil)
    #expect(LoadTimes.serverMilliseconds(nil) == nil)
  }

  @Test func networkIsTheRequestLessTheServerNeverBelowZero() {
    #expect(entry("api/x", request: 200, server: 20, reading: 5).network == 180)
    #expect(entry("api/x", request: 200, server: 20, reading: 5).total == 205)
    #expect(entry("api/x", request: 10, server: 20).network == 0)
    #expect(entry("api/x", request: 10).network == nil)
  }

  @Test func keepsTheNewestFifty() {
    let times = LoadTimes()
    for i in 0..<60 { times.record(entry("api/\(i)", request: Double(i))) }
    #expect(times.all.count == LoadTimes.limit)
    #expect(times.all.first?.path == "api/59")
    #expect(times.all.last?.path == "api/10")
  }

  @Test func summarisesByScreenSlowestMedianFirst() {
    let rows = LoadTimeSummary.byPath([
      entry("api/accounts", request: 10), entry("api/accounts", request: 30),
      entry("api/transactions", request: 100), entry("api/transactions", request: 300),
      entry("api/transactions", request: 200),
    ])
    #expect(rows == [
      .init(path: "transactions", count: 3, median: 200),
      .init(path: "accounts", count: 2, median: 20),
    ])
  }

  @Test func countsLoadsInTheSingularToo() {
    #expect(LoadTimeSummary.loads(1) == "1 load")
    #expect(LoadTimeSummary.loads(3) == "3 loads")
  }

  @Test func partsNameWhereTheTimeWent() {
    #expect(LoadTimeSummary.parts(entry("api/x", request: 200.4, server: 20, reading: 5))
      == "Server 20 · Network 180 · Reading 5 ms")
    #expect(LoadTimeSummary.parts(entry("api/x", request: 200, reading: 5)) == "Request 200 · Reading 5 ms")
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  struct LoadTimesNetworkTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    @Test func aScreenLoadIsRecordedWithTheServersShare() async throws {
      let times = LoadTimes()
      let session = StubURLProtocol.session { _ in (200, try TestData.ledgerPage(["a"], page: 1, totalPages: 1)) }
      StubURLProtocol.headers = ["Server-Timing": "app;dur=9.5"]
      let c = APIClient(baseURL: base, session: session, loadTimes: times)
      _ = try await c.transactions(TransactionQuery(), page: 1)
      let e = try #require(times.all.first)
      #expect(times.all.count == 1)
      #expect(e.path == "api/transactions")
      #expect(e.server == 9.5)
      #expect(e.request > 0)
    }

    @Test func aFailedLoadIsNotRecorded() async {
      let times = LoadTimes()
      let session = StubURLProtocol.session { _ in (500, Data(#"{"error":"Nope"}"#.utf8)) }
      let c = APIClient(baseURL: base, session: session, loadTimes: times)
      await #expect(throws: APIError.server(status: 500, message: "Nope")) {
        try await c.transactions(TransactionQuery(), page: 1)
      }
      #expect(times.all.isEmpty)
    }
  }
}
