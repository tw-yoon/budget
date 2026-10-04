import SwiftUI

/// One rule: what it matches (read-only, as on the web), the category it
/// sets, on/off, how its matches stand with Use Rule for These, and delete.
/// Reads the rule from the store by id and pops once it is gone.
struct RuleDetailView: View {
  let id: String
  let store: RulesStore
  let catalog: CategoryCatalog
  @Environment(\.dismiss) private var dismiss
  @State private var category = ""
  @State private var subcategory = ""
  @State private var confirmingTakeOver = false

  private var rule: RuleDTO? { store.rule(id: id) }
  private var busy: Bool { store.isSaving || store.isApplying }

  var body: some View {
    Group {
      if let rule { form(rule) } else { Color.clear }
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle("Rule")
    .navigationBarTitleDisplayMode(.inline)
    .onChange(of: rule == nil) { _, gone in if gone { dismiss() } }
  }

  private func form(_ r: RuleDTO) -> some View {
    Form {
      Section("Match") {
        LabeledContent("Field", value: RuleText.fieldLabel(r.field))
        LabeledContent("Match", value: RuleText.matchLabel(r.matchType))
        LabeledContent("Pattern") { Text(r.pattern).monospaced() }
      }
      Section("Category") {
        CategoryFields(
          options: RuleText.categoryOptions(catalog.names, current: CategoryPath.split(r.category).parent),
          knownSubs: { catalog.subcategories(of: $0) },
          category: $category, subcategory: $subcategory)
        if !category.isEmpty && CategoryPath.join(category, subcategory) != r.category {
          Button("Save") { save(r) }.disabled(busy)
        }
      }
      Section {
        Toggle("On", isOn: Binding(get: { r.enabled }, set: { setEnabled(r, $0) }))
          .disabled(busy)
      }
      if let o = r.outcome {
        Section("Matches") {
          LabeledContent("Set by this rule", value: "\(o.applied)")
          LabeledContent("Waiting for Apply Now", value: "\(o.pending)")
          LabeledContent("Set by hand (kept)", value: "\(o.handSet)")
          if o.handSet > 0 {
            Button("Use Rule for These") { confirmingTakeOver = true }.disabled(busy)
          }
        }
      }
      Section {
        Button("Delete Rule", role: .destructive) {
          Task { await store.perform(.delete(id: r.id)) }
        }
        .disabled(busy)
      }
    }
    .tabBarScrollTracking()
    .safeAreaInset(edge: .top) { RuleMessages(store: store) }
    .onAppear { seed(r) }
    .onChange(of: r.category) { _, _ in seed(r) }
    .alert(
      RuleText.takeOverTitle(count: r.outcome?.handSet ?? 0, pattern: r.pattern, category: r.category),
      isPresented: $confirmingTakeOver
    ) {
      Button("Use Rule") { Task { await store.perform(.takeOver(id: r.id)) } }
        .disabled(busy)
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(RuleText.takeOverMessage)
    }
  }

  /// The pickers start from the rule's own "Parent > Sub" (splitCategory).
  private func seed(_ r: RuleDTO) {
    let (parent, sub) = CategoryPath.split(r.category)
    category = parent
    subcategory = sub ?? ""
  }

  private func save(_ r: RuleDTO) {
    let next = CategoryPath.join(category, subcategory)
    guard next != r.category else { return }
    Task {
      await store.perform(.setCategory(id: r.id, category: next))
      if store.banner == nil { catalog.noteUsed(next) }
    }
  }

  private func setEnabled(_ r: RuleDTO, _ on: Bool) {
    Task { await store.perform(.setEnabled(id: r.id, enabled: on)) }
  }
}
