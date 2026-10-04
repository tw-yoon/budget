import Foundation

// Ports of the web helpers the ledger's display rules depend on. Each keeps
// its web name in a comment so the two can be compared side by side.

enum Ledger {
  /// format.ts formatSignedAmount. Plaid's amount is positive for money out;
  /// the ledger flips it to the natural sign, and money in gets a "+".
  static func signedAmount(_ amount: Double) -> (text: String, isOutflow: Bool) {
    let display = -amount
    let sign = display > 0 ? "+" : ""
    return (sign + Formatters.currency(display), amount > 0)
  }

  /// zelle.ts isZelleName: `/^(ref\s+)?zelle\b.*\b(pmt|payment)\b/i`.
  static func isZelleName(_ name: String) -> Bool {
    name.range(of: #"^(ref\s+)?zelle\b.*\b(pmt|payment)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
  }

  /// TransactionTable.tsx isSplittable — `validateNewSplit`'s first two
  /// refusals: only a posted purchase can be split.
  static func isSplittable(amount: Double, pending: Bool) -> Bool {
    amount > 0 && !pending
  }

  /// TransactionTable.tsx categoryOptionsFor: the user's list plus whatever
  /// the row already shows, so nothing gets orphaned. Sorted.
  static func categoryOptions(_ categories: [String], current: String, plaid: String) -> [String] {
    Set(categories).union([current, plaid]).sorted { $0.localizedCompare($1) == .orderedAscending }
  }

  /// splits.ts validateNewSplit's amount check, mirrored client-side so the
  /// Add control is disabled exactly where the server would refuse it. The
  /// half-cent tolerance is the web's `CENT`.
  static func splitFitsWhatIsLeft(_ amount: Double, left: Double) -> Bool {
    amount <= left + 0.005
  }
}

/// categories.ts: a category value is "Parent" or "Parent > Sub".
enum CategoryPath {
  static let separator = " > "

  /// splitCategory.
  static func split(_ value: String) -> (parent: String, sub: String?) {
    guard let range = value.range(of: separator) else { return (value, nil) }
    let parent = value[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
    let sub = value[range.upperBound...].trimmingCharacters(in: .whitespaces)
    return (parent, sub.isEmpty ? nil : sub)
  }

  /// joinCategory.
  static func join(_ parent: String, _ sub: String?) -> String {
    let s = sub?.trimmingCharacters(in: .whitespaces) ?? ""
    return s.isEmpty ? parent : parent + separator + s
  }
}
