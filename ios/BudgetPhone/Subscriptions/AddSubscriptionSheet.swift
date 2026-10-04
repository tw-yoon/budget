import SwiftUI

/// SubscriptionsDashboard's AddForm as a sheet. Add waits for a name and a
/// positive amount; the server's own 400 message shows in the form.
struct AddSubscriptionSheet: View {
  let store: SubscriptionsStore
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var amount = ""
  @State private var cadence: Cadence = .monthly
  @State private var hasNextDate = false
  @State private var nextDate = Date.now
  @State private var saving = false
  @State private var errorMessage: String?

  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var amountValue: Double? {
    Double(amount).flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Name (e.g. Netflix)", text: $name)
          HStack {
            Text("$")
            TextField("Amount", text: $amount).keyboardType(.decimalPad)
          }
          Picker("Cadence", selection: $cadence) {
            ForEach(Cadence.allCases) { Text($0.label).tag($0) }
          }
        }
        Section {
          Toggle("Next Date", isOn: $hasNextDate)
          if hasNextDate {
            DatePicker("Date", selection: $nextDate, displayedComponents: .date)
          }
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Add Subscription")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save).disabled(trimmedName.isEmpty || amountValue == nil)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
  }

  private func save() {
    guard let amountValue else { return }
    let subscription = NewSubscription(
      name: trimmedName, amount: amountValue, cadence: cadence.rawValue,
      nextDate: hasNextDate ? NewSubscription.day(nextDate) : nil)
    saving = true
    errorMessage = nil
    Task {
      do throws(APIError) {
        try await store.add(subscription)
        dismiss()
      } catch {
        saving = false
        if error != .cancelled { errorMessage = error.message }
      }
    }
  }
}
