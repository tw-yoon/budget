import SwiftUI

/// TransactionLedger.tsx: filters, sort, and the rows, paged by scrolling.
/// Search is LedgerSearchField, and the Filter menu LedgerFilterMenu: both
/// sit on TransactionsView. Pulling down runs the web's "Sync transactions" — the same
/// gesture that refreshes balances on Accounts.
struct LedgerView: View {
  let store: TransactionsStore
  let catalog: CategoryCatalog
  let proMode: ProMode
  /// LedgerSearchField's measured height, so the last row scrolls clear of it.
  var searchHeight = BottomSearchField.minHeight

  @AppStorage(ServerAddress.storageKey) private var server = ""
  /// Filters and sort, kept per device (search is not kept).
  @AppStorage(Self.filtersKey) private var savedFilters = Data()
  /// The row the list was at, for the next launch (LedgerPosition).
  @AppStorage(LedgerPosition.key) private var savedPosition = Data()
  /// Drawn density; CompactRowsSync keeps it and the saved setting in step.
  @State private var compactRows = CompactRows.saved
  @State private var visibleRows: Set<String> = []
  @Environment(\.scenePhase) private var scenePhase
  static let filtersKey = "transactions.filters"

  var body: some View {
    content
      .safeAreaInset(edge: .top) {
        if let banner = store.banner {
          Banner(text: banner) { store.banner = nil }
        }
      }
      .task {
        var q = restoredFilters()
        // The search field (LedgerSearchField) outlives this view, so keep
        // what it holds.
        q.search = store.query.search
        await store.apply(q)
        if store.rows.isEmpty && store.error == nil { await store.reload() }
      }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { Task { await store.reload() } } else { keepPosition(position) }
      }
      // A new search, filters or sort: the kept row was for the old list.
      .onChange(of: store.query) { _, query in
        let kept = LedgerPosition.kept(LedgerPosition.decode(savedPosition), whenQueryBecomes: query)
        savedPosition = LedgerPosition.encode(kept)
      }
      .onChange(of: store.rows) { _, rows in
        for row in rows { catalog.noteUsed(row.userCategory) }
      }
  }

  @ViewBuilder private var content: some View {
    if let error = store.error, store.rows.isEmpty {
      ErrorView(error: error, server: server) { Task { await store.reload() } }
    } else if store.total == nil {
      ProgressView()
    } else if store.rows.isEmpty {
      // Scrollable so pull-to-sync works here too: with no rows, it is the
      // only way to fetch the first ones.
      ScrollView {
        emptyState.containerRelativeFrame(.vertical)
      }
      .tabBarScrollTracking()
      .refreshable { await store.sync() }
    } else {
      list
    }
  }

  /// A lazy stack drawn as an inset-grouped list (GroupedList), so a switch
  /// between full and compact rows glides rather than jumps.
  private var list: some View {
    ScrollViewReader { proxy in
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        if let total = store.total {
          Text(total == 1 ? "1 transaction" : "\(total) transactions").groupedHeader()
        }
        LazyVStack(spacing: 0) {
          Self.rows(store.rows, store: store, compact: compactRows, visible: $visibleRows)
        }
        .compactRowsCard($compactRows, ids: store.rows.map(\.id), visible: visibleRows, proxy: proxy)
        if store.hasMore {
          pagingFooter.padding(.vertical, 12)
        }
      }
    }
    .tabBarScrollTracking(extraBottom: BottomSearchField.room(fieldHeight: searchHeight))
    .scrollDismissesKeyboard(.immediately)
    .refreshable { await store.sync() }
    .modifier(CompactRowsSync(compact: $compactRows))
    .onAppear { restorePosition(proxy) }
    .onChange(of: store.rows) { restorePosition(proxy) }
    .onChange(of: store.isLoading) { restorePosition(proxy) }
    // Kept once the list has rested there, not on every frame of a scroll.
    .task(id: position) {
      let position = position
      try? await Task.sleep(for: LedgerPosition.settle)
      guard !Task.isCancelled else { return }
      keepPosition(position)
    }
    }
  }

  /// Where the list is now: its topmost visible row, under the current query.
  private var position: LedgerPosition? {
    let ids = store.rows.map(\.id)
    return LedgerPosition.taken(
      top: LedgerPosition.top(of: ids, visible: visibleRows), rows: ids, query: store.query)
  }

  /// Saves a position taken from what is on screen. Never clears: with a
  /// transaction pushed over the list no row is visible, and quitting there
  /// must still reopen at the row. Only a query change clears.
  private func keepPosition(_ position: LedgerPosition?) {
    // Until the launch has had its chance to restore, the list sits at the
    // top, which would overwrite the row it is about to go back to.
    guard store.positionRestored, let data = LedgerPosition.toSave(position) else { return }
    savedPosition = data
  }

  /// The first load only: back to the row the last launch was at, if the
  /// rows loaded so far (the saved page, then the server's) hold it.
  /// Otherwise the list starts at the top.
  private func restorePosition(_ proxy: ScrollViewProxy) {
    guard !store.positionRestored, !store.rows.isEmpty else { return }
    let ids = store.rows.map(\.id)
    // Scrolled already: leave the list where the user put it.
    if let top = LedgerPosition.top(of: ids, visible: visibleRows), top != ids.first {
      store.positionRestored = true
      return
    }
    let target = LedgerPosition.restoreTarget(
      LedgerPosition.decode(savedPosition), query: store.query, rows: ids)
    if let target {
      store.positionRestored = true
      // After the rows have laid out, so the lazy stack can find it.
      Task { proxy.scrollTo(target, anchor: .top) }
    } else if !store.isLoading {
      store.positionRestored = true
      savedPosition = Data()
    }
  }

  /// The rows, built outside the main actor. iOS 26 SwiftUI can build a lazy
  /// stack's rows on its background renderer while an animation runs (the
  /// compact pinch); a row closure formed in the view's main-actor body
  /// then fails Swift 6's isolation check there and crashes the app
  /// (Apple bug FB20692404). One formed here has no isolation to check.
  /// Everything it touches is passed in.
  nonisolated private static func rows(
    _ rows: [TransactionDTO], store: TransactionsStore, compact: Bool, visible: Binding<Set<String>>
  ) -> some View {
    ForEach(rows) { row in
      LedgerRowCell(row: row, store: store, compact: compact, visible: visible)
    }
  }

  @ViewBuilder private var pagingFooter: some View {
    if store.loadMoreFailed {
      Button("Couldn't load more — Retry") { Task { await store.loadMore() } }
        .frame(maxWidth: .infinity)
    } else {
      ProgressView()
        .frame(maxWidth: .infinity)
        .onAppear { Task { await store.loadMore() } }
    }
  }

  @ViewBuilder private var emptyState: some View {
    if !store.query.search.isEmpty {
      ContentUnavailableView.search(text: store.query.search)
    } else if !store.query.filtersAreDefault {
      ContentUnavailableView {
        Label("No Matches", systemImage: "line.3.horizontal.decrease.circle")
      } description: {
        Text("No transactions match these filters.")
      } actions: {
        Button("Clear Filters") { update { $0 = TransactionQuery() } }
      }
    } else {
      ContentUnavailableView(
        "No Transactions", systemImage: "list.bullet.rectangle",
        description: Text("Connect an account on your Mac, then pull down here to sync."))
    }
  }

  /// Changes the filters, saves them, and reloads from page 1.
  private func update(_ change: (inout TransactionQuery) -> Void) {
    var q = store.query
    change(&q)
    savedFilters = Self.saved(q)
    Task { await store.apply(q) }
  }

  /// The filters and sort as kept on this device: without the search.
  static func saved(_ query: TransactionQuery) -> Data {
    var kept = query
    kept.search = ""
    return (try? JSONEncoder().encode(kept)) ?? Data()
  }

  private func restoredFilters() -> TransactionQuery {
    (try? JSONDecoder().decode(TransactionQuery.self, from: savedFilters)) ?? TransactionQuery()
  }
}

/// One ledger row in its card: the row, its chevron and separator, and the
/// paging trigger. Main-actor work happens in its body, on the main thread.
private struct LedgerRowCell: View {
  let row: TransactionDTO
  let store: TransactionsStore
  let compact: Bool
  let visible: Binding<Set<String>>

  var body: some View {
    NavigationLink(value: TransactionRoute(id: row.id)) {
      HStack(spacing: 12) {
        TransactionRow(transaction: row, compact: compact)
        Image(systemName: "chevron.forward")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.tertiary)
      }
      .groupedRow(isLast: row.id == store.rows.last?.id)
    }
    .buttonStyle(GroupedRowStyle())
    .id(row.id)
    .compactRowsCell(row.id, in: visible)
    .onAppear {
      if row.id == store.rows.last?.id { Task { await store.loadMore() } }
    }
  }
}

