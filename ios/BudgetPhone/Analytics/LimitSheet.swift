import SwiftUI

/// Edits the Spending graph's monthly limit. The web's inline number field
/// saves 0 for anything unreadable; here Save waits for a number instead.
struct LimitSheet: View {
  let save: (Double) -> Void
  @State private var text: String
  @Environment(\.dismiss) private var dismiss

  init(limit: Double, save: @escaping (Double) -> Void) {
    self.save = save
    _text = State(initialValue: Formatters.plainNumber(limit))
  }

  private var value: Double? { Double(text).flatMap { $0.isFinite ? $0 : nil } }

  var body: some View {
    NavigationStack {
      Form {
        HStack {
          Text("$")
          TextField("Limit", text: $text)
            .keyboardType(.decimalPad)
            .monospacedDigit()
        }
      }
      .navigationTitle("Monthly Limit")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            if let value { save(max(0, value)) }
            dismiss()
          }
          .disabled(value == nil)
        }
      }
    }
    .presentationDetents([.medium])
  }
}
