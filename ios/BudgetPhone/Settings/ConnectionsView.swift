import SwiftUI

/// Settings → Connections (../src/components/SettingsConnections.tsx):
/// debit cards and connected banks. Swipe removes a card, or disconnects a
/// bank (keeping its history) or deletes everything it recorded, each after
/// asking. Connecting a bank (Plaid Link) stays on the Mac.
/// Pull down to reload (GET only; never Plaid's balance refresh).
struct ConnectionsView: View {
  let store: ConnectionsStore
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false
  @State private var removing: DebitCardDTO?
  @State private var disconnecting: BankSummary?
  @State private var deleting: BankSummary?

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Connections")
      .sheet(isPresented: $adding) {
        AddDebitCardSheet(store: store, accounts: store.data?.checkingAccounts ?? [])
      }
      .alert(
        removing.map(ConnectionText.removeTitle) ?? "",
        isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
        presenting: removing
      ) { card in
        Button("Remove", role: .destructive) { Task { await store.perform(.removeCard(id: card.id)) } }
        Button("Cancel", role: .cancel) {}
      }
      .alert(
        disconnecting.map(ConnectionText.disconnectTitle) ?? "",
        isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }),
        presenting: disconnecting
      ) { bank in
        Button("Disconnect", role: .destructive) {
          Task { await store.perform(.disconnect(itemId: bank.itemId)) }
        }
        Button("Cancel", role: .cancel) {}
      } message: { bank in
        Text(ConnectionText.disconnectMessage(bank))
      }
      .modifier(deleteConfirm)
      .task { await store.load() }
  }

  /// Delete… / Delete History…, asked before the write. Its own modifier so
  /// `body` stays within what the type checker can solve.
  private var deleteConfirm: DeleteConfirm {
    DeleteConfirm(bank: $deleting) { bank in
      Task { await store.perform(.deleteHistory(itemId: bank.itemId)) }
    }
  }

  @ViewBuilder private var content: some View {
    if let data = store.data {
      list(data)
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      PlaceholderList.connections
    }
  }

  private func list(_ data: ConnectionsResponse) -> some View {
    List {
      Section {
        ForEach(data.debitCards) { card in
          DebitCardRow(card: card)
            .swipeActions {
              Button("Remove", systemImage: "trash", role: .destructive) { removing = card }
                .disabled(store.isSaving)
            }
        }
        if !data.checkingAccounts.isEmpty {
          Button("Add Debit Card") { adding = true }.disabled(store.isSaving)
        }
      } header: {
        Text("Debit Cards")
      } footer: {
        if data.debitCards.isEmpty {
          Text(data.checkingAccounts.isEmpty ? ConnectionText.noChecking : ConnectionText.noCards)
        }
      }
      Section {
        ForEach(data.banks) { bank in
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(bank.institution)
                .foregroundStyle(bank.isDisconnected ? .secondary : .primary)
              Text(ConnectionText.bankLine(bank)).font(.footnote).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            if store.disconnectingItemId == bank.itemId {
              Spacer(minLength: 0)
              ProgressView()
            }
          }
          // A connected bank: Disconnect (keeps its history) or Delete
          // (removes it). A disconnected bank: Delete History only. No full
          // swipe; each asks first anyway.
          .swipeActions(allowsFullSwipe: false) {
            Button(ConnectionText.deleteAction(bank), systemImage: "trash", role: .destructive) {
              deleting = bank
            }
            .disabled(store.isSaving)
            if !bank.isDisconnected {
              Button("Disconnect", systemImage: "link.badge.minus") { disconnecting = bank }
                .tint(.orange)
                .disabled(store.isSaving)
            }
          }
        }
      } header: {
        Text("Connected Banks")
      } footer: {
        Text(ConnectionText.macFooter)
      }
    }
    .tabBarScrollTracking()
    .listStyle(.insetGrouped)
    .refreshable {
      store.banner = nil
      await store.load()
    }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
    }
  }
}

private struct DeleteConfirm: ViewModifier {
  @Binding var bank: BankSummary?
  let confirm: (BankSummary) -> Void

  func body(content: Content) -> some View {
    content.alert(
      bank.map(ConnectionText.deleteTitle) ?? "",
      isPresented: Binding(get: { bank != nil }, set: { if !$0 { bank = nil } }),
      presenting: bank
    ) { bank in
      Button(ConnectionText.deleteAction(bank), role: .destructive) { confirm(bank) }
      Button("Cancel", role: .cancel) {}
    } message: { bank in
      Text(ConnectionText.deleteMessage(bank))
    }
  }
}

/// One debit card: name, "··0002 · draws from …", and the available amount.
/// At accessibility sizes the amount stacks under the label so it never
/// wraps mid-number.
private struct DebitCardRow: View {
  let card: DebitCardDTO
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    Group {
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 4) {
          label
          amount
        }
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          label
          Spacer(minLength: 0)
          amount
        }
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var label: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(card.name)
      Text(ConnectionText.cardLine(card)).font(.footnote).foregroundStyle(.secondary)
    }
  }

  @ViewBuilder private var amount: some View {
    if let available = ConnectionText.available(card) {
      AmountText(available).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
        .lineLimit(1).fixedSize()
    }
  }
}
