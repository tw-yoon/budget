import SwiftUI

/// The Subscriptions list (../src/components/SubscriptionsDashboard.tsx),
/// pushed from the Analytics card. Pull down to detect from banks; + adds;
/// swipe to delete.
struct SubscriptionsView: View {
  let store: SubscriptionsStore
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Subscriptions")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Add Subscription", systemImage: "plus") { adding = true }
        }
      }
      .sheet(isPresented: $adding) { AddSubscriptionSheet(store: store) }
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

  private func list(_ data: SubscriptionsResponse) -> some View {
    List {
      if !data.subscriptions.isEmpty {
        Section {
          ForEach(data.subscriptions) { subscription in
            SubscriptionRow(subscription: subscription)
              .swipeActions {
                Button("Delete", systemImage: "trash", role: .destructive) {
                  Task { await store.delete(subscription) }
                }
              }
          }
        } header: {
          AmountText(data.summary).textCase(nil).monospacedDigit()
        } footer: {
          Text("Detection finds recurring charges from your transactions. It tries to skip rent, loans, and transfers, but isn't perfect. Delete anything that isn't a subscription.")
        }
      }
    }
    .tabBarScrollTracking()
    .listStyle(.insetGrouped)
    .overlay {
      if data.subscriptions.isEmpty {
        ContentUnavailableView(
          "No Subscriptions", systemImage: "repeat",
          description: Text("Pull down to detect from your banks, or tap + to add one."))
          .allowsHitTesting(false)
      }
    }
    .refreshable { await store.detect() }
    .safeAreaInset(edge: .top) {
      VStack(spacing: 8) {
        if let notice = store.notice { Notice(text: notice) { store.notice = nil } }
        if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
      }
    }
  }
}
