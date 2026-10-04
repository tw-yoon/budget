import SwiftUI

/// Settings → Rules (../src/components/RulesDashboard.tsx) as an iPhone
/// list: Apply Now on top, then the rules in evaluation order with an on/off
/// switch each. + adds, swipe deletes, tap opens the rule. Pull down to
/// reload (GET only; Apply is its own button).
struct RulesView: View {
  let store: RulesStore
  let catalog: CategoryCatalog
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false
  @State private var selected: String?

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Rules")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Add Rule", systemImage: "plus") { adding = true }
            .disabled(store.data == nil)
        }
      }
      .sheet(isPresented: $adding) { AddRuleSheet(store: store, catalog: catalog) }
      .navigationDestination(item: $selected) { id in
        RuleDetailView(id: id, store: store, catalog: catalog)
      }
      .task { await reload() }
  }

  /// Rules and the category catalog together (GET only); the catalog is
  /// otherwise loaded only by the Transactions screen.
  private func reload() async {
    async let categories: Void = catalog.load()
    await store.load()
    await categories
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

  private func list(_ data: RulesResponse) -> some View {
    List {
      Section {
        Button { Task { await store.apply() } } label: {
          if store.isApplying {
            HStack(spacing: 8) {
              ProgressView()
              Text("Applying\u{2026}")
            }
          } else {
            Text("Apply Now")
          }
        }
        .disabled(store.isApplying || store.isSaving)
      }
      Section {
        ForEach(data.rules) { rule in
          RuleRow(rule: rule, store: store) { selected = rule.id }
            .swipeActions {
              Button("Delete", systemImage: "trash", role: .destructive) {
                Task { await store.perform(.delete(id: rule.id)) }
              }
              .disabled(store.isSaving || store.isApplying)
            }
        }
      } footer: {
        Text(RuleText.footer)
      }
    }
    .tabBarScrollTracking()
    .listStyle(.insetGrouped)
    .overlay {
      if data.rules.isEmpty {
        ContentUnavailableView(
          "No Rules", systemImage: "wand.and.stars", description: Text("Tap + to add one."))
          .allowsHitTesting(false)
      }
    }
    .refreshable {
      store.banner = nil
      await reload()
    }
    .safeAreaInset(edge: .top) { RuleMessages(store: store) }
  }
}

/// One rule: what it matches, what it sets, how its matches stand, and an
/// on/off switch. The text opens the rule; the switch only toggles.
struct RuleRow: View {
  let rule: RuleDTO
  let store: RulesStore
  let open: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        Text(
          "\(Text(RuleText.fieldLabel(rule.field) + " " + RuleText.matchLabel(rule.matchType) + " ").foregroundStyle(.secondary))\(Text("\u{201C}\(rule.pattern)\u{201D}").monospaced())"
        )
        Text("\u{2192} \(rule.category)").font(.footnote)
        if let outcome = rule.outcome {
          Text(RuleText.outcomeLine(outcome)).font(.footnote).foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(.rect)
      .onTapGesture(perform: open)
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.isButton)
      Toggle("On", isOn: Binding(get: { rule.enabled }, set: { setEnabled($0) }))
        .labelsHidden()
        .accessibilityLabel(Text(rule.pattern))
        .disabled(store.isSaving || store.isApplying)
    }
    .opacity(rule.enabled ? 1 : 0.5)
  }

  private func setEnabled(_ on: Bool) {
    Task { await store.perform(.setEnabled(id: rule.id, enabled: on)) }
  }
}

/// The store's notice and banner, over every Rules screen.
struct RuleMessages: View {
  let store: RulesStore

  var body: some View {
    VStack(spacing: 8) {
      if let notice = store.notice { Notice(text: notice) { store.notice = nil } }
      if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
    }
  }
}
