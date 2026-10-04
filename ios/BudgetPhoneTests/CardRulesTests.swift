import Foundation
import Testing
@testable import BudgetPhone

/// Ports in Support/CardRules.swift (UserCardItem.tsx, CardsSection.tsx,
/// ../src/lib/categories.ts).
struct CardRulesTests {
  let utc: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
  }()

  func card(
    display: String? = nil, name: String? = "Gold", month: Int? = nil, year: Int = 2024,
    fee: Double = 0, ytd: Double = 0, max: Double = 0
  ) -> UserCardDTO {
    UserCardDTO(
      id: "c1", issuer: "AMEX", name: name, last4: "0001", displayName: display,
      membershipStartYear: year, membershipStartMonth: month, annualFee: fee,
      creditsYtd: ytd, creditsAnnualMax: max)
  }

  func benefit(
    source: String = "auto", autoMode: String? = "spending", perk: String? = nil,
    matchText: [String] = [], matchCategories: [String] = [], labels: [String] = [],
    windows: [BenefitPeriodDTO] = [], ytd: Double = 0, target: Double = 0
  ) -> BenefitDTO {
    BenefitDTO(
      id: "b1", name: "Sample Credit", notes: nil, amount: 10, period: "MONTHLY",
      matchCategories: matchCategories, categoryLabels: labels, matchText: matchText,
      perkActiveFrom: perk, used: 0, cappedUsed: 0, pct: 0, periodLabel: "March 2026",
      source: source, autoMode: autoMode, yearBreakdown: windows, ytdCaptured: ytd, yearTarget: target)
  }

  func window(_ key: String, used: Double = 0, captured: Bool = false, manual: Bool = false, future: Bool = false)
    -> BenefitPeriodDTO
  {
    BenefitPeriodDTO(
      label: key, short: key, key: key, used: used, target: 10, captured: captured, manual: manual, future: future)
  }

  @Test func listsMatchTheWeb() {
    #expect(CardRules.issuers == ["AMEX", "CHASE", "DISCOVER"])
    #expect(CardRules.benefitPeriods.map(CardRules.periodLabel) == ["Monthly", "Quarterly", "Semi-annual", "Annual"])
    #expect(CardRules.rewardCategories.last == "OTHER" && CardRules.rewardCategories.count == 10)
    #expect(CardRules.trackableCategories.first == "FOOD_AND_DRINK" && CardRules.trackableCategories.count == 10)
    #expect(CardRules.monthNames.count == 12)
  }

  @Test func presetsAreUniqueAndGroupedByKnownIssuers() {
    let slugs = CardRules.presets.map(\.slug)
    #expect(Set(slugs).count == slugs.count)
    #expect(CardRules.presets.allSatisfy { CardRules.issuers.contains($0.issuer) })
    #expect(CardRules.presetLabel(CardPreset(slug: "x", issuer: "CHASE", name: "Sample")) == "Chase Sample")
  }

  @Test func titleFallsBackLikeTheWeb() {
    #expect(CardRules.title(card(display: "Example Bank Gold")) == "Example Bank Gold")
    #expect(CardRules.title(card(display: "", name: "Gold")) == "Gold")
    #expect(CardRules.title(card(name: nil)) == "Card")
    #expect(CardRules.title(card(name: "")) == "Card")
  }

  @Test func headerWording() {
    #expect(CardRules.issuerAndLast4(card()) == "Amex ··0001")
    #expect(CardRules.memberSince(card(month: 2)) == "Feb 2024")
    #expect(CardRules.memberSince(card()) == "2024")
    let now = utc.date(from: DateComponents(year: 2026, month: 6, day: 1))!
    #expect(CardRules.yearsHeld(card(year: 2024), now: now, calendar: utc) == "2 yrs")
    #expect(CardRules.yearsHeld(card(year: 2025), now: now, calendar: utc) == "1 yr")
    #expect(CardRules.yearsHeld(card(year: 2026), now: now, calendar: utc) == nil)
    #expect(CardRules.removeCardPrompt(card()) == "Remove Amex ··0001 and its benefits?")
    #expect(CardRules.deleteCreditPrompt(benefit()) == "Delete \"Sample Credit\" and everything logged against it?")
  }

  @Test func creditsMaxed() throws {
    #expect(CardRules.creditsMaxed(try TestData.userCards()[0]) == "1/1 credits maxed")
    #expect(CardRules.creditsMaxed(try TestData.userCards()[1]) == "0/0 credits maxed")
  }

  @Test func feeSummary() {
    let behind = CardRules.feeSummary(card(fee: 100, ytd: 40, max: 200))
    #expect(behind.hasFee && !behind.breakEven && behind.fill == 0.4 && behind.net == -60)
    #expect(behind.text == "$40.00 captured this year · $60.00 to break even · up to $200.00 available")
    let ahead = CardRules.feeSummary(card(fee: 100, ytd: 150, max: 200))
    #expect(ahead.breakEven && ahead.fill == 1)
    #expect(ahead.text == "$150.00 captured this year · ✓ paid for itself, $50.00 ahead · up to $200.00 available")
    let free = CardRules.feeSummary(card(ytd: 5, max: 0))
    #expect(!free.hasFee && free.fill == 1)
    #expect(free.text == "No annual fee · $5.00 in credits captured this year")
    #expect(CardRules.feeSummary(card(ytd: 5, max: 20)).text
      == "No annual fee · $5.00 in credits captured this year · up to $20.00 available")
  }

  @Test func creditHints() {
    #expect(CardRules.creditHint(benefit(labels: ["Food and Drink", "Travel"]))
      == "From Food and Drink, Travel spending · March 2026")
    #expect(CardRules.creditHint(benefit(autoMode: "credits")) == "From statement credits in transactions · March 2026")
    #expect(CardRules.creditHint(benefit(autoMode: "perk", perk: "2026-03-05T12:00:00.000Z"), calendar: utc)
      == "Perk active since Mar 5, 2026 · March 2026")
    #expect(CardRules.creditHint(benefit(source: "manual")) == "Manually logged · March 2026")
    #expect(CardRules.creditHint(benefit(source: "none", autoMode: nil)) == "Not tracked · March 2026")
  }

  @Test func canAutoNeedsSomethingToFallBackOn() {
    #expect(!CardRules.canAuto(benefit()))
    #expect(CardRules.canAuto(benefit(perk: "2026-03-05T00:00:00.000Z")))
    #expect(CardRules.canAuto(benefit(matchText: ["Sample"])))
    #expect(CardRules.canAuto(benefit(matchCategories: ["TRAVEL"])))
  }

  @Test func aWindowCyclesLikeTheWeb() {
    #expect(CardRules.windowCycleValue(window("a", manual: true, future: false)) == nil)
    #expect(CardRules.windowCycleValue(window("a", captured: true, manual: true)) == nil)
    #expect(CardRules.windowCycleValue(window("a", captured: true)) == 0)
    #expect(CardRules.windowCycleValue(window("a", used: 4)) == 10)
  }

  @Test func yearSummaryCountsElapsedWindows() {
    let b = benefit(
      windows: [window("a", captured: true), window("b", used: 4), window("c", future: true)], ytd: 14, target: 120)
    #expect(CardRules.yearSummary(b) == "1/2 captured · $14.00 of $120.00")
  }

  @Test func earningsFormatting() {
    #expect(CardRules.formatEarned(12345.5, isPoints: true) == "12,346 pts")
    #expect(CardRules.formatEarned(12.5, isPoints: false) == "$12.50")
    #expect(CardRules.formatVsBest(0) == "—")
    #expect(CardRules.formatVsBest(3) == "+$3.00")
    #expect(CardRules.formatVsBest(-2.5) == "−$2.50")
    #expect(CardRules.formatIncremental(0) == "+$0.00 vs. next best")
    #expect(CardRules.formatIncremental(-2.25) == "−$2.25 vs. next best")
  }

  @Test func inputs() {
    #expect(CardRules.number("1.5") == 1.5)
    #expect(CardRules.number("1,5") == 1.5)
    #expect(CardRules.number("") == nil && CardRules.number("abc") == nil)
    #expect(CardRules.last4Input("12a34 5") == "1234")
  }

  @Test func movedMatchesSwiftUIsMove() {
    let items = ["a", "b", "c", "d"]
    #expect(CardRules.moved(items, from: [0], to: 2) == ["b", "a", "c", "d"])
    #expect(CardRules.moved(items, from: [3], to: 0) == ["d", "a", "b", "c"])
    #expect(CardRules.moved(items, from: [1], to: 4) == ["a", "c", "d", "b"])
    #expect(CardRules.moved(items, from: [0, 2], to: 4) == ["b", "d", "a", "c"])
  }
}
