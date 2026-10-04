import SwiftUI

/// cardArtColors (../src/lib/colors.ts): a card's placeholder gradient,
/// picked from its issuer's family by a hash of its own identity, so a card
/// always looks the same and reordering never repaints it.
enum CardArtColors {
  private static let palettes: [String: [(String, String)]] = [
    "AMEX": [("#4b6cb7", "#25355f"), ("#5b7fa6", "#2b3f52"), ("#8d99ae", "#434a55")],
    "CHASE": [("#1e4f8a", "#0f2747"), ("#2563eb", "#132f66"), ("#0f766e", "#0a3b37")],
    "DISCOVER": [("#e08a3c", "#7a451a"), ("#c2703a", "#5f3417")],
  ]
  private static let fallback = [("#3f3f46", "#18181b"), ("#475569", "#1e293b"), ("#57534e", "#1c1917")]

  static func hexes(issuer: String, seed: String) -> (from: String, to: String) {
    let family = palettes[issuer] ?? fallback
    var h: UInt32 = 0
    for unit in seed.utf16 { h = h &* 31 &+ UInt32(unit) }
    let pair = family[Int(h % UInt32(family.count))]
    return (pair.0, pair.1)
  }

  static func colors(issuer: String, seed: String) -> (from: Color, to: Color) {
    let pair = hexes(issuer: issuer, seed: seed)
    return (CategoryColors.color(hex: pair.from), CategoryColors.color(hex: pair.to))
  }
}
