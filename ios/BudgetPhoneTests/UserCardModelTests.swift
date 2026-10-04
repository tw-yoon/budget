import Foundation
import Testing
@testable import BudgetPhone

struct UserCardModelTests {
  @Test func decodesWhatBestCardNeeds() throws {
    let r = try JSONDecoder().decode(UserCardsResponse.self, from: TestData.fixture("user-cards"))
    #expect(r.cards.map(\.id) == ["c1", "c2"])
    let gold = r.cards[0]
    #expect(gold.issuer == "AMEX" && gold.name == "Gold" && gold.last4 == "0001")
    #expect(gold.displayName == "Example Bank Gold")
    #expect(gold.artUrl == "/api/card-art/c1.png")
    #expect(gold.rewardRates.map(\.category) == ["DINING", "OTHER"])
    #expect(gold.rewardRates.map(\.multiplier) == [4, 1])
    #expect(r.cards[1].name == nil && r.cards[1].artUrl == nil && r.cards[1].displayName == nil)
  }

  @Test func decodesEveryCardField() throws {
    let gold = try TestData.userCards()[0]
    #expect(gold.membershipStartYear == 2024 && gold.membershipStartMonth == 2)
    #expect(gold.annualFee == 250 && gold.pointValueCents == 1.5)
    #expect(gold.linked && gold.linkedAccountName == "Example Bank Gold")
    #expect(gold.benefitCount == 1 && gold.benefitsUsedCount == 1)
    #expect(gold.creditsYtd == 14 && gold.creditsAnnualMax == 120)
    #expect(gold.earningsPeriodLabel == "Feb 2026 – Jan 2027")
    #expect(gold.rewardRates[0] == RewardRateDTO(
      id: "r1", category: "DINING", multiplier: 4, unit: "X", categoryLabel: "Dining", display: "4x",
      notes: "Sample note"))
    let plain = try TestData.userCards()[1]
    #expect(plain.membershipStartMonth == nil && plain.earnings == nil && !plain.linked)
    #expect(plain.rewardRates[0].display == "1.5%")
  }

  @Test func decodesACreditAndItsWindows() throws {
    let b = try #require(TestData.userCards()[0].benefits.first)
    #expect(b.id == "b1" && b.name == "Sample Dining Credit" && b.notes == nil)
    #expect(b.amount == 10 && b.period == "MONTHLY")
    #expect(b.matchText == ["Sample Dining"] && b.matchCategories.isEmpty && b.categoryLabels.isEmpty)
    #expect(b.perkActiveFrom == nil && b.used == 12.5 && b.cappedUsed == 10 && b.pct == 1)
    #expect(b.periodLabel == "March 2026" && b.source == "auto" && b.autoMode == "credits")
    #expect(b.ytdCaptured == 14 && b.yearTarget == 120)
    #expect(b.yearBreakdown.map(\.key) == ["2026-02", "2026-03", "2026-04"])
    #expect(b.yearBreakdown[1] == BenefitPeriodDTO(
      label: "March 2026", short: "Mar", key: "2026-03", used: 4, target: 10, captured: false,
      manual: true, future: false))
  }

  @Test func decodesEarnings() throws {
    let e = try #require(TestData.userCards()[0].earnings)
    #expect(e.unit == "X" && e.pointValueCents == 1.5)
    #expect(e.totalSpend == 300 && e.totalEarned == 700 && e.totalValue == 10.5 && e.incrementalValue == -2.25)
    #expect(e.byCategory.map(\.category) == ["DINING", "OTHER"])
    #expect(e.byCategory[0].bestAlternative == "Sample Rewards Card" && e.byCategory[0].isBonus)
    #expect(e.byCategory[1].bestAlternative == nil && !e.byCategory[1].isBonus)
  }

  @Test func cardArtResolvesAgainstTheServer() {
    let c = APIClient(baseURL: URL(string: "http://budget-mac.local:3000")!)
    #expect(c.cardArtURL("/api/card-art/c1.png").absoluteString == "http://budget-mac.local:3000/api/card-art/c1.png")
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  struct UserCardAPITests {
    @Test func userCardsIsAGet() async throws {
      let c = APIClient(
        baseURL: URL(string: "http://budget-mac.local:3000")!,
        session: StubURLProtocol.session { _ in (200, Data(#"{"cards":[]}"#.utf8)) })
      _ = try await c.userCards()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "GET")
      #expect(request.url?.path() == "/api/user-cards")
    }
  }
}
