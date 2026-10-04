import SwiftUI

/// The web's chart colours (../src/lib/colors.ts), so a category is the
/// same colour on the phone as in the browser.
enum CategoryColors {
  static let income = "#22c55e"  // green — money in
  static let draw = "#ef4444"  // red — over / drawn from savings
  static let saved = "#3b82f6"  // blue — saved (surplus)
  static let hub = "#475569"  // slate — spent
  /// Phone-only: the Sankey's hub bar, a colour the flows can shade into
  /// (the web draws the hub grey).
  static let hubBar = "#93c5fd"  // light blue
  static let other = "#94a3b8"

  private static let palette = [
    "#6366f1", "#a855f7", "#ec4899", "#f97316", "#14b8a6",
    "#8b5cf6", "#eab308", "#06b6d4", "#db2777", "#0d9488",
    "#7c3aed", "#ca8a04", "#c084fc", "#64748b",
  ]

  private static let fixed: [String: String] = [
    "Food and Drink": "#6366f1",
    "General Merchandise": "#a855f7",
    "Travel": "#ec4899",
    "Transportation": "#f97316",
    "General Services": "#14b8a6",
    "Entertainment": "#8b5cf6",
    "Government and Non Profit": "#eab308",
    "Groceries": "#06b6d4",
    "Personal Care": "#db2777",
    "Medical": "#0d9488",
    "Rent and Utilities": "#7c3aed",
    "Loan Payments": "#ca8a04",
    "Dining": "#c084fc",
    "Home Improvement": "#0d9488",
  ]

  /// categoryColor: fixed map, else a hash of the UTF-16 code units
  /// (charCodeAt) into the palette.
  static func hex(for name: String) -> String {
    if name == "Other" || name == "Other income" { return other }
    if let hex = fixed[name] { return hex }
    var h: UInt32 = 0
    for unit in name.utf16 { h = h &* 31 &+ UInt32(unit) }
    return palette[Int(h % UInt32(palette.count))]
  }

  static func color(for name: String) -> Color { color(hex: hex(for: name)) }

  static func color(hex: String) -> Color {
    let v = UInt32(hex.dropFirst(), radix: 16) ?? 0
    return Color(
      red: Double((v >> 16) & 0xff) / 255,
      green: Double((v >> 8) & 0xff) / 255,
      blue: Double(v & 0xff) / 255)
  }

  /// `hex` mixed toward white by `amount` (0 = unchanged, 1 = white), as a
  /// hex string. Phone-only: the Sankey's subcategory bars.
  static func lighter(_ hex: String, by amount: Double) -> String {
    let v = UInt32(hex.dropFirst(), radix: 16) ?? 0
    let mix = { (c: UInt32) in UInt32((Double(c) + (255 - Double(c)) * amount).rounded()) }
    let r = mix((v >> 16) & 0xff), g = mix((v >> 8) & 0xff), b = mix(v & 0xff)
    return String(format: "#%02x%02x%02x", r, g, b)
  }
}
