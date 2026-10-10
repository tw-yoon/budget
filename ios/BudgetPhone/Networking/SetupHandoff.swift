import Foundation

/// The server and token `scripts/phone.sh setup` hands the app on the launch
/// it starts, so a friend has nothing to type. It only fills an empty setup:
/// a server someone already saved is never replaced.
/// docs/superpowers/specs/2026-10-10-ios-phone-setup-design.md
enum SetupHandoff {
  static let serverKey = "BUDGET_SETUP_SERVER"
  static let tokenKey = "BUDGET_SETUP_TOKEN"

  static func apply(
    environment: [String: String],
    defaults: UserDefaults = .standard,
    tokens: any TokenStore = AccessToken.store
  ) {
    guard ServerAddress.saved(in: defaults) == nil,
      let url = environment[serverKey].flatMap(ServerAddress.normalize)
    else { return }
    defaults.set(url.absoluteString, forKey: ServerAddress.storageKey)
    tokens.write(environment[tokenKey].flatMap(AccessToken.normalize))
  }
}
