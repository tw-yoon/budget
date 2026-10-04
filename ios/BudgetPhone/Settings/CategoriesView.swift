import SwiftUI

/// Settings → Categories (../src/components/SettingsCategories.tsx) as an
/// iPhone list: + adds, swipe deletes, tap opens the category. Pull down to
/// reload (GET only; nothing here calls Plaid).
struct CategoriesView: View {
  let store: CategoriesStore
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false
  @State private var newName = ""
  @State private var deleting: AdminCategory?

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Categories")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Add Category", systemImage: "plus") {
            newName = ""
            adding = true
          }
          .disabled(store.data == nil || store.isSaving)
        }
      }
      .alert("New Category", isPresented: $adding) {
        TextField("New category", text: $newName)
        Button("Cancel", role: .cancel) {}
        Button("Add") { add() }
      }
      .modifier(CategoryDeleteAlert(target: $deleting, store: store))
      .task { await store.load() }
  }

  @ViewBuilder private var content: some View {
    if let data = store.data {
      list(data)
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView()
    }
  }

  private func list(_ data: CategoriesAdminResponse) -> some View {
    List {
      if !data.unmappedPrimaries.isEmpty {
        Section {
          Label {
            VStack(alignment: .leading, spacing: 4) {
              Text(CategoryRules.unmappedHeadline(data.unmappedPrimaries))
                .font(.subheadline.weight(.medium))
              Text(CategoryRules.unmappedDetail).font(.footnote).foregroundStyle(.secondary)
            }
          } icon: {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
          }
        }
      }
      Section {
        ForEach(data.categories) { c in
          NavigationLink {
            CategoryDetailView(id: c.id, store: store)
          } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(c.name)
              Text(CategoryRules.usage(c)).font(.footnote).foregroundStyle(.secondary)
            }
          }
          .swipeActions {
            if !CategoryRules.isReserved(c) {
              Button("Delete", systemImage: "trash", role: .destructive) { deleting = c }
                .disabled(store.isSaving)
            }
          }
        }
      }
    }
    .tabBarScrollTracking()
    .listStyle(.insetGrouped)
    .refreshable {
      store.banner = nil
      await store.load()
    }
    .safeAreaInset(edge: .top) { CategoryMessages(store: store) }
  }

  private func add() {
    guard let name = CategoryRules.cleanName(newName) else { return }
    Task { await store.perform(.create(name: name)) }
  }
}

/// The store's notice and banner, over both Categories screens.
struct CategoryMessages: View {
  let store: CategoriesStore

  var body: some View {
    VStack(spacing: 8) {
      if let notice = store.notice { Notice(text: notice) { store.notice = nil } }
      if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
    }
  }
}

/// The web's `confirm("Delete …?")` for a category, as an alert.
struct CategoryDeleteAlert: ViewModifier {
  @Binding var target: AdminCategory?
  let store: CategoriesStore

  func body(content: Content) -> some View {
    content.alert(
      target.map { CategoryRules.deleteTitle($0.name) } ?? "",
      isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }),
      presenting: target
    ) { c in
      Button("Delete", role: .destructive) { Task { await store.perform(.delete(id: c.id)) } }
      Button("Cancel", role: .cancel) {}
    } message: { c in
      if let message = CategoryRules.deleteMessage(c) { Text(message) }
    }
  }
}
