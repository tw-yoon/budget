import SwiftUI

/// The Benefits tab (../src/app/benefits): Cards and Best card behind a
/// segmented control, in the web sidebar's order. Cards is the default, as
/// /benefits redirects there. Both segments read one store, so an edit under
/// Cards reaches Best card.
struct BenefitsView: View {
  enum Segment: String, CaseIterable, Identifiable {
    case cards, best
    var id: Self { self }
    var title: String {
      switch self {
      case .cards: "Cards"
      case .best: "Best card"
      }
    }
  }

  @SceneStorage("benefits.segment") private var segment: Segment = .cards
  @Environment(\.scenePhase) private var scenePhase
  /// Absent in previews.
  @Environment(TabBarState.self) private var tabBar: TabBarState?
  @AppStorage(ServerAddress.storageKey) private var server = ""
  /// Cards' Edit mode. Held here so leaving Cards ends it.
  @State private var editMode: EditMode = .inactive
  /// The screen's width, for SwitcherBar.
  @State private var width: CGFloat = 0
  /// Owned by RootView, which loads it at launch so the card faces are
  /// fetched before this tab is first opened.
  let store: BenefitsStore

  var body: some View {
    NavigationStack {
      Group {
        switch segment {
        case .cards: CardsView(store: store)
        case .best: BestCardsView(store: store)
        }
      }
      // Every state of both segments sits on the same grey (as Activity).
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(.systemGroupedBackground))
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
      .navigationTitle("Card Benefits")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) {
          // Cards' Edit fades out on Best card (SwitcherBar).
          SwitcherBar(selection: $segment, segments: Segment.allCases, title: \.title, width: width) {
            if $0 == .cards { editButton }
          }
        }
      }
      .environment(\.editMode, $editMode)
      .navigationDestination(for: CardRoute.self) { route in
        CardDetailView(id: route.id, store: store)
      }
      .navigationDestination(for: CreditRoute.self) { route in
        CreditDetailView(cardId: route.cardId, id: route.id, store: store)
      }
    }
    .onChange(of: segment) {
      tabBar?.expand()
      editMode = .inactive
    }
    .task { await store.load() }
    // Another device may have changed something while this one was away.
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await store.load() } }
    }
    .onChange(of: server) { Task { await store.load() } }
  }
}

extension BenefitsView {
  private var editButton: some View {
    EditButton()
      .font(.body.weight(.medium))
      .barGlass(icon: false)
      .disabled(store.cards?.isEmpty ?? true)
  }
}

/// Pushes a card's detail. By id, so the screen shows the store's latest copy.
struct CardRoute: Hashable {
  let id: String
}

/// Pushes one statement credit of a card.
struct CreditRoute: Hashable {
  let cardId: String
  let id: String
}
