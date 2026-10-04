import SwiftUI

/// Everything the web shows when a row expands or its category editor opens:
/// category, link, splits, refunds and a Venmo cash-out's breakdown. Reads
/// the row from the store by id, so it shows the server's copy after a write.
struct TransactionDetailView: View {
  let id: String
  let store: TransactionsStore
  let catalog: CategoryCatalog
  let proMode: ProMode

  @Environment(\.dismiss) private var dismiss

  /// The last copy seen, kept for when a write moves the row out of the
  /// loaded pages (a category that the filters now hide).
  @State private var snapshot: TransactionDTO?
  @State private var category = ""
  @State private var subcategory = ""
  @State private var saving = false
  @State private var failure: String?
  @State private var addingSplit = false

  private var transaction: TransactionDTO? { store.row(id) ?? snapshot }

  /// False once the row has left the store's loaded pages (F2): the screen
  /// then shows only `snapshot`'s read-only sections — no Save, Category,
  /// Connect/Unlink or split add/remove — since a write from here would 404.
  private var isLive: Bool { store.row(id) != nil }

  var body: some View {
    Group {
      if let t = transaction {
        form(t)
      } else {
        ContentUnavailableView("Transaction Not Loaded", systemImage: "questionmark.circle")
      }
    }
    .navigationBarTitleDisplayMode(.inline)
    .onAppear { adopt(store.row(id)) }
    .onChange(of: store.row(id)) { _, row in adopt(row) }
    .alert("Couldn't Save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(failure ?? "")
    }
  }

  /// Takes the server's copy and resets the editor to it.
  private func adopt(_ row: TransactionDTO?) {
    guard let row else { return }
    snapshot = row
    category = row.editableCategory
    subcategory = row.editableSubcategory ?? ""
  }

  private func form(_ t: TransactionDTO) -> some View {
    Form {
      summary(t)
      if isLive && t.linkedTo == nil { categorySection(t) }
      if t.isMoneyIn && (isLive || t.linkedTo != nil) { linkSection(t) }
      if !t.splits.isEmpty || (isLive && t.isSplittable && proMode.isPro) { splitsSection(t) }
      if !t.refunds.isEmpty { refundsSection(t) }
      if let breakdown = t.breakdown { breakdownSection(breakdown) }
      if !isLive {
        Section {
        } footer: {
          Text("This transaction is no longer in the loaded list. Pull down on the ledger to refresh.")
        }
      }
    }
    .tabBarScrollTracking()
    .navigationTitle(t.title)
    .toolbar {
      if isLive && t.linkedTo == nil {
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Save") { run(.category(.set(category, subcategory: subcategory))) }
              .disabled(!categoryChanged(t))
          }
        }
      }
    }
    .sheet(isPresented: $addingSplit) {
      AddSplitSheet(transaction: t, store: store, catalog: catalog)
    }
  }

  private func categoryChanged(_ t: TransactionDTO) -> Bool {
    let chosen = CategoryPath.join(category, subcategory)
    let current = t.userCategory ?? t.category
    return chosen != current
  }

  // MARK: Sections

  private func summary(_ t: TransactionDTO) -> some View {
    let amount = Ledger.signedAmount(t.amount)
    return Section {
      VStack(alignment: .leading, spacing: 6) {
        AmountText(amount.text)
          .font(.largeTitle.weight(.semibold))
          .monospacedDigit()
          .foregroundStyle(amount.isOutflow ? Color.primary : Color.green)
          .minimumScaleFactor(0.6)
          .lineLimit(1)
        Text(t.detailLine())
          .font(.subheadline)
          .foregroundStyle(.secondary)
        let badges = t.badges
        if !badges.isEmpty {
          FlowLayout(spacing: 4) { ForEach(badges, id: \.text) { BadgeView(badge: $0) } }
        }
      }
      .padding(.vertical, 4)
      if t.merchantName != nil { LabeledContent("Bank description", value: t.name) }
      if let note = t.personalNote, !note.isEmpty { LabeledContent("Note", value: note) }
    }
  }

  private func categorySection(_ t: TransactionDTO) -> some View {
    Section {
      CategoryFields(
        options: Ledger.categoryOptions(catalog.names, current: t.editableCategory, plaid: t.plaidCategory),
        knownSubs: catalog.subcategories(of:),
        category: $category,
        subcategory: $subcategory)
      if t.userCategory != nil {
        Button("Use Bank's Category", role: .destructive) {
          run(.category(.reset))
        }
        .disabled(saving)
      }
    } header: {
      Text("Category")
    } footer: {
      if t.userCategory != nil {
        Text("The bank's category is \(t.plaidCategoryDetailed ?? t.plaidCategory).")
      }
    }
  }

  private func linkSection(_ t: TransactionDTO) -> some View {
    Section {
      if let linked = t.linkedTo {
        LabeledContent("Linked to", value: "#\(linked.label.map(String.init) ?? "?") \(linked.name)")
        LabeledContent("Category", value: linked.category)
        if isLive {
          Button("Unlink", role: .destructive) { run(.unlink) }
            .disabled(saving)
        }
      } else if isLive {
        NavigationLink("Connect to a Purchase…") {
          LinkPurchaseView(transactionId: t.id, store: store) {
            // The link just succeeded and reloaded this row's page; if it no
            // longer matches the filters, pop both screens back to the
            // ledger rather than leave this one showing a stale snapshot.
            if store.row(id) == nil { dismiss() }
          }
        }
      }
    } header: {
      Text("Paid back")
    } footer: {
      if t.linkedTo != nil {
        Text("While linked, this row takes the purchase's category. Unlink to set its own.")
      }
    }
  }

  private func splitsSection(_ t: TransactionDTO) -> some View {
    Section {
      ForEach(t.splits) { part in
        LabeledContent(part.subcategory.map { "\(part.category) › \($0)" } ?? part.category) {
          AmountText(Formatters.currency(part.amount)).monospacedDigit()
        }
        .swipeActions {
          if isLive && proMode.isPro {
            Button("Remove", role: .destructive) {
              run(.deleteSplit(part.id))
            }
          }
        }
      }
      if let rest = t.splitRemainder {
        let label = (t.categoryDetailed.map { "\(t.category) › \($0)" } ?? t.category) + " (rest)"
        LabeledContent(label) {
          AmountText(Formatters.currency(rest))
            .monospacedDigit()
            .foregroundStyle(rest < 0 ? Color.red : Color.primary)
        }
      }
      if isLive && proMode.isPro && t.isSplittable {
        Button("Add Split", systemImage: "plus") { addingSplit = true }
          .disabled(saving)
      }
    } header: {
      Text("Split across categories")
    } footer: {
      VStack(alignment: .leading, spacing: 6) {
        if t.splitIsShrunk {
          Text("This transaction's amount changed and is now smaller than its splits. Remove or re-add a split to fix it.")
            .foregroundStyle(.orange)
        }
        if proMode.hasLoaded && !proMode.isPro {
          Text("Splits still count toward your totals in Normal mode — switch to Pro in Settings to change them.")
        }
      }
    }
  }

  private func refundsSection(_ t: TransactionDTO) -> some View {
    Section {
      ForEach(t.refunds) { r in
        LabeledContent {
          AmountText(Formatters.currency(abs(r.amount))).monospacedDigit()
        } label: {
          Text("#\(r.label.map(String.init) ?? "—") \(Formatters.parseISO(r.date).map { Formatters.date($0) } ?? "") · \(r.name)")
        }
      }
      LabeledContent("Net") {
        AmountText(Formatters.currency(t.netAmount)).monospacedDigit().foregroundStyle(.green)
      }
    } header: {
      Text("Paid back by")
    }
  }

  private func breakdownSection(_ b: CashoutBreakdown) -> some View {
    Section {
      ForEach(b.slices, id: \.category) { slice in
        LabeledContent(slice.category) {
          AmountText(Formatters.currency(slice.amount)).monospacedDigit()
        }
      }
      if b.priorBalance > 0 {
        LabeledContent("Prior balance (uncategorized)") {
          AmountText(Formatters.currency(b.priorBalance)).monospacedDigit()
        }
      }
    } header: {
      Text("Pooled from these Venmo payments")
    }
  }

  private enum Write {
    case category(CategoryUpdate)
    case unlink
    case deleteSplit(String)
  }

  /// Runs a write; on failure shows the server's message and leaves the form
  /// as the user left it.
  private func run(_ write: Write) {
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        switch write {
        case .category(let update): try await store.setCategory(id, update)
        case .unlink: try await store.setLink(id, label: nil)
        case .deleteSplit(let splitId): try await store.deleteSplit(id, splitId: splitId)
        }
        catalog.noteUsed(store.row(id)?.userCategory)
        // The write reloaded this row's page; if it no longer matches the
        // filters, pop back rather than leave this screen stale (F2).
        if store.row(id) == nil { dismiss() }
      } catch {
        if error != .cancelled { failure = error.message }
      }
    }
  }
}
