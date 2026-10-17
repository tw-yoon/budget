import SwiftUI

/// The credit page's two pickers: the purchase a credit paid back (the
/// ledger's link candidates), or a credit on the card to attach to the perk
/// by hand. Tapping a row saves it and closes.
struct PerkPickerSheet: View {
  enum Kind: Identifiable {
    case purchase(creditId: String)
    case credit(benefitId: String)
    var id: String {
      switch self {
      case .purchase(let id): "purchase-\(id)"
      case .credit(let id): "credit-\(id)"
      }
    }
  }

  private struct Row: Identifiable {
    let id: String
    let name: String
    let date: String
    let amount: String
  }

  let kind: Kind
  let store: BenefitsStore
  @Environment(\.dismiss) private var dismiss
  @State private var rows: [Row]?
  @State private var saving = false
  @State private var failure: String?
  @State private var loadError: String?

  var body: some View {
    NavigationStack {
      List {
        if loadError != nil {
          EmptyView()
        } else if let rows {
          ForEach(rows) { row in
            Button { choose(row.id) } label: {
              PerkRow(name: row.name, detail: Formatters.day(row.date), amount: row.amount)
            }
            .foregroundStyle(.primary)
            .disabled(store.isSaving)
          }
        } else {
          LinkPurchaseView.placeholderRows
        }
      }
      .overlay {
        if let loadError {
          ContentUnavailableView {
            Label("Couldn't Load", systemImage: "exclamationmark.triangle")
          } description: {
            Text(loadError)
          } actions: {
            Button("Retry") { Task { await load() } }
          }
        } else if rows?.isEmpty == true {
          switch kind {
          case .purchase: ContentUnavailableView("No Purchases", systemImage: "cart")
          case .credit: ContentUnavailableView("No Credits", systemImage: "creditcard")
          }
        }
      }
      .disabled(saving)
      .navigationTitle(isPurchase ? "Pick Purchase" : "Add Transaction")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
      }
      .task { await load() }
      .alert("Couldn't Save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(failure ?? "")
      }
    }
  }

  private var isPurchase: Bool {
    if case .purchase = kind { true } else { false }
  }

  private func load() async {
    loadError = nil
    rows = nil
    do throws(APIError) {
      switch kind {
      case .purchase(let id):
        rows = try await store.purchaseCandidates(id).map {
          Row(id: $0.id, name: $0.name, date: $0.date, amount: Formatters.currency($0.amount))
        }
      case .credit(let id):
        rows = try await store.perkCandidates(id).map {
          Row(id: $0.id, name: $0.name, date: $0.date, amount: Ledger.signedAmount(-$0.amount).text)
        }
      }
    } catch {
      if error == .cancelled { return }
      loadError = error.message
    }
  }

  private func choose(_ rowId: String) {
    let write: CardWrite = switch kind {
    case .purchase(let creditId): .pickPurchase(creditId: creditId, purchaseId: rowId)
    case .credit(let benefitId): .decidePerk(transactionId: rowId, .yes(benefitId: benefitId))
    }
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        try await store.perform(write)
        dismiss()
      } catch {
        if error != .cancelled { failure = error.message }
      }
    }
  }
}

/// A transaction in the perk screens: name over its date, amount trailing;
/// stacked at accessibility sizes (PairRow).
struct PerkRow: View {
  let name: String
  let detail: String
  let amount: String

  var body: some View {
    PairRow {
      VStack(alignment: .leading, spacing: 2) {
        Text(name)
        Text(detail).font(.footnote).foregroundStyle(.secondary)
      }
    } value: {
      AmountText(amount).monospacedDigit()
    }
  }
}

extension Formatters {
  /// "Mar 5, 2026" from the API's "2026-03-05"; the raw string if unreadable.
  static func day(_ iso: String) -> String {
    parseISO(iso).map { date($0) } ?? iso
  }
}
