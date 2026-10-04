import Foundation
import Observation

/// Accounts hidden on this phone. Kept in UserDefaults only: the server, the
/// web app and other devices still show every account.
@MainActor
@Observable
final class HiddenAccounts {
  static let key = "accounts.hidden"

  private(set) var ids: Set<String>
  private let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    ids = Set(defaults.stringArray(forKey: Self.key) ?? [])
  }

  func isHidden(_ id: String) -> Bool { ids.contains(id) }

  func setHidden(_ id: String, _ hidden: Bool) {
    if hidden { ids.insert(id) } else { ids.remove(id) }
    defaults.set(ids.sorted(), forKey: Self.key)
  }

  /// How many of these accounts are hidden. Ids of accounts the server no
  /// longer has (a disconnected bank) don't count.
  func count(in data: AccountsResponse) -> Int {
    data.groups.flatMap(\.accounts).filter { ids.contains($0.id) }.count
  }
}
