import SwiftUI

/// The Analytics tab: the web's AnalyticsDashboard
/// (../src/components/AnalyticsDashboard.tsx).
struct AnalyticsView: View {
  let proMode: ProMode
  /// Bumped by Settings when transaction categories change there.
  let changes: DataChanges
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var store = AnalyticsStore {
    APIClient.saved()
  }
  @State private var subscriptions = SubscriptionsStore {
    APIClient.saved()
  }
  @State private var range = 3
  /// The charts' entrance, once per app session.
  private let entrance = AnalyticsEntrance.session

  var body: some View {
    NavigationStack {
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Analytics")
        .navigationDestination(for: SubscriptionsRoute.self) { _ in
          SubscriptionsView(store: subscriptions)
        }
    }
    .task { await store.load(isPro: proMode.isPro) }
    // The first load to finish with data, or leaving the tab with data
    // showing, ends the entrance: charts created after that just appear.
    .onChange(of: store.isLoading) { _, loading in
      if !loading { entrance.settle(hasData: store.hasData) }
    }
    .onDisappear { entrance.settle(hasData: store.hasData) }
    .task { await subscriptions.load() }
    // Another device may have changed something while this one was away.
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        Task {
          await store.load(isPro: proMode.isPro)
          await subscriptions.load()
        }
      }
    }
    .onChange(of: server) {
      Task {
        await store.load(isPro: proMode.isPro)
        await subscriptions.load()
      }
    }
    // A category edit, Apply Now or Use Rule for These in Settings changed
    // which category spending reports under. GET only.
    .onChange(of: changes.categoriesVersion) {
      Task { await store.load(isPro: proMode.isPro) }
    }
    .onChange(of: changes.accountsVersion) {
      Task { await store.load(isPro: proMode.isPro) }
    }
    .onChange(of: proMode.isPro) { _, pro in
      if pro && store.spending == nil { Task { await store.load(isPro: true) } }
    }
  }

  @ViewBuilder private var content: some View {
    if store.hasData {
      dashboard
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load(isPro: proMode.isPro) } }
    } else {
      ProgressView()
    }
  }

  private var dashboard: some View {
    ScrollView {
      VStack(spacing: 16) {
        summary
        SubscriptionsCard(store: subscriptions)
        if proMode.isPro {
          if let cashflow = store.cashflow {
            CashFlowSankeyCard(months: cashflow, animatesIn: animatesIn)
          }
          SpendingGraphCard(store: store, animatesIn: animatesIn)
        }
        if let cashflow = store.cashflow {
          CategoryChartCard(months: cashflow, animatesIn: animatesIn)
          MonthlyTrendCard(months: cashflow, animatesIn: animatesIn)
        } else {
          cashflowPlaceholder
        }
        if store.summary != nil {
          TopMerchantsCard(merchants: store.topMerchants, range: store.range)
            .opacity(store.isLoadingSummary ? 0.6 : 1)
            .animation(.default, value: store.isLoadingSummary)
        }
        if proMode.hasLoaded && !proMode.isPro {
          Text("Cash flow and cumulative spending are hidden in Normal mode — switch to Pro in Settings.")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
      }
      .padding()
    }
    .tabBarScrollTracking()
    .refreshable {
      await store.refresh(isPro: proMode.isPro)
      await subscriptions.load()  // a GET only; Detect runs from the list or the card's menu
    }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner {
        Banner(text: banner) { store.banner = nil }
      }
    }
  }

  /// Read when a chart is first created; its entrance keeps its own state.
  private var animatesIn: Bool { !entrance.hasPlayed }

  /// Stands in for the cash-flow cards until that series loads, so a failed
  /// load is never shown as "No spending".
  private var cashflowPlaceholder: some View {
    Group {
      if store.isLoading {
        ProgressView()
      } else {
        Text("Couldn't load cash flow.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 120)
    .padding()
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
  }

  private var summary: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Summary over the last \(store.range) months")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      Picker("Range", selection: $range) {
        ForEach(AnalyticsStore.ranges, id: \.self) { Text("\($0)m").tag($0) }
      }
      .pickerStyle(.segmented)
      .onChange(of: range) { _, months in Task { await store.changeRange(months) } }
      if let summary = store.summary {
        SummaryGrid(summary: summary)
          .opacity(store.isLoadingSummary ? 0.6 : 1)
          .animation(.default, value: store.isLoadingSummary)
      }
    }
  }
}
