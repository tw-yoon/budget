import Foundation
import Observation

/// One Benefits → Cards write. An enum rather than a closure, so the store
/// keeps the typed error (see TransactionDetailView.Write).
enum CardWrite: Equatable, Sendable {
  case addCard(NewUserCard)
  case updateCard(id: String, UserCardPatch)
  case deleteCard(id: String)
  case saveRate(NewRewardRate)
  case deleteRate(id: String)
  case addBenefit(NewBenefit)
  case updateBenefit(id: String, BenefitPatch)
  case deleteBenefit(id: String)
}

/// The cards Benefits shows (useUserCards in
/// ../src/components/benefits/useUserCards.ts). One copy for both segments,
/// so Best card reflects an edit made under Cards. Same failure rules as
/// AccountsStore: with nothing on screen an error is full-screen; with data
/// showing it becomes a banner and the data stays.
@MainActor
@Observable
final class BenefitsStore {
  private(set) var cards: [UserCardDTO]?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// One write at a time.
  private(set) var isSaving = false
  var banner: String?

  private let client: @MainActor () -> APIClient?
  private let art: CardArtCache
  private var loadGeneration = 0

  init(client: @escaping @MainActor () -> APIClient?, art: CardArtCache = .shared) {
    self.client = client
    self.art = art
  }

  func load() async {
    loadGeneration += 1
    let generation = loadGeneration
    guard let client = client() else {
      cards = nil
      error = .notConfigured
      return
    }
    if cards == nil {
      error = nil
      if let saved = client.savedUserCards()?.cards {
        cards = saved
        art.load(saved.compactMap { $0.artUrl.map(client.cardArtURL) })
      }
    }
    isLoading = true
    defer { if generation == loadGeneration { isLoading = false } }
    do throws(APIError) {
      let result = try await client.userCards()
      guard generation == loadGeneration else { return }
      cards = result.cards
      error = nil
      banner = nil
      // Fetch every face now, not as rows scroll into view.
      art.load(result.cards.compactMap { $0.artUrl.map(client.cardArtURL) })
    } catch {
      guard generation == loadGeneration else { return }
      if error == .cancelled { return }
      if cards == nil { self.error = error } else { banner = error.message }
    }
  }

  /// A card image's full URL on the current server.
  func artURL(_ path: String) -> URL? { client()?.cardArtURL(path) }

  /// The latest copy of a card, for screens pushed by id.
  func card(id: String) -> UserCardDTO? { cards?.first { $0.id == id } }

  /// Runs one write from a sheet or a detail screen, then reloads. Throws so
  /// the caller keeps its fields and says why; a stale banner clears first.
  /// A second write while one is in flight is ignored.
  static let stillSaving = "Still saving the last change. Try again in a moment."

  func perform(_ write: CardWrite) async throws(APIError) {
    // Throws rather than returning, so a sheet whose Save lands while
    // another change is still saving stays open and says so, instead of
    // closing as if it had saved.
    guard !isSaving else { throw .server(status: 0, message: Self.stillSaving) }
    guard let client = client() else { throw .notConfigured }
    isSaving = true
    defer { isSaving = false }
    banner = nil
    switch write {
    case .addCard(let card): try await client.addUserCard(card)
    case .updateCard(let id, let patch):
      guard !patch.isEmpty else { return }
      try await client.updateUserCard(id: id, patch: patch)
    case .deleteCard(let id): try await client.deleteUserCard(id: id)
    case .saveRate(let rate): try await client.saveRewardRate(rate)
    case .deleteRate(let id): try await client.deleteRewardRate(id: id)
    case .addBenefit(let benefit): try await client.addBenefit(benefit)
    case .updateBenefit(let id, let patch): try await client.updateBenefit(id: id, patch: patch)
    case .deleteBenefit(let id): try await client.deleteBenefit(id: id)
    }
    await load()
  }

  /// The list's swipe Remove: the row goes at once, then the delete. A
  /// failure reloads (bringing the row back) and says so.
  func remove(_ card: UserCardDTO) async {
    guard let client = client() else { return }
    banner = nil
    loadGeneration += 1  // an older GET must not bring the row back
    cards?.removeAll { $0.id == card.id }
    do throws(APIError) {
      try await client.deleteUserCard(id: card.id)
      await load()
    } catch {
      await load()
      if error != .cancelled { banner = "Couldn't remove \(CardRules.issuerAndLast4(card))." }
    }
  }

  /// Edit mode's drag: the new order shows at once, then every id is saved.
  /// The web fires and forgets; here a failure reloads the saved order and
  /// says so.
  func move(from source: IndexSet, to destination: Int) async {
    guard let client = client(), let current = cards else { return }
    banner = nil
    let list = CardRules.moved(current, from: source, to: destination)
    guard list.map(\.id) != cards?.map(\.id) else { return }
    loadGeneration += 1  // an older GET must not undo the move
    cards = list
    do throws(APIError) {
      try await client.reorderUserCards(list.map(\.id))
    } catch {
      await load()
      if error != .cancelled { banner = "Couldn't save the new order." }
    }
  }
}
