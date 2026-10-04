import SwiftUI

/// The Transactions tab: Ledger, Venmo and Zelle behind a segmented control —
/// the web sidebar's three children. Each segment keeps its own store, so
/// switching does not reload the others.
struct TransactionsView: View {
  enum Segment: String, CaseIterable, Identifiable {
    case ledger, venmo, zelle
    var id: Self { self }
    var title: String {
      switch self {
      case .ledger: "Ledger"
      case .venmo: "Venmo"
      case .zelle: "Zelle"
      }
    }
  }

  @SceneStorage("transactions.segment") private var segment: Segment = .ledger
  @Environment(\.scenePhase) private var scenePhase
  /// Absent in previews.
  @Environment(TabBarState.self) private var tabBar: TabBarState?
  /// The screen's width, for SwitcherBar.
  @State private var width: CGFloat = 0
  /// The search field's height, measured; it grows at large text sizes.
  @State private var searchHeight = BottomSearchField.minHeight

  @State private var ledger = TransactionsStore(client: Self.client)
  @State private var venmo = P2PStore(source: .venmo, client: Self.client)
  @State private var zelle = P2PStore(source: .zelle, client: Self.client)
  let proMode: ProMode
  /// Owned by RootView, so a change in Settings → Categories reaches the pickers.
  let catalog: CategoryCatalog
  /// Bumped by Settings when transaction categories change there.
  let changes: DataChanges

  static func client() -> APIClient? { APIClient.saved() }

  var body: some View {
    NavigationStack {
      // One view around the segments, so what follows is applied once: a
      // Group hands each modifier to the segment showing, which would make a
      // new search field (losing its text and focus) whenever that changes.
      ZStack {
        Group {
          switch segment {
          case .ledger: LedgerView(store: ledger, catalog: catalog, proMode: proMode, searchHeight: searchHeight)
          case .venmo: P2PCategorizerView(store: venmo, ledger: ledger)
          case .zelle: P2PCategorizerView(store: zelle, ledger: ledger)
          }
        }
        // Every state of every segment — ProgressView, ErrorView, an empty
        // ScrollView, or the inset-grouped list — sits on the same grey, so
        // switching segments or a state never flashes white (F4). Full-size
        // first: a Group hands .background to each child, and a bare
        // ProgressView is only as big as its spinner, which left the rest of
        // the screen white while Venmo or Zelle first loaded.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
      }
      // The ledger's search, above the tab bar; it fades out on Venmo and
      // Zelle rather than popping.
      .overlay(alignment: .bottom) { LedgerSearchField(store: ledger, shown: segment == .ledger, height: $searchHeight) }
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
      .navigationTitle("Transactions")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) {
          // Each segment's one trailing button — Ledger's Filter, Venmo's
          // Import CSV, none on Zelle — fades in as its segment shows.
          SwitcherBar(selection: $segment, segments: Segment.allCases, title: \.title, width: width) {
            trailing($0)
          }
        }
      }
      .navigationDestination(for: TransactionRoute.self) { route in
        TransactionDetailView(id: route.id, store: ledger, catalog: catalog, proMode: proMode)
      }
    }
    .task {
      await catalog.load()
    }
    // A segment still loading or showing an error has no scroll view to
    // bring the bar back, so switching does it.
    .onChange(of: segment) { tabBar?.expand() }
    // Another device may have changed categories meanwhile.
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      Task {
        await catalog.load()
      }
    }
    // A category edit, Apply Now or Use Rule for These in Settings rewrote
    // categories, so the rows here may show old ones. GET only: never Sync.
    .onChange(of: changes.categoriesVersion) {
      Task {
        await ledger.reload()
        if venmo.data != nil { await venmo.load() }
        if zelle.data != nil { await zelle.load() }
      }
    }
    // A bank disconnected in Settings took its transactions with it.
    .onChange(of: changes.accountsVersion) {
      Task {
        await ledger.reload()
        if venmo.data != nil { await venmo.load() }
        if zelle.data != nil { await zelle.load() }
      }
    }
  }
}

extension TransactionsView {
  @ViewBuilder private func trailing(_ segment: Segment) -> some View {
    switch segment {
    case .ledger:
      LedgerFilterMenu(store: ledger)
    case .venmo:
      Group {
        if venmo.isImporting {
          ProgressView()
        } else {
          Button("Import CSV", systemImage: "square.and.arrow.down") {
            Task { await venmo.runImport() }
          }
          .labelStyle(.iconOnly)
          .font(.title3)
        }
      }
      .barGlass(icon: true)
    case .zelle:
      EmptyView()
    }
  }
}

/// Pushes a transaction's detail screen. By id, so the screen always shows
/// the store's latest copy of the row.
struct TransactionRoute: Hashable {
  let id: String
}
