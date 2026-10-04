import SwiftUI

/// DebitCards' AddForm as a sheet. Add waits for a name and four digits; the
/// server's own message shows in the form, which keeps its fields.
struct AddDebitCardSheet: View {
  let store: ConnectionsStore
  let accounts: [AccountDTO]
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var last4 = ""
  @State private var accountId: String
  @State private var saving = false
  @State private var errorMessage: String?

  init(store: ConnectionsStore, accounts: [AccountDTO]) {
    self.store = store
    self.accounts = accounts
    _accountId = State(initialValue: accounts.first?.id ?? "")
  }

  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Card name (e.g. Chase Debit)", text: $name)
          TextField("Last 4 digits", text: Binding(get: { last4 }, set: { setLast4($0) }))
            .keyboardType(.numberPad)
          Picker("Account", selection: $accountId) {
            ForEach(accounts) { Text(ConnectionText.accountLabel($0)).tag($0.id) }
          }
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Add Debit Card")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save)
              .disabled(trimmedName.isEmpty || last4.count != 4 || accountId.isEmpty)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
  }

  private func setLast4(_ raw: String) {
    last4 = ConnectionText.cleanLast4(raw)
  }

  private func save() {
    let card = NewDebitCard(name: trimmedName, last4: last4, accountId: accountId)
    saving = true
    errorMessage = nil
    Task {
      do throws(APIError) {
        try await store.add(card)
        dismiss()
      } catch {
        saving = false
        if error != .cancelled { errorMessage = error.message }
      }
    }
  }
}
