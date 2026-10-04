import SwiftUI

/// One category: its name, subcategories, Plaid labels and delete
/// (../src/components/SettingsCategories.tsx, one table row and its sub
/// rows). Reads the category from the store by id, so it follows every
/// reload, and pops itself once a merge or delete removes it.
struct CategoryDetailView: View {
  let id: String
  let store: CategoriesStore
  @Environment(\.dismiss) private var dismiss
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var name = ""
  @State private var merge: PendingMerge?
  @State private var deleting: AdminCategory?
  @State private var deletingSub: AdminSubcategory?
  @State private var renamingSub: AdminSubcategory?
  @State private var addingSub = false
  @State private var subName = ""

  /// A rename the server wants confirmed, and the write that confirms it.
  struct PendingMerge {
    let title: String
    let message: String
    let confirm: CategoryWrite
  }

  private var category: AdminCategory? { store.category(id: id) }

  var body: some View {
    Group {
      if let c = category { form(c) } else { Color.clear }
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle(category?.name ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .onChange(of: category == nil) { _, gone in if gone { dismiss() } }
  }

  private func form(_ c: AdminCategory) -> some View {
    Form {
      nameSection(c)
      subcategorySection(c)
      Section("Plaid Labels") {
        ForEach(store.data?.primaries ?? [], id: \.self) { p in
          Button { toggle(c, p) } label: {
            HStack {
              Text(p).font(.footnote.monospaced())
              Spacer()
              if c.plaidPrimaries.contains(p) {
                Image(systemName: "checkmark").foregroundStyle(.tint)
              }
            }
          }
          .foregroundStyle(.primary)
          .disabled(store.isSaving)
        }
      }
      Section {
        Button("Delete Category", role: .destructive) { deleting = c }
          .disabled(CategoryRules.isReserved(c) || store.isSaving)
      }
    }
    .tabBarScrollTracking()
    .safeAreaInset(edge: .top) { CategoryMessages(store: store) }
    .onAppear { name = c.name }
    .onChange(of: c.name) { _, new in name = new }
    .modifier(CategoryDeleteAlert(target: $deleting, store: store))
    .alert(
      merge?.title ?? "",
      isPresented: Binding(get: { merge != nil }, set: { if !$0 { merge = nil } }),
      presenting: merge
    ) { m in
      Button("Merge") {
        Task {
          await store.perform(m.confirm)
          name = store.category(id: c.id)?.name ?? name
        }
      }
      Button("Cancel", role: .cancel) { name = c.name }
    } message: { m in
      Text(m.message)
    }
    .alert("Rename Subcategory", isPresented: Binding(get: { renamingSub != nil }, set: { if !$0 { renamingSub = nil } }), presenting: renamingSub) { s in
      TextField("Name", text: $subName)
      Button("Cancel", role: .cancel) {}
      Button("Save") { renameSub(c, s) }
    }
    .alert("New Subcategory", isPresented: $addingSub) {
      TextField("New subcategory of \(c.name)", text: $subName)
      Button("Cancel", role: .cancel) {}
      Button("Add") { addSub(c) }
    }
    .alert(
      deletingSub.map { CategoryRules.deleteSubTitle(category: c.name, sub: $0.name) } ?? "",
      isPresented: Binding(get: { deletingSub != nil }, set: { if !$0 { deletingSub = nil } }),
      presenting: deletingSub
    ) { s in
      Button("Delete", role: .destructive) {
        Task { await store.perform(.deleteSub(categoryId: c.id, name: s.name)) }
      }
      Button("Cancel", role: .cancel) {}
    } message: { s in
      if let message = CategoryRules.deleteSubMessage(category: c.name, s) { Text(message) }
    }
  }

  @ViewBuilder private func nameSection(_ c: AdminCategory) -> some View {
    if CategoryRules.isReserved(c) {
      Section {
        // Greyed, so it doesn't read as an editable field.
        Text(c.name).foregroundStyle(.secondary)
      } header: {
        Text("Name")
      } footer: {
        Text(CategoryRules.reservedNote)
      }
    } else {
      Section("Name") {
        TextField("Name", text: $name)
          .submitLabel(.done)
          .onSubmit { rename(c) }
          .disabled(store.isSaving)
      }
    }
  }

  private func subcategorySection(_ c: AdminCategory) -> some View {
    Section("Subcategories") {
      ForEach(c.subcategories) { s in
        Button {
          subName = s.name
          renamingSub = s
        } label: {
          VStack(alignment: .leading, spacing: 2) {
            nameAndBadge(s)
            Text(CategoryRules.usage(s)).font(.footnote).foregroundStyle(.secondary)
          }
        }
        .foregroundStyle(.primary)
        .swipeActions {
          if CategoryRules.isResetOnly(s) {
            Button("Reset") { Task { await store.perform(.deleteSub(categoryId: c.id, name: s.name)) } }
              .disabled(store.isSaving)
          } else if CategoryRules.isDeletable(s) {
            Button("Delete", systemImage: "trash", role: .destructive) { deletingSub = s }
              .disabled(store.isSaving)
          }
        }
      }
      Button("Add Subcategory") {
        subName = ""
        addingSub = true
      }
      .disabled(store.isSaving)
    }
  }

  @ViewBuilder private func nameAndBadge(_ s: AdminSubcategory) -> some View {
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 4) {
        Text(s.name)
        plaidBadge(s)
      }
    } else {
      HStack(spacing: 6) {
        Text(s.name)
        plaidBadge(s)
      }
    }
  }

  @ViewBuilder private func plaidBadge(_ s: AdminSubcategory) -> some View {
    if let badge = CategoryRules.plaidBadge(s) {
      Text(badge)
        .font(.caption2.weight(.medium))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(.blue.opacity(0.15), in: .rect(cornerRadius: 4))
        .foregroundStyle(.blue)
    }
  }

  private func rename(_ c: AdminCategory) {
    guard let to = CategoryRules.cleanName(name), to != c.name else {
      name = c.name
      return
    }
    Task {
      if let prompt = await store.perform(.rename(id: c.id, name: to, allowMerge: false)) {
        merge = PendingMerge(
          title: CategoryRules.mergeTitle(from: c.name, prompt),
          message: CategoryRules.mergeMessage(from: c.name, prompt),
          confirm: .rename(id: c.id, name: to, allowMerge: true))
      } else {
        // Saved (the reload brought the new name) or failed (a banner says why).
        name = store.category(id: c.id)?.name ?? name
      }
    }
  }

  private func renameSub(_ c: AdminCategory, _ s: AdminSubcategory) {
    guard let to = CategoryRules.cleanName(subName), to != s.name else { return }
    Task {
      if let prompt = await store.perform(
        .renameSub(categoryId: c.id, from: s.name, to: to, allowMerge: false))
      {
        merge = PendingMerge(
          title: CategoryRules.mergeTitle(from: s.name, prompt),
          message: CategoryRules.subMergeMessage(category: c.name, prompt),
          confirm: .renameSub(categoryId: c.id, from: s.name, to: to, allowMerge: true))
      }
    }
  }

  private func addSub(_ c: AdminCategory) {
    guard let new = CategoryRules.cleanName(subName) else { return }
    Task { await store.perform(.createSub(categoryId: c.id, name: new)) }
  }

  private func toggle(_ c: AdminCategory, _ primary: String) {
    let next =
      c.plaidPrimaries.contains(primary)
      ? c.plaidPrimaries.filter { $0 != primary }
      : c.plaidPrimaries + [primary]
    Task { await store.perform(.setPrimaries(id: c.id, primaries: next)) }
  }
}
