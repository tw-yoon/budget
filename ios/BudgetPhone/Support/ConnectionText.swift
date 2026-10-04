import Foundation

/// Settings → Connections' wording, ported from ../src/components/DebitCards.tsx
/// and ConnectedBanks.tsx. `macFooter` is the phone's own: Plaid Link stays
/// on the Mac.
enum ConnectionText {
  static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

  /// "2 accounts · id …abc123", led by "Disconnected Sep 30, 2026 · " once
  /// the bank is disconnected.
  static func bankLine(_ b: BankSummary, calendar: Calendar = .current) -> String {
    let line = "\(plural(b.accountCount, "account")) \u{00B7} id \u{2026}\(b.itemId.suffix(6))"
    guard let at = b.disconnectedAt.flatMap(Formatters.parseISO) else { return line }
    return "Disconnected \(Formatters.date(at, calendar: calendar)) \u{00B7} \(line)"
  }

  // The confirms below port ../src/lib/bank-actions.ts.

  static func disconnectTitle(_ b: BankSummary) -> String { "Disconnect \(b.institution)?" }

  static func disconnectMessage(_ b: BankSummary) -> String {
    "This revokes the Plaid connection, so nothing new comes in from this bank. "
      + "Its history is kept: \(plural(b.accountCount, "account")) and their transactions stay in this app, "
      + "left out of your totals."
  }

  /// The swipe action: "Delete" on a connected bank, "Delete History" on a
  /// disconnected one (the web's "Delete…" / "Delete History…").
  static func deleteAction(_ b: BankSummary) -> String {
    b.isDisconnected ? "Delete History" : "Delete"
  }

  static func deleteTitle(_ b: BankSummary) -> String {
    b.isDisconnected ? "Delete \(b.institution)'s history?" : "Delete \(b.institution)?"
  }

  static func deleteMessage(_ b: BankSummary) -> String {
    let accounts = plural(b.accountCount, "account")
    // A server that predates transactionCount: say "their transactions".
    let counts =
      b.transactionCount.map { "\(accounts) and \(plural($0, "transaction"))" }
      ?? "\(accounts) and their transactions"
    let rest = "\(counts), with their categories, splits and links. It cannot be undone."
    return b.isDisconnected
      ? "This removes everything this bank recorded in this app: \(rest)"
      : "This disconnects the bank and removes everything it recorded in this app: \(rest)"
  }

  /// "··0002 · draws from Everyday"
  static func cardLine(_ c: DebitCardDTO) -> String {
    "\u{00B7}\u{00B7}\(c.last4) \u{00B7} draws from \(c.accountName)"
  }

  static func removeTitle(_ c: DebitCardDTO) -> String {
    "Remove debit card \(c.name) \u{00B7}\u{00B7}\(c.last4)?"
  }

  /// "$1,450.00 available", or nil when the balance is unknown.
  static func available(_ c: DebitCardDTO) -> String? {
    c.available.map { "\(Formatters.currency($0)) available" }
  }

  static let noCards = "No debit cards yet."
  static let noChecking = "Connect a checking account first, then add the debit card linked to it."
  static let macFooter =
    "To connect a bank or investment account, or reconnect one, use Budget on your Mac."

  /// AddForm's `replace(/\D/g, "").slice(0, 4)`.
  static func cleanLast4(_ raw: String) -> String {
    String(raw.filter(\.isASCII).filter(\.isNumber).prefix(4))
  }

  /// The account picker's label: `displayName ?? name`.
  static func accountLabel(_ a: AccountDTO) -> String { a.displayName ?? a.name }
}
