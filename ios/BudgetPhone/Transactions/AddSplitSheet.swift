import SwiftUI

/// AddSplitForm in TransactionTable.tsx: carve an amount out of a purchase
/// under another category. The server checks the amount against what is
/// left and its message is shown as is.
struct AddSplitSheet: View {
  let transaction: TransactionDTO
  let store: TransactionsStore
  let catalog: CategoryCatalog

  @Environment(\.dismiss) private var dismiss
  @State private var amountText = ""
  @State private var category: String
  @State private var subcategory = ""
  @State private var saving = false
  @State private var failure: String?

  init(transaction: TransactionDTO, store: TransactionsStore, catalog: CategoryCatalog) {
    self.transaction = transaction
    self.store = store
    self.catalog = catalog
    _category = State(initialValue: transaction.editableCategory)
  }

  /// What is still unallocated — the leftover, or the whole amount when the
  /// row has no parts yet (nothing left when it already has parts and the
  /// server sent no remainder).
  private var left: Double { transaction.splitLeftToAllocate }

  private var amount: Double? {
    guard let v = Double(amountText.trimmingCharacters(in: .whitespaces)), v > 0 else { return nil }
    return v
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Amount", text: $amountText)
            .keyboardType(.decimalPad)
        } footer: {
          Text("\(Formatters.currency(max(left, 0))) left to split.")
        }
        Section {
          CategoryFields(
            options: Ledger.categoryOptions(catalog.names, current: transaction.editableCategory, plaid: transaction.plaidCategory),
            knownSubs: catalog.subcategories(of:),
            category: $category,
            subcategory: $subcategory)
        }
      }
      .navigationTitle("Add Split")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save)
              .disabled(amount.map { !Ledger.splitFitsWhatIsLeft($0, left: left) } ?? true)
          }
        }
      }
      .alert("Couldn't Add Split", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(failure ?? "")
      }
    }
  }

  private func save() {
    guard let amount else { return }
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        let split = NewSplit(amount: amount, category: category, subcategory: subcategory)
        try await store.addSplit(transaction.id, split)
        catalog.noteUsed(CategoryPath.join(split.category, split.subcategory))
        dismiss()
      } catch {
        if error != .cancelled { failure = error.message }
      }
    }
  }
}
