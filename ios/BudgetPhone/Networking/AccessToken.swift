import Foundation
import Security

/// Where the server's access token is kept. A protocol so tests use memory,
/// not the Keychain.
protocol TokenStore: Sendable {
  func read() -> String?
  func write(_ token: String?)
}

/// The server's access token, pasted once from the Mac's web Settings →
/// Remote Access. Never compiled in, never in UserDefaults.
/// docs/superpowers/specs/2026-10-03-server-auth-token-design.md
enum AccessToken {
  nonisolated(unsafe) static var store: any TokenStore = KeychainTokenStore()

  /// Trims whitespace; nil when nothing is left.
  static func normalize(_ input: String) -> String? {
    let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? nil : s
  }

  static func saved() -> String? { store.read() }

  static func save(_ input: String?) { store.write(input.flatMap(normalize)) }
}

/// A generic password item, readable after first unlock so background
/// reloads work.
struct KeychainTokenStore: TokenStore {
  var service = Bundle.main.bundleIdentifier ?? "BudgetPhone"
  var account = "accessToken"

  private var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service,
     kSecAttrAccount as String: account]
  }

  func read() -> String? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  func write(_ token: String?) {
    SecItemDelete(query as CFDictionary)
    guard let token else { return }
    var q = query
    q[kSecValueData as String] = Data(token.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(q as CFDictionary, nil)
  }
}

/// For tests and previews.
final class MemoryTokenStore: TokenStore, @unchecked Sendable {
  private let lock = NSLock()
  private var value: String?
  init(_ value: String? = nil) { self.value = value }
  func read() -> String? { lock.withLock { value } }
  func write(_ token: String?) { lock.withLock { value = token } }
}
