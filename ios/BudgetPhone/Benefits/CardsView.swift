import SwiftUI

/// Benefits → Cards (../src/components/benefits/CardsSection.tsx): every card
/// in the user's order. A row pushes the card; swipe removes it; Edit drags
/// to reorder (its button is BenefitsView's, so it can fade). Pull down to reload (GET only).
struct CardsView: View {
  let store: BenefitsStore
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var adding = false
  @State private var removing: UserCardDTO?

  var body: some View {
    content
      .sheet(isPresented: $adding) { AddCardSheet(store: store) }
      .alert(
        removing.map(CardRules.removeCardPrompt) ?? "",
        isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
        presenting: removing
      ) { card in
        Button("Remove", role: .destructive) { Task { await store.remove(card) } }
        Button("Cancel", role: .cancel) {}
      }
  }

  @ViewBuilder private var content: some View {
    if let cards = store.cards {
      list(cards)
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView()
    }
  }

  private func list(_ cards: [UserCardDTO]) -> some View {
    List {
      if !cards.isEmpty {
        Section {
          ForEach(cards) { card in
            NavigationLink(value: CardRoute(id: card.id)) {
              CardRow(card: card, artURL: card.artUrl.flatMap(store.artURL))
            }
            .swipeActions {
              Button("Remove", systemImage: "trash", role: .destructive) { removing = card }
            }
          }
          .onMove { from, to in Task { await store.move(from: from, to: to) } }
        }
      }
      Section {
        Button("Add Card") { adding = true }
      } footer: {
        Text("Earning rates are pre-filled from a ~2025 snapshot and statement credits are whatever you enter. Always verify current terms with your issuer.")
      }
    }
    .tabBarScrollTracking()
    .listStyle(.insetGrouped)
    .overlay {
      if cards.isEmpty {
        ContentUnavailableView(
          "No Cards", systemImage: "creditcard",
          description: Text("Add one to start tracking its benefits."))
          .allowsHitTesting(false)
      }
    }
    .refreshable {
      store.banner = nil
      await store.load()
    }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner { Banner(text: banner) { store.banner = nil } }
    }
  }
}

/// A card in the list: its face, title, issuer and last four, and how many
/// credits are maxed.
private struct CardRow: View {
  let card: UserCardDTO
  let artURL: URL?
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
      : AnyLayout(HStackLayout(spacing: 12))
    layout {
      CardArtView(card: card, artURL: artURL, width: 64)
      VStack(alignment: .leading, spacing: 2) {
        Text(CardRules.title(card)).fontWeight(.medium).lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
        Text(CardRules.issuerAndLast4(card)).monospacedDigit()
          .font(.subheadline).foregroundStyle(.secondary)
        Text(CardRules.creditsMaxed(card)).font(.subheadline).foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 2)
  }
}
