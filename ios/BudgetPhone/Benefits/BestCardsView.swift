import SwiftUI

/// Benefits → Best card (../src/components/benefits/BestCards.tsx): for each
/// bonus category, the card that earns most, and the next two.
struct BestCardsView: View {
  let store: BenefitsStore
  @AppStorage(ServerAddress.storageKey) private var server = ""

  var body: some View {
    if let cards = store.cards {
      list(cards)
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func list(_ cards: [UserCardDTO]) -> some View {
    let showTable = !cards.isEmpty && Rewards.hasRates(cards)
    return List {
      if showTable {
        Section {
          ForEach(Rewards.bestByCategory(cards)) { row in
            BestCardRow(row: row, artURL: { $0.artUrl.flatMap(store.artURL) })
          }
        } header: {
          Text("Best card by category")
        } footer: {
          Text("Ranked by raw rate · points and cashback aren't directly comparable.")
        }
        Section {
        } footer: {
          Text("Earning rates are pre-filled from a ~2025 snapshot and statement credits are whatever you enter. Always verify current terms with your issuer.")
        }
      }
    }
    .tabBarScrollTracking()
    .listStyle(.insetGrouped)
    .overlay {
      if !showTable {
        ContentUnavailableView(
          "No Cards", systemImage: "creditcard",
          description: Text("Add a card under Cards to see which one earns most where."))
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

/// One category: the label, the winner's face, name and rate, and the
/// runners-up. The name and rate stack at accessibility sizes.
private struct BestCardRow: View {
  let row: CategoryRanking
  let artURL: (UserCardDTO) -> URL?
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(row.label).font(.caption).textCase(.uppercase).foregroundStyle(.secondary)
      if let best = row.ranked.first {
        HStack(alignment: .top, spacing: 12) {
          CardArtView(card: best.card, artURL: artURL(best.card), width: 80)
          VStack(alignment: .leading, spacing: 6) {
            winner(best)
            runners
          }
        }
      }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private func winner(_ best: RankedCard) -> some View {
    let name = Text(Rewards.shortLabel(best.card)).fontWeight(.medium)
    let rate = HStack(spacing: 0) {
      Text(best.rate.formatted)
      if !best.rate.isBonus { Text(" base").foregroundStyle(.secondary) }
    }
    .monospacedDigit()
    .lineLimit(1)
    .fixedSize()
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 2) { name; rate }
    } else {
      HStack(alignment: .firstTextBaseline) {
        name.lineLimit(1)
        Spacer(minLength: 8)
        rate
      }
    }
  }

  private var runners: some View {
    let others = Array(row.ranked.dropFirst().prefix(2))
    let items = ForEach(others, id: \.card.id) { runner in
      HStack(spacing: 6) {
        CardArtView(card: runner.card, artURL: artURL(runner.card), width: 28)
        Text(runner.rate.formatted).monospacedDigit().lineLimit(1).fixedSize()
      }
    }
    return Group {
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 4) { items }
      } else {
        HStack(spacing: 12) { items }
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}
