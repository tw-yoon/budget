import Foundation

/// The Budget server's base URL, as typed by the user and saved on the phone.
/// Never compiled in: the server moves (this Mac today, an always-on laptop
/// later, a Tailscale address away from home) and the repo is public.
enum ServerAddress {
  static let storageKey = "serverURL"

  /// Trims whitespace and trailing slashes; nil unless it is an http(s) URL
  /// with a host.
  static func normalize(_ input: String) -> URL? {
    var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
    while s.hasSuffix("/") { s.removeLast() }
    guard let url = URL(string: s),
      let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
      let host = url.host(), !host.isEmpty
    else { return nil }
    return url
  }

  /// The saved server, if any.
  static func saved(in defaults: UserDefaults = .standard) -> URL? {
    defaults.string(forKey: storageKey).flatMap(normalize)
  }
}
