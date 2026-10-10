import Foundation

enum AppVersion {
  /// This app's version (MARKETING_VERSION, which equals the web release's).
  static var current: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
  }

  /// "0.12.0" is newer than "0.11.0", part by part as numbers; a missing part is 0.
  static func isNewer(_ a: String, than b: String) -> Bool {
    let x = a.split(separator: ".").map { Int($0) ?? 0 }
    let y = b.split(separator: ".").map { Int($0) ?? 0 }
    for i in 0..<max(x.count, y.count) {
      let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
      if l != r { return l > r }
    }
    return false
  }
}
