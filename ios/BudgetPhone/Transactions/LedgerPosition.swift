import Foundation

/// The ledger row the list was scrolled to, kept per device so the next
/// launch reopens there. Phone-only; the web always opens at the top.
///
/// A row's place only means something for the list it was in, so the
/// position keeps the filters and sort it was taken under:
/// - it is never taken while a search is showing (search isn't kept across
///   launches, so that list can't come back);
/// - a change of search, filters or sort drops it (`kept(whenQueryBecomes:)`),
///   and nothing else does: with no row on screen (a transaction pushed over
///   the list) there is no position to take, and the kept one stays;
/// - a launch reopens there only on the same filters and sort, and only if
///   the row is among those the launch has loaded (the saved first page, or
///   the server's): the ledger never pages ahead to find it.
struct LedgerPosition: Codable, Equatable, Sendable {
  static let key = "transactions.position"

  /// The topmost row on screen.
  var id: String
  /// The filters and sort it was taken under, without the search.
  var query: TransactionQuery

  /// The position for `top`, the topmost visible row of `rows`. Nil — keep
  /// what is saved — when no row is on screen or under a search. At the top
  /// of the list it is the first row, which restores as the top.
  static func taken(top: String?, rows: [String], query: TransactionQuery) -> LedgerPosition? {
    guard let top, !query.hasSearch else { return nil }
    var kept = query
    kept.search = ""
    return LedgerPosition(id: top, query: kept)
  }

  /// The topmost of `rows` that is on screen.
  static func top(of rows: [String], visible: Set<String>) -> String? {
    rows.first { visible.contains($0) }
  }

  /// The position still worth keeping once the ledger shows `query`: only
  /// while the filters and sort are those it was taken under, with no search.
  static func kept(_ position: LedgerPosition?, whenQueryBecomes query: TransactionQuery) -> LedgerPosition? {
    guard let position, !query.hasSearch else { return nil }
    var bare = query
    bare.search = ""
    return bare == position.query ? position : nil
  }

  /// The row to scroll to on the first load: the kept one, when it was taken
  /// under `query` and `rows` (the rows loaded so far) hold it.
  static func restoreTarget(_ position: LedgerPosition?, query: TransactionQuery, rows: [String]) -> String? {
    guard let position = kept(position, whenQueryBecomes: query),
      position.id != rows.first, rows.contains(position.id)
    else { return nil }
    return position.id
  }

  /// What a visibility change saves: the position taken, or nothing (keep
  /// the saved one) when none could be taken.
  static func toSave(_ taken: LedgerPosition?) -> Data? {
    taken.map { encode($0) }
  }

  /// How long the list must rest before its position is kept, so scrolling
  /// doesn't write on every frame.
  static let settle: Duration = .milliseconds(800)

  static func decode(_ data: Data) -> LedgerPosition? {
    try? JSONDecoder().decode(LedgerPosition.self, from: data)
  }

  static func encode(_ position: LedgerPosition?) -> Data {
    position.flatMap { try? JSONEncoder().encode($0) } ?? Data()
  }
}
