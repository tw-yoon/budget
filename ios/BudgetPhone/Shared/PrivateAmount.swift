import SwiftUI

/// Hide Amounts: a tap on the Net Worth header turns every money figure in
/// the app into a grey "$••••••", one width for every amount so its size
/// doesn't show. Kept on this iPhone only; the web has no counterpart.
/// Editable amount fields stay readable.
enum AmountPrivacy {
  static let storageKey = "amounts.hidden"
  static let dots = "$••••••"

  /// Every dollar figure in `text` ("$1,234.56", "-$12.00", "+$3.50",
  /// "$1.2K") replaced, sign included; the words around it stay.
  static func mask(_ text: String, with replacement: String = dots) -> String {
    text.replacing(/[+\-−]?\$\d[\d,]*(?:\.\d+)?[KMBT]?/, with: replacement)
  }
}

/// A `Text` for anything holding a money figure. With Hide Amounts on, each
/// figure becomes dots in the secondary colour, so green/red can't give away
/// money in or out.
struct AmountText: View {
  let text: String
  /// False keeps this one readable without changing the view's structure.
  let isPrivate: Bool
  @AppStorage(AmountPrivacy.storageKey) private var stored = false

  init(_ text: String, isPrivate: Bool = true) {
    self.text = text
    self.isPrivate = isPrivate
  }

  var body: some View {
    if isPrivate && stored {
      // The inner style wins over any colour the caller sets outside.
      // Color.secondary, not .secondary: the hierarchical style would
      // still take the caller's green or red.
      Text(AmountPrivacy.mask(text))
        .foregroundStyle(Color.secondary)
        .accessibilityLabel(AmountPrivacy.mask(text, with: "hidden amount"))
    } else {
      Text(text)
    }
  }
}
