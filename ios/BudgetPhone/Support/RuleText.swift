import Foundation

/// Settings → Rules' labels and wording, ported from
/// ../src/components/RulesDashboard.tsx and ../src/lib/rules.ts. The phone
/// names its buttons in title case ("Apply Now", "Use Rule for These"), so
/// the strings that mention them do too.
enum RuleText {
  /// RULE_FIELDS and RULE_MATCH_TYPES, in the web's order.
  static let fields = ["MERCHANT", "NAME", "EITHER"]
  static let matchTypes = ["CONTAINS", "EQUALS", "STARTS_WITH", "REGEX"]

  /// FIELD_LABELS; an unknown code shows as itself.
  static func fieldLabel(_ field: String) -> String {
    switch field {
    case "MERCHANT": "Merchant"
    case "NAME": "Description"
    case "EITHER": "Merchant or description"
    default: field
    }
  }

  /// MATCH_TYPE_LABELS; an unknown code shows as itself.
  static func matchLabel(_ matchType: String) -> String {
    switch matchType {
    case "CONTAINS": "contains"
    case "EQUALS": "equals"
    case "STARTS_WITH": "starts with"
    case "REGEX": "matches regex"
    default: matchType
    }
  }

  /// plural — "1 transaction", "2 transactions".
  static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

  /// The row's outcome line.
  static func outcomeLine(_ o: RuleDTO.Outcome) -> String {
    let matched = o.applied + o.pending + o.handSet
    if matched == 0 { return "No matching transactions yet" }
    var parts: [String] = []
    if o.applied > 0 { parts.append("\(o.applied) set by this rule") }
    if o.pending > 0 { parts.append("\(o.pending) waiting for Apply Now") }
    if o.handSet > 0 { parts.append("\(o.handSet) set by hand (kept)") }
    return "Matches \(matched): " + parts.joined(separator: " \u{00B7} ")
  }

  /// applyNow's message.
  static func applyNotice(_ r: ApplyResult) -> String {
    var s = "Re-categorized \(plural(r.updated, "transaction"))."
    if r.kept > 0 {
      s += " \(plural(r.kept, "matching transaction")) set by hand \(r.kept == 1 ? "was" : "were") kept."
    }
    return s
  }

  /// takeOver's confirm(), split at its blank line into title and message.
  static func takeOverTitle(count: Int, pattern: String, category: String) -> String {
    "Replace the category you set by hand on \(plural(count, "transaction")) matching \"\(pattern)\" with \"\(category)\"?"
  }

  static let takeOverMessage = "They'll follow this rule from then on."

  static func takeOverNotice(pattern: String, updated: Int) -> String {
    "\"\(pattern)\" now sets \(plural(updated, "more transaction"))."
  }

  /// Row.patch's failure notice.
  static let updateFailed = "Failed to update the rule."

  /// The web's amber explainer, as the list's footer.
  static let footer =
    "Rules run top-to-bottom on each sync; the first match wins. They never overwrite a category you set by hand or one from Venmo, unless you tap Use Rule for These on a rule. Set a rule's category to Transfer to exclude matching transactions from spending. Tap Apply Now to run them over existing transactions."

  /// TargetPicker's names: a category the rule already names stays
  /// selectable even if it has since left the list, so opening the editor
  /// never silently changes it.
  static func categoryOptions(_ names: [String], current: String) -> [String] {
    current.isEmpty || names.contains(current) ? names : [current] + names
  }
}
