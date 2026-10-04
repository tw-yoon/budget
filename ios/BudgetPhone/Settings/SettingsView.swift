import SwiftUI

struct SettingsView: View {
  let proMode: ProMode
  let catalog: CategoryCatalog
  let changes: DataChanges
  @State private var categories = CategoriesStore(client: RootView.client)
  @State private var rules = RulesStore(client: RootView.client)
  @State private var connections = ConnectionsStore(client: RootView.client)
  /// Kept on this iPhone only; the web has no tab bar.
  @AppStorage(AppTabBar.labelsKey) private var showsTabLabels = false

  /// Where the phone differs from the web on purpose: the web keeps a failed
  /// save in one browser's localStorage, but the phone's next read would
  /// quietly undo it, so say so.
  static let saveFailed = "Couldn't save to the server. Other devices keep the old setting."

  private var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
  }

  var body: some View {
    NavigationStack {
      Form {
        // The web's Settings → Mode, as a plain iPhone switch. Greyed out
        // until the stored value is known, so it never shows Off and then
        // flips on.
        Section {
          Toggle("Pro Mode", isOn: Binding(get: { proMode.isPro }, set: { on in choosePro(on) }))
            .disabled(!proMode.hasLoaded)
        }
        Section {
          NavigationLink("Categories") { CategoriesView(store: categories) }
          NavigationLink("Rules") { RulesView(store: rules, catalog: catalog) }
          NavigationLink("Connections") { ConnectionsView(store: connections) }
        }
        Section("Accessibility") {
          Toggle("Tab Bar Labels", isOn: $showsTabLabels)
        }
        ServerForm()
        Section("About") {
          LabeledContent("Version", value: version)
        }
      }
      .tabBarScrollTracking()
      .safeAreaInset(edge: .top) {
        if proMode.saveFailed {
          Banner(text: Self.saveFailed) { proMode.saveFailed = false }
        }
      }
      .navigationTitle("Settings")
    }
    // The ledger's pickers offer the same list, and its rows may now show
    // old category names.
    .onChange(of: categories.writeCount) {
      changes.categoriesChanged()
      Task { await catalog.load() }
    }
    .onChange(of: rules.recategorizeCount) { changes.categoriesChanged() }
    // A disconnected bank's accounts and transactions are gone.
    .onChange(of: connections.disconnectCount) { changes.accountsChanged() }
  }

  private func choosePro(_ on: Bool) {
    Task { await proMode.choose(on) }
  }
}
