import SwiftUI

/// P2pCategorizer.tsx for one feed: totals over categorized payments, a
/// category menu per payment, Connect to a Purchase on money in, and (Venmo
/// only) Import.
struct P2PCategorizerView: View {
  let store: P2PStore
  /// For linking: the ledger store owns the link write and its reload.
  let ledger: TransactionsStore

  @AppStorage(ServerAddress.storageKey) private var server = ""
  @Environment(\.scenePhase) private var scenePhase
  /// Drawn density; CompactRowsSync keeps it and the saved setting in step.
  @State private var compactRows = CompactRows.saved
  @State private var visibleRows: Set<String> = []
  /// In compact mode, the one row opened to its full layout.
  @State private var expandedRow: String?

  var body: some View {
    content
      .safeAreaInset(edge: .top) {
        VStack(spacing: 8) {
          if let notice = store.notice {
            Notice(text: notice) { store.notice = nil }
          }
          if let banner = store.banner {
            Banner(text: banner) { store.banner = nil }
          }
        }
      }
      .task { if store.data == nil { await store.load() } }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { Task { await store.load() } }
      }
  }

  @ViewBuilder private var content: some View {
    if let data = store.data {
      if data.transactions.isEmpty {
        ScrollView {
          ContentUnavailableView {
            Label("Nothing to Categorize Yet", systemImage: "person.2")
          } description: {
            Text(emptyHint)
          }
          .containerRelativeFrame(.vertical)
        }
        .tabBarScrollTracking()
        .refreshable { await store.load() }
      } else {
        list(data)
      }
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      P2PPlaceholder()
    }
  }

  private var emptyHint: String {
    store.source == .venmo
      ? "Drop your VenmoStatement_*.csv exports in the Mac's Downloads folder, then tap Import."
      : "Zelle payments arrive automatically with your bank sync. Once a connected account has Zelle activity, it shows up here to categorize."
  }

  /// A lazy stack drawn as an inset-grouped list (GroupedList), like the
  /// Ledger, so a switch between full and compact rows glides.
  private func list(_ data: P2PResponse) -> some View {
    ScrollViewReader { proxy in
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        let totals = store.totals
        HStack {
          figure("Sent", totals.sent, .primary)
          figure("Received", totals.received, .green)
          figure("Net spend", totals.net, .primary)
        }
        .groupedRow(isLast: true)
        .groupedCard()
        .padding(.top, 12)
        Text("Categorized payments only — Uncategorized and Transfer don't count.").groupedFooter()
        LazyVStack(spacing: 0) {
          Self.rows(
            data.transactions, store: store, ledger: ledger, compact: compactRows,
            expanded: $expandedRow, visible: $visibleRows)
        }
        .compactRowsCard($compactRows, ids: data.transactions.map(\.id), visible: visibleRows, proxy: proxy)
      }
    }
    .tabBarScrollTracking()
    .refreshable { await store.load() }
    .modifier(CompactRowsSync(compact: $compactRows))
    .onChange(of: compactRows) { expandedRow = nil }
    }
  }

  /// The rows, built outside the main actor, as LedgerView.rows explains:
  /// iOS 26 can build them on its background renderer mid-animation.
  nonisolated private static func rows(
    _ transactions: [P2PTransaction], store: P2PStore, ledger: TransactionsStore, compact: Bool,
    expanded: Binding<String?>, visible: Binding<Set<String>>
  ) -> some View {
    ForEach(transactions) { row in
      P2PRowCell(
        row: row, store: store, ledger: ledger, compact: compact, expanded: expanded,
        isLast: row.id == transactions.last?.id, visible: visible)
    }
  }

  private func figure(_ label: String, _ amount: Double, _ color: Color) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.caption).foregroundStyle(.secondary)
      AmountText(Formatters.currency(amount))
        .font(.subheadline.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(color)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One payment in its card. Tapping a compact row opens just that one to
/// the full layout, where its category menu and Connect… live; tapping its
/// name line folds it again.
private struct P2PRowCell: View {
  let row: P2PTransaction
  let store: P2PStore
  let ledger: TransactionsStore
  let compact: Bool
  let expanded: Binding<String?>
  let isLast: Bool
  let visible: Binding<Set<String>>

  var body: some View {
    P2PRow(
      row: row, store: store, ledger: ledger, compact: compact && expanded.wrappedValue != row.id,
      expand: { withAnimation(CompactRows.motion) { expanded.wrappedValue = row.id } },
      fold: { if compact { withAnimation(CompactRows.motion) { expanded.wrappedValue = nil } } }
    )
    .groupedRow(isLast: isLast)
    .id(row.id)
    .compactRowsCell(row.id, in: visible)
  }
}

/// One payment. Compact, it is one line: number, short date, counterparty,
/// amount (CompactRow's layout). One view for both, so a switch morphs it as
/// the ledger's TransactionRow does: the name and amount glide, the number
/// and date slide in, and the lower lines fade. At accessibility sizes,
/// compact is CompactRow.
private struct P2PRow: View {
  let row: P2PTransaction
  let store: P2PStore
  let ledger: TransactionsStore
  var compact = false
  /// Tapping a compact row.
  var expand: () -> Void = {}
  /// Tapping the name line of a full row.
  var fold: () -> Void = {}

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  /// As CompactRow's: fits "Sep 30" and "#1234" at the current text size.
  @ScaledMetric(relativeTo: .footnote) private var dateWidth: CGFloat = 44
  @ScaledMetric(relativeTo: .footnote) private var numberWidth: CGFloat = 42

  var body: some View {
    if compact && dynamicTypeSize.isAccessibilitySize {
      Button(action: expand) {
        CompactRow(
          number: CompactRows.number(row.label), date: CompactRows.shortDate(row.date), title: row.counterparty ?? "—",
          amount: row.signedAmount, amountColor: row.direction == .in ? .green : .primary)
      }
      .tint(.primary)
      .accessibilityHint("Shows the category and links")
    } else {
      morphing
    }
  }

  private var morphing: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      if compact {
        Text(CompactRows.number(row.label))
          .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
          .lineLimit(1)
          .frame(width: numberWidth, alignment: .leading)
          .transition(.move(edge: .leading).combined(with: .opacity))
        Text(CompactRows.shortDate(row.date))
          .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
          .frame(width: dateWidth, alignment: .leading)
          .transition(.move(edge: .leading).combined(with: .opacity))
      }
      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(row.counterparty ?? "—")
            .font(compact ? .body : .body.weight(.medium))
            .lineLimit(compact ? 1 : nil)
          Spacer(minLength: 8)
          AmountText(row.signedAmount)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(row.direction == .in ? Color.green : Color.primary)
        }
        .contentShape(.rect)
        .onTapGesture { if compact { expand() } else { fold() } }
        if !compact {
          details.transition(.opacity)
        }
      }
    }
    .padding(.vertical, compact ? 0 : 2)
    .contentShape(.rect)
    // The whole row opens a compact row; a full row's own controls keep
    // their taps.
    .gesture(TapGesture().onEnded(expand), including: compact ? .all : .subviews)
    .accessibilityElement(children: compact ? .combine : .contain)
    .accessibilityAddTraits(compact ? .isButton : [])
    .accessibilityHint(compact ? "Shows the category and links" : "")
  }

  @ViewBuilder private var details: some View {
    VStack(alignment: .leading, spacing: 4) {
      if !row.note.isEmpty {
        Text(row.note).font(.subheadline)
      }
      Text(row.dateLine)
        .font(.footnote)
        .foregroundStyle(.secondary)
      HStack {
        if let linked = row.linkedTo {
          HStack(spacing: 4) {
            Image(systemName: "lock.fill").font(.caption2)
            Text("\(row.category) · linked to #\(linked.label.map(String.init) ?? "?")")
          }
          .font(.footnote)
          .foregroundStyle(.secondary)
        } else {
          Menu {
            Picker("Category", selection: categoryBinding) {
              ForEach(store.options(for: row), id: \.self) { Text($0).tag($0) }
            }
          } label: {
            Label(row.category, systemImage: "tag")
              .font(.footnote)
              .foregroundStyle(row.isIgnored ? Color.secondary : Color.accentColor)
          }
        }
        Spacer()
        if row.direction == .in && row.linkedTo == nil {
          NavigationLink("Connect…") {
            LinkPurchaseView(transactionId: row.id, store: ledger) { await store.load() }
          }
          .font(.footnote)
          .fixedSize()
        }
      }
    }
  }

  private var categoryBinding: Binding<String> {
    let id = row.id
    let store = store
    return Binding(get: { row.category }, set: { category in
      Task { await store.setCategory(id, to: category) }
    })
  }
}

/// A feed's first load: the totals card and payment rows, drawn as grey
/// placeholders in the list's own shape.
struct P2PPlaceholder: View {
  private static let rows = [
    PlaceholderRow(title: "Sample Friend", detail: "dinner\n#801 · Sep 10, 2026", amount: "\u{2212}$40.00"),
    PlaceholderRow(title: "Sample Person", detail: "tickets\n#802 · Sep 11, 2026", amount: "+$15.00"),
    PlaceholderRow(title: "Sample Roommate", detail: "rent share\n#803 · Sep 12, 2026", amount: "\u{2212}$500.00"),
    PlaceholderRow(title: "Sample Friend", detail: "groceries\n#804 · Sep 13, 2026", amount: "+$20.00"),
    PlaceholderRow(title: "Sample Person", detail: "coffee\n#805 · Sep 14, 2026", amount: "\u{2212}$6.00"),
  ]

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack {
          ForEach(["Sent", "Received", "Net spend"], id: \.self) { label in
            VStack(alignment: .leading, spacing: 2) {
              Text(label).font(.caption).foregroundStyle(.secondary)
              Text("$100.00").font(.subheadline.weight(.semibold)).monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        .groupedRow(isLast: true)
        .groupedCard()
        .padding(.top, 12)
        Text("Categorized payments only — Uncategorized and Transfer don't count.")
          .groupedFooter()
          .unredacted()
        VStack(spacing: 0) {
          ForEach(Self.rows.indices, id: \.self) { i in
            Self.rows[i].groupedRow(isLast: i == Self.rows.count - 1)
          }
        }
        .groupedCard()
      }
    }
    .scrollDisabled(true)
    .loadingPlaceholder()
  }
}

#Preview("Venmo loading") {
  NavigationStack {
    P2PPlaceholder()
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Transactions")
      .navigationBarTitleDisplayMode(.inline)
  }
}
