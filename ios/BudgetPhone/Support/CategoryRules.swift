import Foundation

/// Settings → Categories' rules and wording, ported from
/// ../src/components/SettingsCategories.tsx. Strings are the web's, word for
/// word; `confirm()` texts are split into an alert title and message at the
/// web's first blank line.
enum CategoryRules {
  static let reservedNote =
    "\"Transfer\" controls how transactions are excluded from spending — it cannot be renamed or deleted"

  static let unmappedDetail =
    "Those transactions report under Plaid\u{2019}s own wording instead of one of your categories, and won\u{2019}t follow if you rename a category later."

  /// The web's `isReserved`: Transfer can't be renamed or deleted.
  static func isReserved(_ c: AdminCategory) -> Bool { c.name == "Transfer" }

  /// isResetOnly — nothing but renamed Plaid labels, so deleting it only
  /// resets their names.
  static func isResetOnly(_ s: AdminSubcategory) -> Bool {
    s.renamed && !s.declared && s.transactionCount + s.ruleCount == 0
  }

  /// isDeletable — a Plaid label under Plaid's own name can be renamed,
  /// not removed.
  static func isDeletable(_ s: AdminSubcategory) -> Bool {
    s.declared || s.renamed || s.transactionCount + s.ruleCount > 0
  }

  /// The web's `.trim()`, with blank meaning "send nothing".
  static func cleanName(_ raw: String) -> String? {
    let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : t
  }

  private static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

  /// The "Used by" cell: "9 tx (4 direct) · 1 rule · 1 split".
  static func usage(_ c: AdminCategory) -> String {
    var tx = "\(c.resolvedTransactionCount) tx"
    if c.resolvedTransactionCount != c.transactionCount { tx += " (\(c.transactionCount) direct)" }
    return "\(tx) · \(plural(c.ruleCount, "rule")) · \(plural(c.splitCount, "split"))"
  }

  /// A subcategory row's "Used by" cell: "5 tx (2 direct) · 1 rule".
  static func usage(_ s: AdminSubcategory) -> String {
    var tx = "\(s.transactionCount + s.plaidTransactionCount) tx"
    if s.plaidTransactionCount > 0 && s.transactionCount > 0 { tx += " (\(s.transactionCount) direct)" }
    return "\(tx) · \(plural(s.ruleCount, "rule"))"
  }

  /// The sky-blue badge: nil, "Plaid", or "Plaid: Groceries, …" once renamed.
  static func plaidBadge(_ s: AdminSubcategory) -> String? {
    guard !s.plaidLabels.isEmpty else { return nil }
    return s.renamed ? "Plaid: " + s.plaidLabels.map(\.name).joined(separator: ", ") : "Plaid"
  }

  static func unmappedHeadline(_ u: [UnmappedPrimary]) -> String {
    let list = u.map { "\(Formatters.humanizePfc($0.pfcPrimary)) (\($0.transactionCount))" }
      .joined(separator: ", ")
    return "\(u.count) Plaid label\(u.count == 1 ? "" : "s") not mapped to a category: \(list)."
  }

  static func deleteTitle(_ name: String) -> String { "Delete \"\(name)\"?" }

  static func deleteMessage(_ c: AdminCategory) -> String? {
    let declared = c.subcategories.filter(\.declared).count
    guard declared > 0 else { return nil }
    return "Its \(declared) subcategor\(declared == 1 ? "y" : "ies") will go too."
  }

  static func deleteSubTitle(category: String, sub: String) -> String {
    "Delete \"\(category) > \(sub)\"?"
  }

  static func deleteSubMessage(category: String, _ s: AdminSubcategory) -> String? {
    var parts: [String] = []
    if s.transactionCount + s.ruleCount > 0 {
      parts.append(
        "\(s.transactionCount) transaction(s) and \(s.ruleCount) rule(s) using it will fall back to \"\(category)\".")
    }
    if s.renamed { parts.append("Plaid labels renamed to \"\(s.name)\" go back to Plaid's name.") }
    return parts.isEmpty ? nil : parts.joined(separator: "\n\n")
  }

  /// A delete refused because the category is in use.
  static func stillUsed(transactions: Int, rules: Int, mappings: Int, splits: Int) -> String {
    "Still used by \(transactions) transaction(s), \(rules) rule(s), \(mappings) Plaid label(s) and \(splits) split(s) — rename this category onto another one to merge them first."
  }

  private static func splitsNote(_ n: Int?) -> String {
    guard let n, n > 0 else { return "" }
    return " and \(n) split(s)"
  }

  /// A rename's notice, for a category or a subcategory.
  static func renameNotice(_ r: RenameResult, to name: String) -> String {
    r.merged
      ? "Merged into \"\(name)\" — \(r.movedTransactions) transaction(s)\(splitsNote(r.movedSplits)) moved."
      : "Renamed — \(r.movedTransactions) transaction(s)\(splitsNote(r.movedSplits)) updated."
  }

  static func subDeleteNotice(_ r: SubcategoryDeleteResult, category: String) -> String? {
    if r.movedTransactions > 0 || r.movedSplits > 0 {
      return "Deleted — \(r.movedTransactions) transaction(s)\(splitsNote(r.movedSplits)) moved back to \"\(category)\"."
    }
    return r.resetPlaidLabels > 0 ? "Back to Plaid's name." : nil
  }

  static func mergeTitle(from name: String, _ p: MergePrompt) -> String {
    "Merge \"\(name)\" into \"\(p.targetName)\"?"
  }

  /// A category merge. `movingResolved` already includes the direct count.
  static func mergeMessage(from name: String, _ p: MergePrompt) -> String {
    "\(p.movingResolved ?? p.movingTransactions) transaction(s)\(splitsNote(p.movingSplits)) will report as \"\(p.targetName)\" instead, and \"\(name)\" will be removed."
  }

  static func subMergeMessage(category: String, _ p: MergePrompt) -> String {
    "\(p.movingTransactions) transaction(s) and \(p.movingRules) rule(s) will move to \"\(category) > \(p.targetName)\"."
  }
}
