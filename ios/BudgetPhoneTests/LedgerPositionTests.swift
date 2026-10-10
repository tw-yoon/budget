import Foundation
import Testing
@testable import BudgetPhone

/// The ledger's kept row: when it is taken, kept, dropped and restored.
struct LedgerPositionTests {
  let rows = ["t1", "t2", "t3", "t4"]

  var linked: TransactionQuery {
    var q = TransactionQuery()
    q.showLinked = true
    return q
  }

  func searching(_ text: String, _ base: TransactionQuery = TransactionQuery()) -> TransactionQuery {
    var q = base
    q.search = text
    return q
  }

  // MARK: Taking

  @Test func theTopmostVisibleRowInListOrderIsTheTop() {
    #expect(LedgerPosition.top(of: rows, visible: ["t4", "t2", "t3"]) == "t2")
    #expect(LedgerPosition.top(of: rows, visible: []) == nil)
  }

  @Test func aPositionKeepsTheRowAndTheFiltersItWasTakenUnder() {
    let p = LedgerPosition.taken(top: "t3", rows: rows, query: linked)
    #expect(p == LedgerPosition(id: "t3", query: linked))
  }

  @Test func atTheTopOfTheListTheFirstRowIsKeptAndRestoresAsTheTop() {
    let p = LedgerPosition.taken(top: "t1", rows: rows, query: TransactionQuery())
    #expect(p == LedgerPosition(id: "t1", query: TransactionQuery()))
    #expect(LedgerPosition.restoreTarget(p, query: TransactionQuery(), rows: rows) == nil)
  }

  @Test func withNoRowOnScreenTheSavedPositionIsLeftAlone() {
    // A transaction pushed over the list: every row reports invisible.
    let top = LedgerPosition.top(of: rows, visible: [])
    let p = LedgerPosition.taken(top: top, rows: rows, query: TransactionQuery())
    #expect(p == nil)
    #expect(LedgerPosition.toSave(p) == nil, "nothing is written, so the kept row survives")
  }

  @Test func aVisiblePositionIsSaved() {
    let p = LedgerPosition(id: "t3", query: TransactionQuery())
    #expect(LedgerPosition.toSave(p).flatMap(LedgerPosition.decode) == p)
  }

  @Test func nothingIsTakenUnderASearch() {
    #expect(LedgerPosition.taken(top: "t3", rows: rows, query: searching("sample")) == nil)
  }

  @Test func whitespaceIsNotASearch() {
    let p = LedgerPosition.taken(top: "t3", rows: rows, query: searching("  "))
    #expect(p?.query == TransactionQuery())
  }

  // MARK: Dropping on a query change

  @Test func theSameFiltersKeepThePosition() {
    let p = LedgerPosition(id: "t3", query: linked)
    #expect(LedgerPosition.kept(p, whenQueryBecomes: linked) == p)
  }

  @Test func aSearchDropsThePosition() {
    let p = LedgerPosition(id: "t3", query: TransactionQuery())
    #expect(LedgerPosition.kept(p, whenQueryBecomes: searching("sample")) == nil)
  }

  @Test func otherFiltersOrSortDropThePosition() {
    let p = LedgerPosition(id: "t3", query: TransactionQuery())
    var account = TransactionQuery()
    account.accountId = "acct-1"
    var bySort = TransactionQuery()
    bySort.sort = .label
    var ascending = TransactionQuery()
    ascending.ascending = true
    var internalShown = TransactionQuery()
    internalShown.hideInternal = false
    for q in [linked, account, bySort, ascending, internalShown] {
      #expect(LedgerPosition.kept(p, whenQueryBecomes: q) == nil)
    }
  }

  // MARK: Restoring

  @Test func restoresWhenTheLoadedRowsHoldTheKeptRow() {
    let p = LedgerPosition(id: "t3", query: TransactionQuery())
    #expect(LedgerPosition.restoreTarget(p, query: TransactionQuery(), rows: rows) == "t3")
  }

  @Test func startsAtTheTopWhenTheKeptRowIsNotLoaded() {
    let p = LedgerPosition(id: "t99", query: TransactionQuery())
    #expect(LedgerPosition.restoreTarget(p, query: TransactionQuery(), rows: rows) == nil)
  }

  @Test func startsAtTheTopWhenTheFiltersDiffer() {
    let p = LedgerPosition(id: "t3", query: TransactionQuery())
    #expect(LedgerPosition.restoreTarget(p, query: linked, rows: rows) == nil)
  }

  @Test func startsAtTheTopWithNothingKept() {
    #expect(LedgerPosition.restoreTarget(nil, query: TransactionQuery(), rows: rows) == nil)
    #expect(LedgerPosition.restoreTarget(nil, query: TransactionQuery(), rows: []) == nil)
  }

  @Test func theFirstRowNeedsNoScroll() {
    let p = LedgerPosition(id: "t1", query: TransactionQuery())
    #expect(LedgerPosition.restoreTarget(p, query: TransactionQuery(), rows: rows) == nil)
  }

  @Test func survivesASaveAndRead() {
    let p = LedgerPosition(id: "t3", query: linked)
    #expect(LedgerPosition.decode(LedgerPosition.encode(p)) == p)
    #expect(LedgerPosition.encode(nil).isEmpty)
    #expect(LedgerPosition.decode(Data()) == nil)
    #expect(LedgerPosition.decode(Data("junk".utf8)) == nil)
  }
}
