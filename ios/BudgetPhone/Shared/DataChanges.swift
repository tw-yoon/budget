import Observation

/// Tells the other tabs their data may be out of date. Settings bumps
/// `categoriesVersion` after a change that rewrites transaction categories (a
/// category edit, Apply Now, Use Rule for These): Activity and Analytics
/// reload. It bumps `accountsVersion` after a bank is disconnected, which
/// removes its accounts and transactions: Accounts, Activity and Analytics
/// reload (GET only, never Plaid). Owned by RootView, so Settings and the
/// tabs share one copy.
@MainActor
@Observable
final class DataChanges {
  private(set) var categoriesVersion = 0

  func categoriesChanged() { categoriesVersion += 1 }

  private(set) var accountsVersion = 0

  func accountsChanged() { accountsVersion += 1 }
}
