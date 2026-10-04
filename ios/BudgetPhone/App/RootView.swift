import SwiftUI

/// First launch asks for the server; after that, the tabs. Owns the shared
/// Normal / Pro setting, so the ledger and Settings share one copy. The
/// app's light or dark look simply follows the iPhone's own setting; the
/// web's theme setting is not read here.
struct RootView: View {
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @Environment(\.scenePhase) private var scenePhase
  @State private var proMode = ProMode(client: Self.client)
  /// The ledger's category pickers, shared with Settings → Categories, which
  /// reloads it after every change.
  @State private var catalog = CategoryCatalog(client: Self.client)
  /// Settings tells the Activity and Analytics tabs when transaction
  /// categories change.
  @State private var changes = DataChanges()
  @State private var benefits = BenefitsStore(client: Self.client)
  @State private var selected = AppTab.accounts
  @State private var tabBar = TabBarState()
  /// The bottom safe area: the home indicator, or the keyboard while it is up.
  @State private var bottomSafeArea: CGFloat = 0
  /// Settings → Accessibility → Tab Bar Labels.
  @AppStorage(AppTabBar.labelsKey) private var showsTabLabels = false

  static func client() -> APIClient? { APIClient.saved() }

  var body: some View {
    Group {
      if ServerAddress.normalize(server) == nil {
        ServerSetupView()
      } else {
        tabs
      }
    }
    // Re-read when the server changes, too: a new server has its own settings.
    .task(id: server) { await proMode.load() }
    // Early, so Benefits opens with its card faces already fetched.
    .task(id: server) { await benefits.load() }
    // Another device may have changed the mode meanwhile.
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      Task { await proMode.load() }
    }
  }

  /// Apple's TabView still hosts the tabs, so each loads when first opened
  /// and keeps its own navigation, but its bar is hidden: AppTabBar replaces
  /// it.
  private var tabs: some View {
    TabView(selection: $selected) {
      ForEach(AppTab.allCases, id: \.self) { tab in
        Tab(tab.title, systemImage: tab.systemImage, value: tab) {
          page(tab)
            .environment(\.appTab, tab)
            .toolbarVisibility(.hidden, for: .tabBar)
            .safeAreaInset(edge: .bottom, spacing: 0) {
              Color.clear.frame(
                height: AppTabBar.contentInset(bottomSafeArea: bottomSafeArea, showsLabels: showsTabLabels))
            }
        }
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.bottom } action: { bottomSafeArea = $0 }
    .overlay(alignment: .bottom) {
      TabBarHost(selection: $selected, showsLabels: showsTabLabels)
        .padding(.bottom, AppTabBar.Metrics.bottomGap)
        // Fill the overlay's height first, so ignoring the safe area moves the
        // bar's bottom edge to the screen's: it is measured from there, and
        // left behind the keyboard rather than lifted by it, as Apple's bar is.
        .frame(maxHeight: .infinity, alignment: .bottom)
        .ignoresSafeArea(.all, edges: .bottom)
    }
    .environment(tabBar)
    .onChange(of: selected) {
      tabBar.selected = selected
      tabBar.expand()
    }
  }

  @ViewBuilder private func page(_ tab: AppTab) -> some View {
    switch tab {
    case .accounts: AccountsView(changes: changes)
    case .activity: TransactionsView(proMode: proMode, catalog: catalog, changes: changes)
    case .analytics: AnalyticsView(proMode: proMode, changes: changes)
    case .benefits: BenefitsView(store: benefits)
    case .settings: SettingsView(proMode: proMode, catalog: catalog, changes: changes)
    }
  }
}

/// Reads the shrink state itself, so a shrink redraws only the bar, not
/// every tab.
private struct TabBarHost: View {
  @Binding var selection: AppTab
  let showsLabels: Bool
  @Environment(TabBarState.self) private var state

  var body: some View {
    AppTabBar(
      selection: $selection, progress: state.progress, showsLabels: showsLabels,
      expand: { state.expand() },
      reselect: { state.scrollToTopRequests += 1 })
  }
}
