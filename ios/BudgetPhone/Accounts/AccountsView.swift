import SwiftUI

struct AccountsView: View {
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var store = AccountsStore {
    APIClient.saved()
  }
  @State private var link = MacLinkStore {
    APIClient.saved()
  }
  /// Accounts hidden on this phone only; they stay out of every total.
  @State private var hidden = HiddenAccounts()
  @State private var showHidden = false
  @State private var showLink = false
  @State private var dotFrame = CGRect.zero
  /// Bumped by Settings when a bank is disconnected.
  let changes: DataChanges

  var body: some View {
    NavigationStack {
      content
        .navigationTitle("Accounts")
        .navigationDestination(for: AccountDTO.self) { account in
          AccountEditView(account: account, store: store, hidden: hidden)
        }
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            MacLinkDot(
              link: link.link, updated: store.updatedAt, isShowing: $showLink, frame: $dotFrame)
          }
        }
    }
    // The dot's card, its top-right corner on the dot's circle; a tap
    // anywhere closes it. Laid out over the whole screen, so the dot's
    // measured (global) frame is in the same coordinates.
    .overlay {
      if showLink {
        GeometryReader { screen in
          let place = MacLinkCard.placement(dot: dotFrame, screenWidth: screen.size.width)
          ZStack(alignment: .topTrailing) {
            Color.clear
              .contentShape(.rect)
              .onTapGesture { withAnimation(.snappy) { showLink = false } }
              .accessibilityHidden(true)
            MacLinkCard(link: link.link, updated: store.updatedAt)
              .padding(.leading, 16)
              .padding(.trailing, place.trailing)
              .padding(.top, place.top)
              .transition(.scale(scale: 0.5, anchor: .topTrailing).combined(with: .opacity))
              .accessibilityAction(.escape) { withAnimation(.snappy) { showLink = false } }
          }
        }
        .ignoresSafeArea()
      }
    }
    .task { await store.load() }
    // Another device may have changed something while this one was away.
    .onChange(of: scenePhase) { _, phase in
      showLink = false
      if phase == .active { Task { await store.load() } }
    }
    .onChange(of: server) {
      link.serverChanged()
      Task { await store.load() }
      Task { await link.check() }
    }
    // The connection dot asks the Mac again every so often while Accounts is
    // on screen and the app is in front. Ends when either stops.
    .task(id: scenePhase) {
      guard scenePhase == .active else { return }
      while !Task.isCancelled {
        await link.check()
        try? await Task.sleep(for: MacLinkStore.interval)
      }
    }
    // A bank disconnected in Settings. GET only: never refreshes from Plaid.
    .onChange(of: changes.accountsVersion) { Task { await store.load() } }
  }

  @ViewBuilder private var content: some View {
    if let data = store.data {
      // No accounts at all. (`accountCount` leaves out disconnected banks,
      // whose accounts are still listed.)
      if data.groups.isEmpty {
        ContentUnavailableView(
          "No Accounts", systemImage: "building.columns",
          description: Text("Connect a bank from Budget on your Mac."))
      } else {
        list(data)
      }
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView()
    }
  }

  private func list(_ data: AccountsResponse) -> some View {
    let shown = AccountTotals.visible(data, hidden: hidden.ids, showHidden: showHidden)
    let hiddenCount = hidden.count(in: data)
    return List {
      Section {
        NetWorthHeader(summary: shown.summary)
      }
      ForEach(shown.groups) { group in
        Section {
          ForEach(group.accounts) { account in
            let isHidden = hidden.isHidden(account.id)
            NavigationLink(value: account) {
              AccountRow(account: account)
            }
            // Shown only with Show Hidden on: dimmed, and still left out of
            // the subtotal and Net Worth above.
            .opacity(isHidden ? 0.5 : 1)
            .accessibilityValue(isHidden ? "Hidden" : "")
            .swipeActions {
              Button(isHidden ? "Unhide" : "Hide", systemImage: isHidden ? "eye" : "eye.slash") {
                hidden.setHidden(account.id, !isHidden)
              }
              .tint(.gray)
            }
          }
        } header: {
          GroupHeader(group: group)
        }
      }
      if hiddenCount > 0 {
        Section {
          Toggle("Show Hidden Accounts (\(hiddenCount))", isOn: $showHidden)
        }
      }
    }
    .tabBarScrollTracking()
    .listStyle(.insetGrouped)
    .refreshable { await store.refresh() }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner {
        Banner(text: banner) { store.banner = nil }
      }
    }
  }
}

extension AccountDTO: Hashable {
  func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// A group's label and subtotal. Stacked at accessibility sizes so the
/// amount never wraps digit by digit inside the header's narrow width.
private struct GroupHeader: View {
  let group: AccountGroup
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let amount = AmountText(Formatters.currency(group.signedSubtotal))
      .monospacedDigit()
      .lineLimit(1)
      .minimumScaleFactor(0.6)
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) {
        Text(group.label)
        amount
      }
    } else {
      HStack {
        Text(group.label)
        Spacer()
        amount
      }
    }
  }
}
