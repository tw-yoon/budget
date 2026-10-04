import SwiftUI

/// The two-level picker the row editor and the split sheet share — the web's
/// category <select> plus its subcategory datalist. "Other…" reveals a text
/// field for a subcategory not in the list yet.
struct CategoryFields: View {
  let options: [String]
  let knownSubs: (String) -> [String]
  @Binding var category: String
  @Binding var subcategory: String

  @State private var typingNew = false

  var body: some View {
    Picker("Category", selection: categorySelection) {
      ForEach(options, id: \.self) { Text($0).tag($0) }
    }

    let subs = knownSubs(category)
    Picker("Subcategory", selection: subSelection(subs)) {
      Text("None").tag("")
      ForEach(subs, id: \.self) { Text($0).tag($0) }
      Text("Other…").tag(Self.other)
    }
    if typingNew {
      TextField("New subcategory", text: $subcategory)
        .textInputAutocapitalization(.words)
    }
  }

  private static let other = "\u{0}other"

  /// Only the Picker's own binding setter fires on a user pick — a
  /// programmatic change to `category` (e.g. `TransactionDetailView.adopt`)
  /// never calls a Picker's `set`. That is what lets this reset the
  /// subcategory on a user choice without also wiping it when the screen
  /// merely loads the row's own "Parent > Sub" category (finding F1).
  private var categorySelection: Binding<String> {
    Binding(
      get: { category },
      set: { newValue in
        if Self.subcategoryShouldReset(from: category, to: newValue) {
          subcategory = ""
          typingNew = false
        }
        category = newValue
      })
  }

  /// Pure rule behind `categorySelection`'s setter, kept separate so it can
  /// be tested without driving a live Picker. `nonisolated` because `View`
  /// conformance would otherwise infer this static func onto the main actor.
  nonisolated static func subcategoryShouldReset(from oldCategory: String, to newCategory: String) -> Bool {
    oldCategory != newCategory
  }

  private func subSelection(_ subs: [String]) -> Binding<String> {
    Binding(
      get: {
        if typingNew { return Self.other }
        return subs.contains(subcategory) || subcategory.isEmpty ? subcategory : Self.other
      },
      set: { value in
        if value == Self.other {
          typingNew = true
          if subs.contains(subcategory) { subcategory = "" }
        } else {
          typingNew = false
          subcategory = value
        }
      })
  }
}
