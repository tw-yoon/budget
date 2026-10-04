import SwiftUI

struct AccountEditView: View {
  let account: AccountDTO
  let store: AccountsStore
  let hidden: HiddenAccounts

  @Environment(\.dismiss) private var dismiss
  @State private var form: AccountEditForm
  @State private var saving = false
  @State private var saveError: String?

  init(account: AccountDTO, store: AccountsStore, hidden: HiddenAccounts) {
    self.account = account
    self.store = store
    self.hidden = hidden
    _form = State(initialValue: AccountEditForm(account: account))
  }

  private var patch: AccountPatch { form.patch(against: account) }

  var body: some View {
    Form {
      Section {
        TextField(account.name, text: $form.name)
          .textInputAutocapitalization(.words)
      } header: {
        Text("Name")
      } footer: {
        Text("Leave empty to use the bank's name.")
      }

      if account.isCredit {
        Section {
          Picker("Due Day", selection: $form.dueDay) {
            Text("None").tag(Int?.none)
            ForEach(1...31, id: \.self) { day in
              Text("\(day)").tag(Int?.some(day))
            }
          }
          LabeledContent("Credit Limit") {
            TextField("None", text: $form.creditLimitText)
              .keyboardType(.decimalPad)
              .multilineTextAlignment(.trailing)
              .foregroundStyle(form.isValid ? Color.primary : Color.red)
          }
        } header: {
          Text("Card")
        } footer: {
          Text("For cards whose bank doesn't share a due date or limit through Plaid.")
        }
      }

      Section {
        LabeledContent("Bank", value: account.institution)
        if let mask = account.mask { LabeledContent("Number", value: "··\(mask)") }
        LabeledContent("Balance") {
          AmountText(Formatters.currency(account.signedBalance))
        }
      }

      // Phone-only, and instant to undo, so no confirmation.
      Section {
        Button(hidden.isHidden(account.id) ? "Unhide Account" : "Hide Account") {
          hidden.setHidden(account.id, !hidden.isHidden(account.id))
          dismiss()
        }
      } footer: {
        Text("Hidden accounts are left out of Net Worth on this iPhone only.")
      }
    }
    .tabBarScrollTracking()
    .navigationTitle(account.title)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        if saving {
          ProgressView()
        } else {
          Button("Save", action: save)
            .disabled(patch.isEmpty || !form.isValid)
        }
      }
    }
    .alert(
      "Couldn't Save",
      isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })
    ) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(saveError ?? "")
    }
  }

  private func save() {
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        try await store.save(patch, to: account)
        dismiss()
      } catch {
        saveError = error.message
      }
    }
  }
}
