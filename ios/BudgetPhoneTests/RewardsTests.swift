import Foundation
import Testing
@testable import BudgetPhone

/// Ports of ../src/lib/rewards.ts, BestCards.tsx and cardArtColors.
struct RewardsTests {
  func card(_ id: String, issuer: String = "AMEX", name: String? = nil, display: String? = nil,
            _ rates: [(String, Double, String)]) -> UserCardDTO {
    UserCardDTO(
      id: id, issuer: issuer, name: name, last4: "000\(id.suffix(1))", displayName: display,
      artUrl: nil, rewardRates: rates.map { RewardRateDTO(category: $0.0, multiplier: $0.1, unit: $0.2) })
  }

  @Test func categoriesAndLabels() {
    #expect(Rewards.bonusCategories == [
      "DINING", "GROCERIES", "TRAVEL", "GAS", "TRANSIT", "ENTERTAINMENT", "ONLINE_SHOPPING", "DRUGSTORES", "ROTATING",
    ])
    #expect(Rewards.bonusCategories.map(Rewards.label(for:)) == [
      "Dining", "Groceries", "Travel", "Gas", "Transit", "Streaming", "Online Shopping", "Drugstores",
      "Rotating (quarterly)",
    ])
  }

  @Test func effectiveRateFallsBackToBaseThenOneX() {
    let rates = [RewardRateDTO(category: "DINING", multiplier: 4, unit: "X"),
                 RewardRateDTO(category: "OTHER", multiplier: 2, unit: "PERCENT")]
    #expect(Rewards.effectiveRate(rates, "DINING") == EffectiveRate(multiplier: 4, unit: "X", isBonus: true))
    #expect(Rewards.effectiveRate(rates, "GAS") == EffectiveRate(multiplier: 2, unit: "PERCENT", isBonus: false))
    #expect(Rewards.effectiveRate([], "GAS") == EffectiveRate(multiplier: 1, unit: "X", isBonus: false))
  }

  @Test func formatRatePrintsNumbersLikeJavaScript() {
    #expect(Rewards.formatRate(4, "X") == "4x")
    #expect(Rewards.formatRate(3, "PERCENT") == "3%")
    #expect(Rewards.formatRate(1.5, "X") == "1.5x")
    #expect(Rewards.formatRate(2.25, "PERCENT") == "2.25%")
  }

  @Test func shortLabel() {
    #expect(Rewards.shortLabel(card("c1", display: "Example Bank Gold", [])) == "Example Bank Gold")
    #expect(Rewards.shortLabel(card("c1", issuer: "AMEX", name: "Gold", [])) == "Amex Gold")
    #expect(Rewards.shortLabel(card("c1", issuer: "CHASE", [])) == "Chase")
    #expect(Rewards.shortLabel(card("c1", issuer: "SAMPLE", name: "One", [])) == "SAMPLE One")
  }

  @Test func ranksEachCategoryBestFirst() throws {
    let a = card("a", [("DINING", 4, "X"), ("OTHER", 1, "X")])
    let b = card("b", [("OTHER", 2, "PERCENT")])
    let c = card("c", [("DINING", 3, "X"), ("GROCERIES", 6, "PERCENT")])
    let rows = Rewards.bestByCategory([a, b, c])
    #expect(rows.map(\.category) == Rewards.bonusCategories)
    let dining = try #require(rows.first { $0.category == "DINING" })
    #expect(dining.label == "Dining")
    #expect(dining.ranked.map(\.card.id) == ["a", "c", "b"])
    #expect(dining.ranked[0].rate.isBonus)
    #expect(!dining.ranked[2].rate.isBonus)
    let groceries = try #require(rows.first { $0.category == "GROCERIES" })
    #expect(groceries.ranked.map(\.card.id) == ["c", "b", "a"])
  }

  func rotating(_ id: String, _ rates: [(String, Double, String)], _ m: Double, _ unit: String,
                current: Bool = true, pointValueCents: Double = 1) -> UserCardDTO {
    UserCardDTO(
      id: id, issuer: "AMEX", name: nil, last4: "0001",
      rewardRates: rates.map { RewardRateDTO(category: $0.0, multiplier: $0.1, unit: $0.2) },
      pointValueCents: pointValueCents,
      rotating: [RotatingBonusDTO(
        year: 2026, quarter: 4, multiplier: m, unit: unit, categories: ["GAS"], merchants: ["Sample Mart"],
        cap: nil, activated: true, current: current)])
  }

  @Test func aCurrentBonusRanksAndANormalRateStaysWhenHigher() throws {
    let a = rotating("a", [("OTHER", 1, "PERCENT")], 5, "PERCENT")
    let b = card("b", [("GAS", 3, "PERCENT")])
    let gas = try #require(Rewards.bestByCategory([b, a]).first { $0.category == "GAS" })
    #expect(gas.ranked.map(\.card.id) == ["a", "b"] && gas.ranked[0].rate.isBonus)
    // A 5% bonus never lowers a card's own 6%.
    let six = rotating("s", [("GAS", 6, "PERCENT")], 5, "PERCENT")
    #expect(Rewards.effectiveRate(six, "GAS") == EffectiveRate(multiplier: 6, unit: "PERCENT", isBonus: true))
    // Not current, or another category: ignored.
    #expect(!Rewards.effectiveRate(rotating("n", [("OTHER", 1, "PERCENT")], 5, "PERCENT", current: false), "GAS").isBonus)
    #expect(Rewards.effectiveRate(a, "DINING").multiplier == 1)
    // Units differ: compared in dollars by point value.
    let pts = rotating("p", [("GAS", 3, "X")], 4, "PERCENT", pointValueCents: 2)  // 3x at 2c = 6% beats 4%
    #expect(Rewards.effectiveRate(pts, "GAS") == EffectiveRate(multiplier: 3, unit: "X", isBonus: true))
  }

  @Test func tiesKeepServerOrder() throws {
    let a = card("a", [("OTHER", 3, "PERCENT")])
    let b = card("b", [("OTHER", 3, "X")])
    let gas = try #require(Rewards.bestByCategory([a, b]).first { $0.category == "GAS" })
    #expect(gas.ranked.map(\.card.id) == ["a", "b"])
  }

  @Test func hasRates() {
    #expect(!Rewards.hasRates([]))
    #expect(!Rewards.hasRates([card("a", [])]))
    #expect(Rewards.hasRates([card("a", []), card("b", [("OTHER", 1, "X")])]))
  }

  /// Expected pairs computed with the web's cardArtColors.
  @Test func cardColoursMatchTheWeb() {
    #expect(CardArtColors.hexes(issuer: "AMEX", seed: "AMEX-Gold-0001") == ("#5b7fa6", "#2b3f52"))
    #expect(CardArtColors.hexes(issuer: "CHASE", seed: "CHASE--0002") == ("#0f766e", "#0a3b37"))
    #expect(CardArtColors.hexes(issuer: "DISCOVER", seed: "DISCOVER-It-0003") == ("#c2703a", "#5f3417"))
    #expect(CardArtColors.hexes(issuer: "CITI", seed: "CITI-Sample-0004") == ("#57534e", "#1c1917"))
  }
}
