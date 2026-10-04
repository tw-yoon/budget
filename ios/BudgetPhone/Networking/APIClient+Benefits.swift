import Foundation

// Benefits (../src/app/api/user-cards/**, ../src/app/api/rewards/**,
// ../src/app/api/benefits/**, ../src/app/api/card-art/**). Card art upload
// (PUT /api/user-cards/:id/art) stays on the web.

extension APIClient {
  /// GET /api/user-cards — the cards Benefits shows, in the user's order.
  func userCards() async throws(APIError) -> UserCardsResponse {
    try decode(await send("GET", "api/user-cards", timeout: 15))
  }

  /// A card's `artUrl` is a server path ("/api/card-art/x.png"); this is the
  /// full URL for it.
  func cardArtURL(_ path: String) -> URL {
    baseURL.appending(path: path.hasPrefix("/") ? String(path.dropFirst()) : path)
  }

  /// POST /api/user-cards.
  func addUserCard(_ card: NewUserCard) async throws(APIError) {
    _ = try await send("POST", "api/user-cards", body: encode(card), timeout: 15)
  }

  /// PATCH /api/user-cards/:id — only the changed keys.
  func updateUserCard(id: String, patch: UserCardPatch) async throws(APIError) {
    _ = try await send("PATCH", "api/user-cards/\(id)", body: encode(patch), timeout: 15)
  }

  /// DELETE /api/user-cards/:id — the card and its credits and rates.
  func deleteUserCard(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/user-cards/\(id)", timeout: 15)
  }

  /// POST /api/user-cards/reorder — `{ ids }`, every card in its new order.
  func reorderUserCards(_ ids: [String]) async throws(APIError) {
    _ = try await send("POST", "api/user-cards/reorder", body: encode(CardOrder(ids: ids)), timeout: 15)
  }

  /// POST /api/rewards — add or override a rate.
  func saveRewardRate(_ rate: NewRewardRate) async throws(APIError) {
    _ = try await send("POST", "api/rewards", body: encode(rate), timeout: 15)
  }

  /// DELETE /api/rewards/:id.
  func deleteRewardRate(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/rewards/\(id)", timeout: 15)
  }

  /// POST /api/benefits — a statement credit on a card.
  func addBenefit(_ benefit: NewBenefit) async throws(APIError) {
    _ = try await send("POST", "api/benefits", body: encode(benefit), timeout: 15)
  }

  /// PATCH /api/benefits/:id.
  func updateBenefit(id: String, patch: BenefitPatch) async throws(APIError) {
    _ = try await send("PATCH", "api/benefits/\(id)", body: encode(patch), timeout: 15)
  }

  /// DELETE /api/benefits/:id.
  func deleteBenefit(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/benefits/\(id)", timeout: 15)
  }
}
