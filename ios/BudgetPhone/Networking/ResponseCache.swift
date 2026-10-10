import CryptoKit
import Foundation

/// Last successful answers for the main screens' first loads, so a launch
/// shows them at once. docs/superpowers/specs/2026-10-04-ios-instant-launch-design.md
///
/// One folder per owner (server + token, hashed, so the token never reaches
/// disk), one file per screen name and request. A newer answer replaces the
/// older ones, and another owner's folders are dropped, so a changed server
/// or token never shows the previous one's data.
struct ResponseCache: Sendable {
  let root: URL

  static let shared = ResponseCache(
    root: (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory).appending(path: "Responses"))

  /// Money data: unreadable while the phone is locked.
  static let writeOptions: Data.WritingOptions = [.atomic, .completeFileProtection]

  func read(_ name: String, request: String, owner: String) -> Data? {
    removeOtherOwners(keeping: owner)
    return try? Data(contentsOf: file(name, request: request, owner: owner))
  }

  /// When the saved answer was written, or nil when there is none.
  func date(_ name: String, request: String, owner: String) -> Date? {
    let path = file(name, request: request, owner: owner).path
    return (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date
  }

  func write(_ data: Data, name: String, request: String, owner: String) {
    let folder = folder(owner)
    let target = file(name, request: request, owner: owner)
    let fm = FileManager.default
    try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
    guard (try? data.write(to: target, options: Self.writeOptions)) != nil else { return }
    let names = (try? fm.contentsOfDirectory(atPath: folder.path)) ?? []
    for other in names where other.hasPrefix("\(name)-") && other.hasSuffix(".json")
      && other != target.lastPathComponent
    {
      try? fm.removeItem(at: folder.appending(path: other))
    }
    removeOtherOwners(keeping: owner)
  }

  func clear() {
    try? FileManager.default.removeItem(at: root)
  }

  private func folder(_ owner: String) -> URL {
    root.appending(path: Self.hex(owner))
  }

  private func file(_ name: String, request: String, owner: String) -> URL {
    folder(owner).appending(path: "\(name)-\(Self.hex(request).prefix(16)).json")
  }

  private func removeOtherOwners(keeping owner: String) {
    let mine = Self.hex(owner)
    let fm = FileManager.default
    for other in (try? fm.contentsOfDirectory(atPath: root.path)) ?? [] where other != mine {
      try? fm.removeItem(at: root.appending(path: other))
    }
  }

  private static func hex(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}
