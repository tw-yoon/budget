import Foundation

/// A card's rate for one category (effectiveRate in ../src/lib/rewards.ts).
struct EffectiveRate: Equatable, Sendable {
  let multiplier: Double
  let unit: String
  let isBonus: Bool

  var formatted: String { Rewards.formatRate(multiplier, unit) }
}

struct RankedCard: Equatable, Sendable {
  let card: UserCardDTO
  let rate: EffectiveRate
}

/// One row of Best card: a category and every card, best first.
struct CategoryRanking: Equatable, Identifiable, Sendable {
  let category: String
  let label: String
  let ranked: [RankedCard]
  var id: String { category }
}

/// Ports of ../src/lib/rewards.ts, ISSUER_LABELS (../src/lib/categories.ts)
/// and BestCards.tsx's ranking.
enum Rewards {
  /// BONUS_CATEGORIES: REWARD_CATEGORIES without OTHER, in order.
  static let bonusCategories = [
    "DINING", "GROCERIES", "TRAVEL", "GAS", "TRANSIT", "ENTERTAINMENT", "ONLINE_SHOPPING", "DRUGSTORES",
    "ROTATING",
  ]

  private static let labels: [String: String] = [
    "DINING": "Dining", "GROCERIES": "Groceries", "TRAVEL": "Travel", "GAS": "Gas",
    "TRANSIT": "Transit", "ENTERTAINMENT": "Streaming", "ONLINE_SHOPPING": "Online Shopping",
    "DRUGSTORES": "Drugstores", "ROTATING": "Rotating (quarterly)", "OTHER": "Everything else",
  ]

  private static let issuers = ["AMEX": "Amex", "CHASE": "Chase", "DISCOVER": "Discover"]

  /// REWARD_CATEGORY_LABELS.
  static func label(for category: String) -> String { labels[category] ?? category }

  /// ISSUER_LABELS, falling back to the raw value as the web does.
  static func issuerLabel(_ issuer: String) -> String { issuers[issuer] ?? issuer }

  /// effectiveRate: the card's bonus for the category, else its OTHER rate,
  /// else 1x.
  static func effectiveRate(_ rates: [RewardRateDTO], _ category: String) -> EffectiveRate {
    if let exact = rates.first(where: { $0.category == category }) {
      return EffectiveRate(multiplier: exact.multiplier, unit: exact.unit, isBonus: true)
    }
    if let base = rates.first(where: { $0.category == "OTHER" }) {
      return EffectiveRate(multiplier: base.multiplier, unit: base.unit, isBonus: false)
    }
    return EffectiveRate(multiplier: 1, unit: "X", isBonus: false)
  }

  /// formatRate: "4x" or "6%", the number printed as JavaScript prints it.
  static func formatRate(_ multiplier: Double, _ unit: String) -> String {
    let n = Formatters.plainNumber(multiplier)
    return unit == "PERCENT" ? "\(n)%" : "\(n)x"
  }

  /// BestCards' shortLabel.
  static func shortLabel(_ card: UserCardDTO) -> String {
    if let display = card.displayName { return display }
    let issuer = issuerLabel(card.issuer)
    if let name = card.name, !name.isEmpty { return "\(issuer) \(name)" }
    return issuer
  }

  /// BestCards renders only when some card has rates.
  static func hasRates(_ cards: [UserCardDTO]) -> Bool {
    cards.contains { !$0.rewardRates.isEmpty }
  }

  /// Every card ranked per bonus category, highest multiplier first. The sort
  /// is stable, so ties keep the server's card order, as the web's does.
  static func bestByCategory(_ cards: [UserCardDTO]) -> [CategoryRanking] {
    bonusCategories.map { category in
      let ranked = cards.enumerated()
        .map { (index: $0.offset, item: RankedCard(card: $0.element, rate: effectiveRate($0.element.rewardRates, category))) }
        .sorted { a, b in
          a.item.rate.multiplier != b.item.rate.multiplier
            ? a.item.rate.multiplier > b.item.rate.multiplier : a.index < b.index
        }
        .map(\.item)
      return CategoryRanking(category: category, label: label(for: category), ranked: ranked)
    }
  }
}
