import SwiftUI

/// The ledger's Filter menu: account, the two toggles, Compact Rows, and sort
/// (TransactionLedger.tsx's filter bar). Its own view because it sits in
/// TransactionsView's SwitcherBar, not in the ledger, so it can fade.
struct LedgerFilterMenu: View {
  let store: TransactionsStore

  @AppStorage(LedgerView.filtersKey) private var savedFilters = Data()
  @AppStorage(CompactRows.key) private var compactRows = false
  @State private var accountGroups: [AccountGroup] = []

  var body: some View {
    let q = store.query
    return Menu {
      Picker("Account", selection: Binding(get: { q.accountId ?? "" }, set: { id in update { $0.accountId = id.isEmpty ? nil : id } })) {
        Text("All accounts").tag("")
        ForEach(accountGroups) { group in
          Section(group.label) {
            ForEach(group.accounts) { account in
              // Same-named accounts (e.g. two checking accounts) still need
              // to be told apart, as the web dropdown's mask does.
              Text(account.mask.map { "\(account.title) ··\($0)" } ?? account.title)
                .tag(account.id)
            }
          }
        }
      }
      .pickerStyle(.menu)
      Toggle("Hide transfers & fees", isOn: Binding(get: { q.hideInternal }, set: { v in update { $0.hideInternal = v } }))
      Toggle("Show connected payments", isOn: Binding(get: { q.showLinked }, set: { v in update { $0.showLinked = v } }))
      // Phone-only, and also a pinch on the list. Shared with Venmo and Zelle.
      Section {
        // Animated by the list (CompactRowsSync).
        Toggle("Compact Rows", isOn: $compactRows)
      }
      Section("Sort") {
        Picker("Sort by", selection: Binding(get: { q.sort }, set: { v in update { $0.sort = v } })) {
          Text("Date").tag(TransactionQuery.Sort.date)
          Text("Number (#)").tag(TransactionQuery.Sort.label)
        }
        Picker("Order", selection: Binding(get: { q.ascending }, set: { v in update { $0.ascending = v } })) {
          Text(q.sort == .date ? "Newest first" : "Highest first").tag(false)
          Text(q.sort == .date ? "Oldest first" : "Lowest first").tag(true)
        }
      }
    } label: {
      Label("Filter", systemImage: q.filtersAreDefault
        ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        .labelStyle(.iconOnly)
        .font(.title3)
        .barGlass(icon: true)
    }
    .task { accountGroups = (try? await TransactionsView.client()?.accounts().groups) ?? [] }
  }

  /// Changes the filters, saves them, and reloads from page 1, keeping the
  /// search applied now.
  private func update(_ change: (inout TransactionQuery) -> Void) {
    var q = store.query
    change(&q)
    savedFilters = LedgerView.saved(q)
    Task { await store.apply(q) }
  }
}
