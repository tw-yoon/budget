import SwiftUI

/// The ledger's search (BottomSearchField), placed by TransactionsView over
/// every segment rather than by LedgerView. It holds its own text, so a
/// keystroke redraws only the field, not every ledger row; the ledger hears
/// of it once typing pauses. On Venmo and Zelle it fades out, keeping what
/// was typed.
struct LedgerSearchField: View {
  let store: TransactionsStore
  let shown: Bool
  /// The field's height, for the ledger's room under its last row.
  @Binding var height: CGFloat

  @State private var text = ""
  @FocusState private var focused: Bool

  var body: some View {
    BottomSearchField(text: $text, isFocused: $focused, height: $height)
      .opacity(shown ? 1 : 0)
      .allowsHitTesting(shown)
      .accessibilityHidden(!shown)
      // The switcher changes segment with animations off; the fade is the
      // field's alone, as SwitcherBar's buttons.
      .transaction(value: shown) { t in
        t.disablesAnimations = false
        t.animation = .easeInOut(duration: 0.2)
      }
      .onChange(of: shown) { if !shown { focused = false } }
      // Debounced: a new keystroke cancels the pending query.
      .task(id: text) {
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        var q = store.query
        q.search = text
        await store.apply(q)
      }
  }
}
