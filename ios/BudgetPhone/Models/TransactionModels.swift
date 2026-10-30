import Foundation

// Mirrors of src/types/index.ts for the Transactions area. Property names
// match the JSON keys; dates stay ISO strings, as in the web code.

struct LinkedTargetDTO: Codable, Equatable, Sendable {
  let id: String
  let label: Int?
  let name: String
  let category: String
}

struct RefundDTO: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let label: Int?
  let date: String
  let amount: Double  // negative (money in)
  let name: String
}

struct SplitPartDTO: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let amount: Double  // positive
  let category: String
  let subcategory: String?
  let userCategory: String
}

struct CashoutBreakdown: Codable, Equatable, Sendable {
  struct Slice: Codable, Equatable, Sendable {
    let category: String
    let amount: Double
  }
  let slices: [Slice]
  let priorBalance: Double
}

/// The fields an instant edit changes on screen (TransactionsStore) are
/// `var`; the rest stay as the server sent them.
struct TransactionDTO: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let externalId: String
  let accountId: String
  let accountName: String
  let accountMask: String?
  let amount: Double  // Plaid's sign: positive = money out
  let date: String
  let name: String
  let merchantName: String?
  var category: String
  var categoryDetailed: String?
  var userCategory: String?
  let plaidCategory: String
  let plaidCategoryDetailed: String?
  let logoUrl: String?
  let pending: Bool
  let isTransfer: Bool
  let isFee: Bool
  let personalNote: String?
  var flagged: Bool
  let source: String  // PLAID | VENMO
  let label: Int?
  var linkedTo: LinkedTargetDTO?
  let refunds: [RefundDTO]
  let netAmount: Double
  var splits: [SplitPartDTO]
  var splitRemainder: Double?
  let breakdown: CashoutBreakdown?
}

struct TransactionsResponse: Codable, Equatable, Sendable {
  let transactions: [TransactionDTO]
  let page: Int
  let limit: Int
  let total: Int
  let totalPages: Int
}

/// POST /api/plaid/sync.
struct SyncResult: Decodable, Equatable, Sendable {
  struct Item: Decodable, Equatable, Sendable {
    let itemId: String
    let institution: String
    let success: Bool
    let error: String?
    let skipped: Bool?
  }
  let summary: [Item]
}

/// GET /api/transactions/:id/link-candidates.
struct LinkCandidate: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let label: Int?
  let date: String
  let name: String
  let amount: Double
  let category: String
}

struct LinkCandidatesResponse: Decodable, Sendable {
  let candidates: [LinkCandidate]
}

/// GET /api/categories. Only the names are used here; the counts and Plaid
/// mappings are for the Settings screen.
struct CategoriesResponse: Decodable, Sendable {
  struct Category: Decodable, Sendable {
    struct Sub: Decodable, Sendable { let name: String }
    let name: String
    let subcategories: [Sub]
  }
  let categories: [Category]
}

// MARK: - Row rules

extension TransactionDTO {
  var title: String { merchantName ?? name }
  var isSplittable: Bool { Ledger.isSplittable(amount: amount, pending: pending) }
  var isMoneyIn: Bool { amount < 0 }

  /// The web's category line: "Parent > Sub", the sub being the user's or
  /// else Plaid's detailed category.
  var categoryLabel: String {
    if let raw = userCategory {
      let (parent, sub) = CategoryPath.split(raw)
      return sub.map { "\(parent) > \($0)" } ?? parent
    }
    return categoryDetailed.map { "\(category) > \($0)" } ?? category
  }

  /// The parent category the editor starts on.
  var editableCategory: String {
    userCategory.map { CategoryPath.split($0).parent } ?? category
  }

  var editableSubcategory: String? {
    userCategory.map { CategoryPath.split($0).sub } ?? categoryDetailed
  }

  /// The parts plus the leftover, when there is a leftover line to draw.
  var splitWays: Int { splits.count + (splitRemainder == nil ? 0 : 1) }

  /// AddSplitForm's `left`: what a new split may still take. The server's
  /// `splitRemainder` when there is one; otherwise the whole amount for an
  /// unsplit row, or nothing left when the row already has splits and
  /// `splitRemainder` came back null (fully allocated) — finding F-minor.
  var splitLeftToAllocate: Double { splitRemainder ?? (splits.isEmpty ? amount : 0) }

  /// The amount has shrunk below its splits since they were made.
  var splitIsShrunk: Bool { (splitRemainder ?? 0) < 0 }

  /// `#101 · Sep 23, 2026 · Sample Rewards Card ··0002`
  func detailLine(calendar: Calendar = .gregorianCurrent) -> String {
    var parts = ["#\(label.map(String.init) ?? "—")"]
    if let d = Formatters.parseISO(date) { parts.append(Formatters.date(d, calendar: calendar)) }
    parts.append(accountName + (accountMask.map { " ··\($0)" } ?? ""))
    return parts.joined(separator: " · ")
  }

  enum BadgeTone: Equatable, Sendable { case violet, green, amber, slate }
  struct Badge: Equatable, Sendable {
    let text: String
    let tone: BadgeTone
  }

  /// RowBadges in TransactionTable.tsx, same order and wording.
  var badges: [Badge] {
    var b: [Badge] = []
    if source == "VENMO" { b.append(Badge(text: "Venmo", tone: .violet)) }
    if source != "VENMO" && Ledger.isZelleName(name) { b.append(Badge(text: "Zelle", tone: .violet)) }
    if let linkedTo { b.append(Badge(text: "→ #\(linkedTo.label.map(String.init) ?? "?")", tone: .green)) }
    if pending { b.append(Badge(text: "Pending", tone: .amber)) }
    if isTransfer && breakdown == nil { b.append(Badge(text: "Transfer", tone: .slate)) }
    if let breakdown { b.append(Badge(text: "\(breakdown.slices.count) categories", tone: .slate)) }
    if !splits.isEmpty {
      b.append(Badge(text: splitWays == 1 ? "Split 1 way" : "Split \(splitWays) ways",
                     tone: splitIsShrunk ? .amber : .slate))
    }
    if isFee { b.append(Badge(text: "Fee", tone: .slate)) }
    return b
  }
}

// MARK: - Instant edits

/// The row as the server will send it back after a write, so far as the row
/// itself can tell (route.ts's mapping). TransactionsStore shows it at once,
/// rolls it back if the write fails, and the page re-read then replaces it.
extension TransactionDTO {
  func withCategory(_ update: CategoryUpdate) -> TransactionDTO {
    var t = self
    t.userCategory = update.category.map { CategoryPath.join($0, update.subcategory) }
    return t.withEffectiveCategory()
  }

  /// Linked to `target`, or unlinked when nil. Linking drops the row's own
  /// category: the link owns it now (handleLink in route.ts).
  func withLink(_ target: TransactionDTO?) -> TransactionDTO {
    var t = self
    if target != nil { t.userCategory = nil }
    t.linkedTo = target.map {
      LinkedTargetDTO(id: $0.id, label: $0.label, name: $0.title,
                      category: $0.userCategory ?? $0.plaidCategory)
    }
    return t.withEffectiveCategory()
  }

  func withFlag(_ flagged: Bool) -> TransactionDTO {
    var t = self
    t.flagged = flagged
    return t
  }

  func withSplit(_ split: NewSplit) -> TransactionDTO {
    var t = self
    t.splits.append(SplitPartDTO(
      id: "pending-\(UUID().uuidString)", amount: split.amount, category: split.category,
      subcategory: split.subcategory, userCategory: CategoryPath.join(split.category, split.subcategory)))
    return t.withRemainder()
  }

  func withoutSplit(_ splitId: String) -> TransactionDTO {
    var t = self
    t.splits.removeAll { $0.id == splitId }
    return t.withRemainder()
  }

  /// resolveLinkedCategory: the override, else the linked purchase's, else Plaid's.
  private func withEffectiveCategory() -> TransactionDTO {
    var t = self
    if let raw = userCategory ?? linkedTo?.category {
      (t.category, t.categoryDetailed) = CategoryPath.split(raw)
    } else {
      (t.category, t.categoryDetailed) = (plaidCategory, plaidCategoryDetailed)
    }
    return t
  }

  /// remainderOf, shown only for a split row and above float noise.
  private func withRemainder() -> TransactionDTO {
    var t = self
    let left = AccountTotals.round(splits.reduce(amount) { $0 - $1.amount })  // roundToCents
    t.splitRemainder = !splits.isEmpty && abs(left) >= 0.005 ? left : nil
    return t
  }
}
