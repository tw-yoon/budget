import SwiftUI

/// The ledger's search field, at the bottom in reach, as iOS 26's own apps
/// put search. Drawn here rather than with .searchable: the system's bottom
/// search sits behind AppTabBar, and RootView's room for the bar doesn't
/// reach a safeAreaInset inside the navigation stack. So it is placed from
/// the screen's bottom, just above the bar. It shrinks with the bar as one
/// picture: laid out over the full bar, then scaled by the bar's own scale
/// toward the bar's bottom centre, through the same spring, so it keeps the
/// bar's width and stays the same gap above it. It rides the keyboard up,
/// full size, while typing.
/// Its own view, so a shrink redraws only the field, not the ledger.
struct BottomSearchField: View {
  @Binding var text: String
  var isFocused: FocusState<Bool>.Binding

  /// Absent in previews.
  @Environment(TabBarState.self) private var tabBar: TabBarState?
  @AppStorage(AppTabBar.labelsKey) private var showsTabLabels = false
  @State private var keyboardUp = false

  /// The field's scale: the bar's, or full size over the keyboard.
  nonisolated static func scale(progress: CGFloat, showsLabels: Bool, keyboardUp: Bool) -> CGFloat {
    keyboardUp ? 1 : AppTabBar.scale(progress: progress, showsLabels: showsLabels)
  }

  /// Before scaling, from the bar's bottom to the field's bottom edge: the
  /// full bar plus the gap above it. Over the keyboard, just the gap.
  nonisolated static func lift(showsLabels: Bool, keyboardUp: Bool) -> CGFloat {
    guard !keyboardUp else { return AppTabBar.Metrics.clearance }
    let height = showsLabels ? AppTabBar.Metrics.labelledHeight : AppTabBar.Metrics.fullHeight
    return height + AppTabBar.Metrics.clearance
  }

  var body: some View {
    let progress = tabBar?.progress ?? 0
    field
      .padding(.bottom, Self.lift(showsLabels: showsTabLabels, keyboardUp: keyboardUp))
      .frame(maxHeight: .infinity, alignment: .bottom)
      // Anchored at the bar's bottom centre, as AppTabBar scales.
      .scaleEffect(
        Self.scale(progress: progress, showsLabels: showsTabLabels, keyboardUp: keyboardUp),
        anchor: .bottom)
      .animation(TabBarState.motion, value: progress)
      .padding(.bottom, keyboardUp ? 0 : AppTabBar.Metrics.bottomGap)
      .onGeometryChange(for: Bool.self) { $0.safeAreaInsets.bottom > 0 } action: { keyboardUp = $0 }
      .ignoresSafeArea(.container, edges: .bottom)
  }

  private var field: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
      TextField("Description or merchant", text: $text)
        .focused(isFocused)
        .submitLabel(.search)
        .autocorrectionDisabled()
      if !text.isEmpty {
        Button("Clear", systemImage: "xmark.circle.fill") { text = "" }
          .labelStyle(.iconOnly)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, 16)
    .frame(minHeight: 48)
    .glassEffect(.regular.interactive(), in: .capsule)
    .contentShape(.capsule)
    .onTapGesture { isFocused.wrappedValue = true }
    .padding(.horizontal, AppTabBar.Metrics.fullMargin)
  }
}
