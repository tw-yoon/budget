import Foundation

/// The Accounts screen's figures with some accounts hidden on this phone.
/// The server's sums (`summarizeAccounts` in ../src/lib/account-totals.ts)
/// redone over the accounts that count: a group's subtotal is its counted
/// accounts' current balances, assets and liabilities split on
/// `isLiability`, net worth is their difference, and the totals are rounded
/// to the cent. An account counts unless it is hidden here or its bank is
/// disconnected; either way it can stay listed. With nothing hidden and
/// nothing disconnected, the server's own figures are returned untouched.
enum AccountTotals {
  struct Result: Equatable {
    let groups: [AccountGroup]
    let summary: AccountsSummary
  }

  /// `showHidden` keeps hidden rows in their groups (to unhide them); their
  /// balances stay out of every figure either way. Disconnected rows are
  /// always listed and never counted.
  static func visible(_ data: AccountsResponse, hidden: Set<String>, showHidden: Bool) -> Result {
    let all = data.groups.flatMap(\.accounts)
    guard all.contains(where: { hidden.contains($0.id) || $0.disconnected }) else {
      return Result(groups: data.groups, summary: data.summary)
    }
    let counts = { (a: AccountDTO) in !hidden.contains(a.id) && !a.disconnected }

    let groups = data.groups.compactMap { group -> AccountGroup? in
      let shown = showHidden ? group.accounts : group.accounts.filter { !hidden.contains($0.id) }
      guard !shown.isEmpty else { return nil }
      let subtotal =
        group.accounts.allSatisfy(counts)
        ? group.subtotal : group.accounts.filter(counts).reduce(0) { $0 + $1.currentBalance }
      return AccountGroup(
        type: group.type, label: group.label, subtotal: subtotal,
        isLiability: group.isLiability, accounts: shown)
    }

    let counted = all.filter(counts)
    let assets = counted.filter { !$0.isLiability }.reduce(0) { $0 + $1.currentBalance }
    let liabilities = counted.filter(\.isLiability).reduce(0) { $0 + $1.currentBalance }
    let summary = AccountsSummary(
      totalAssets: round(assets), totalLiabilities: round(liabilities),
      netWorth: round(assets - liabilities), accountCount: data.summary.accountCount,
      lastRefreshed: data.summary.lastRefreshed)
    return Result(groups: groups, summary: summary)
  }

  /// `Math.round(n * 100) / 100` — JavaScript rounds halves up, toward +∞.
  static func round(_ n: Double) -> Double {
    (n * 100 + 0.5).rounded(.down) / 100
  }
}
