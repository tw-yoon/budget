import SwiftUI

/// RulesDashboard's RuleForm as a sheet. Add waits for a pattern and a
/// category; the server's own message shows in the form, which keeps its
/// fields.
struct AddRuleSheet: View {
  let store: RulesStore
  let catalog: CategoryCatalog
  @Environment(\.dismiss) private var dismiss
  @State private var field = "EITHER"
  @State private var matchType = "CONTAINS"
  @State private var pattern = ""
  @State private var category = ""
  @State private var subcategory = ""
  @State private var saving = false
  @State private var errorMessage: String?

  private var trimmedPattern: String { pattern.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Field", selection: $field) {
            ForEach(RuleText.fields, id: \.self) { Text(RuleText.fieldLabel($0)).tag($0) }
          }
          Picker("Match", selection: $matchType) {
            ForEach(RuleText.matchTypes, id: \.self) { Text(RuleText.matchLabel($0)).tag($0) }
          }
          TextField("Pattern (e.g. Starbucks)", text: $pattern)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        Section("Category") {
          CategoryFields(
            options: catalog.names,
            knownSubs: { catalog.subcategories(of: $0) },
            category: $category, subcategory: $subcategory)
        }
        if let errorMessage {
          Section { Text(errorMessage).foregroundStyle(.red) }
        }
      }
      .disabled(saving)
      .navigationTitle("Add Rule")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Add", action: save).disabled(trimmedPattern.isEmpty || category.isEmpty)
          }
        }
      }
    }
    .interactiveDismissDisabled(saving)
    .onAppear(perform: seedCategory)
    .onChange(of: catalog.names) { seedCategory() }
  }

  /// The web defaults to the first category, even one that loads after the
  /// form opens.
  private func seedCategory() {
    if category.isEmpty { category = catalog.names.first ?? "" }
  }

  private func save() {
    let rule = NewRule(
      field: field, matchType: matchType, pattern: trimmedPattern,
      category: CategoryPath.join(category, subcategory))
    saving = true
    errorMessage = nil
    Task {
      do throws(APIError) {
        try await store.add(rule)
        catalog.noteUsed(rule.category)
        dismiss()
      } catch {
        saving = false
        if error != .cancelled { errorMessage = error.message }
      }
    }
  }
}
