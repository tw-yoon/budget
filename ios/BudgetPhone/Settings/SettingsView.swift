import SwiftUI

struct SettingsView: View {
  let proMode: ProMode
  let catalog: CategoryCatalog
  let changes: DataChanges
  @State private var categories = CategoriesStore(client: RootView.client)
  @State private var rules = RulesStore(client: RootView.client)
  @State private var connections = ConnectionsStore(client: RootView.client)
  @State private var update = UpdateStore(client: RootView.client)
  @State private var phoneUpdate = PhoneUpdateStore(client: RootView.client)
  @State private var provisioning = Provisioning.current()
  @State private var confirmingInstall = false
  /// Kept on this iPhone only; the web has no tab bar.
  @AppStorage(AppTabBar.labelsKey) private var showsTabLabels = false

  /// Where the phone differs from the web on purpose: the web keeps a failed
  /// save in one browser's localStorage, but the phone's next read would
  /// quietly undo it, so say so.
  static let saveFailed = "Couldn't save to the server. Other devices keep the old setting."

  private var version: String {
    AppVersion.current
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
        if proMode.isPro {
          Section {
            NavigationLink("Load Times") { LoadTimesView() }
          }
        }
        Section("Accessibility") {
          Toggle("Tab Bar Labels", isOn: $showsTabLabels)
        }
        ServerForm()
        Section {
          LabeledContent("Version", value: version)
          if let s = update.status { macRow(s) }
          if let p = provisioning {
            LabeledContent("Installed", value: p.created.formatted(.dateTime.month(.abbreviated).day()))
            LabeledContent("Stops Opening", value: p.expires.formatted(.dateTime.month(.abbreviated).day()))
          }
          if let s = phoneUpdate.status, s.available { phoneRow(s) }
        } header: {
          Text("About")
        } footer: {
          if let s = update.status, AppVersion.isNewer(s.version, than: version) {
            Text("Your Mac has v\(s.version). This app updates the next time it's reinstalled from the Mac.")
          }
        }
      }
      .task { await update.load() }
      .task { await phoneUpdate.load() }
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

  @ViewBuilder private func phoneRow(_ s: PhoneUpdateStatus) -> some View {
    if s.installing {
      LabeledContent("iPhone") {
        HStack(spacing: 6) { ProgressView(); Text("Updating…") }
      }
      Text("The Mac is building the app. It closes when the install starts; open it again after.")
        .font(.footnote).foregroundStyle(.secondary)
    } else {
      if let why = s.failed {
        LabeledContent("iPhone", value: "Update didn't finish")
        Text(why).font(.footnote).foregroundStyle(.secondary)
      }
      Button("Update iPhone") { Task { await phoneUpdate.start() } }
      if let why = phoneUpdate.startError {
        Text(why).font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder private func macRow(_ s: UpdateStatus) -> some View {
    switch update.phase {
    case .updating:
      LabeledContent("Mac") {
        HStack(spacing: 6) { ProgressView(); Text("Updating…") }
      }
    case .updated(let v):
      LabeledContent("Mac", value: "Updated to v\(v)")
    case .stillNotBack:
      LabeledContent("Mac", value: "Not back yet")
      Text("Check that the Mac is awake and Budget is running.").font(.footnote).foregroundStyle(.secondary)
    case .failed(let message):
      LabeledContent("Mac", value: "Update didn't finish")
      Text(message).font(.footnote).foregroundStyle(.secondary)
    case .idle:
      if let log = s.failed {
        LabeledContent("Mac", value: "Update didn't finish")
        Text(log).font(.footnote).foregroundStyle(.secondary)
      }
      if s.available, s.canUpdate, let latest = s.latest {
        if s.failed == nil { LabeledContent("Mac", value: "v\(latest) available") }
        Button("Install Update") { confirmingInstall = true }
          .confirmationDialog(
            "Budget will stop for about a minute while it updates.",
            isPresented: $confirmingInstall, titleVisibility: .visible
          ) {
            Button("Install Update") { Task { await update.install() } }
          }
        if let why = update.startError {
          Text(why).font(.footnote).foregroundStyle(.secondary)
        }
      } else if s.failed == nil {
        LabeledContent("Mac", value: "v\(s.version)")
      }
    }
  }
}
