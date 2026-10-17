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
      source: source, autoMode: autoMode, yearBreakdown: windows, openQuestions: 0, ytdCaptured: ytd, yearTarget: target)
  }

  func window(
    _ key: String, used: Double = 0, captured: Bool = false, manual: Bool = false, future: Bool = false,
    credits: Int = 0
  ) -> BenefitPeriodDTO {
    BenefitPeriodDTO(
      label: key, short: key, key: key, used: used, target: 10, captured: captured, manual: manual, future: future,
      credits: (0..<credits).map {
        PerkCreditDTO(id: "\(key)-\($0)", date: "\(key)-05", name: "Sample Coffee", amount: 7, how: "auto", purchase: nil)
      })
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

  @Test func questionNoteWarnsOnlyWhenTheWindowIsFull() {
    func question(full: Bool) -> PerkQuestionDTO {
      PerkQuestionDTO(
        transactionId: "t1", date: "2026-03-20", name: "Sample Coffee Credit", amount: 7, cardId: "c1",
        cardName: "Sample Rewards Card", suggestedBenefitId: "b1", windowFull: full)
    }
    // Names the question's own window, not the current period.
    #expect(CardRules.questionNote(question(full: true), perk: benefit(windows: [window("2026-02"), window("2026-03")]))
      == "Sample Credit is already used for 2026-03. This may be a refund.")
    let feb = PerkQuestionDTO(
      transactionId: "t2", date: "2026-02-20", name: "Sample Coffee Credit", amount: 7, cardId: "c1",
      cardName: "Sample Rewards Card", suggestedBenefitId: "b1", windowFull: true)
    #expect(CardRules.questionNote(feb, perk: benefit(windows: [window("2026-02"), window("2026-03")]))
      == "Sample Credit is already used for 2026-02. This may be a refund.")
    // Without that window, the perk's period label.
    #expect(CardRules.questionNote(question(full: true), perk: benefit())
      == "Sample Credit is already used for March 2026. This may be a refund.")
    #expect(CardRules.questionNote(question(full: false), perk: benefit()) == nil)
    #expect(CardRules.questionNote(question(full: true), perk: nil) == nil)
  }

  @Test func creditWindowsShowTheCurrentOneThenEarlierOnesWithCredits() {
    let b = benefit(windows: [
      window("2026-01", credits: 1), window("2026-02"), window("2026-03"),
      window("2026-04", future: true, credits: 1),
    ])
    let now = utc.date(from: DateComponents(year: 2026, month: 3, day: 15))!
    #expect(CardRules.creditWindows(b, now: now, calendar: utc).map(\.key) == ["2026-03", "2026-01"])
    // A window that started since the data loaded still counts as current.
    let april = utc.date(from: DateComponents(year: 2026, month: 4, day: 2))!
    #expect(CardRules.creditWindows(b, now: april, calendar: utc).map(\.key) == ["2026-04", "2026-01"])
    // A clock outside the year falls back to the last started window.
    let later = utc.date(from: DateComponents(year: 2027, month: 1, day: 2))!
    #expect(CardRules.creditWindows(b, now: later, calendar: utc).map(\.key) == ["2026-03", "2026-01"])
  }

  @Test func currentQuarterSplitsAtTheMonthBoundary() {
    let sep30 = utc.date(from: DateComponents(year: 2026, month: 9, day: 30, hour: 23, minute: 59))!
    let oct1 = utc.date(from: DateComponents(year: 2026, month: 10, day: 1))!
    let jan1 = utc.date(from: DateComponents(year: 2027, month: 1, day: 1))!
    #expect(CardRules.currentQuarter(now: sep30, calendar: utc) == (2026, 3))
    #expect(CardRules.currentQuarter(now: oct1, calendar: utc) == (2026, 4))
    #expect(CardRules.currentQuarter(now: jan1, calendar: utc) == (2027, 1))
  }

  @Test func rotatingSummaryWording() {
    let b = RotatingBonusDTO(
      year: 2026, quarter: 4, multiplier: 5, unit: "PERCENT", categories: ["GAS", "GROCERIES"],
      merchants: ["Sample Mart"])
    #expect(CardRules.rotatingSummary(b, year: 2026, quarter: 4) == "Q4 2026 · 5% on Gas, Groceries, Sample Mart")
    #expect(CardRules.rotatingSummary(nil, year: 2026, quarter: 4) == "Q4 2026 · Not set up")
    let excluding = RotatingBonusDTO(
      year: 2026, quarter: 4, multiplier: 5, unit: "PERCENT", categories: ["GROCERIES"],
      excludeMerchants: ["Sample Mart", "Example Store"])
    #expect(CardRules.rotatingSummary(excluding, year: 2026, quarter: 4)
      == "Q4 2026 · 5% on Groceries (not Sample Mart, Example Store)")
  }

  @Test func newRotatingDefaultsComeFromTheRotatingRate() {
    let withRate = UserCardDTO(
      id: "c1", issuer: "DISCOVER", name: "Sample", last4: "0002",
      rewardRates: [RewardRateDTO(category: "ROTATING", multiplier: 3, unit: "X")])
    #expect(CardRules.newRotatingDefaults(withRate) == RotatingBonusBody(
      multiplier: 3, unit: "X", categories: [], merchants: [], excludeMerchants: [], cap: 1500, activated: false))
    let without = UserCardDTO(id: "c2", issuer: "CHASE", name: "Sample", last4: "0003")
    #expect(CardRules.newRotatingDefaults(without) == RotatingBonusBody(
      multiplier: 5, unit: "X", categories: [], merchants: [], excludeMerchants: [], cap: 1500, activated: false))
  }

  @Test func baseUnitIsOtherThenRotatingThenX() {
    func card(_ rates: [(String, String)]) -> UserCardDTO {
      UserCardDTO(
        id: "c", issuer: "CHASE", name: "Sample", last4: "0001",
        rewardRates: rates.map { RewardRateDTO(category: $0.0, multiplier: 1, unit: $0.1) })
    }
    #expect(CardRules.baseUnit(card([("ROTATING", "X"), ("OTHER", "PERCENT")])) == "PERCENT")
    #expect(CardRules.baseUnit(card([("ROTATING", "PERCENT"), ("GAS", "X")])) == "PERCENT")
    #expect(CardRules.baseUnit(card([("GAS", "PERCENT")])) == "X")
  }

  @Test func rotatingCategoriesLeaveOutOtherAndRotating() {
    #expect(CardRules.rotatingCategories == Rewards.bonusCategories.filter { $0 != "ROTATING" })
  }

  @Test func pastQuartersLeaveOutTheCurrentOneNewestFirst() {
    let card = UserCardDTO(
      id: "c1", issuer: "DISCOVER", name: "Sample", last4: "0002",
      rotating: [2025, 2026].flatMap { y in [1, 4].map { RotatingBonusDTO(year: y, quarter: $0, multiplier: 5, unit: "PERCENT") } })
    #expect(CardRules.pastQuarters(card, current: "2026-Q4").map(\.key) == ["2026-Q1", "2025-Q4", "2025-Q1"])
  }

  let chicago: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "America/Chicago")!
    return c
  }()

  func chicagoDate(_ m: Int, _ d: Int) -> Date {
    chicago.date(from: DateComponents(year: 2026, month: m, day: d, hour: 12))!
  }

  func perk(autoMode: String? = "spending", amount: Double = 10, used: Double = 3) -> BenefitDTO {
    BenefitDTO(
      id: "b1", name: "Coffee Credit", notes: nil, amount: amount, period: "MONTHLY",
      matchCategories: [], categoryLabels: [], matchText: [], perkActiveFrom: nil, used: used,
      cappedUsed: used, pct: 0, periodLabel: "October 2026", source: "auto", autoMode: autoMode,
      yearBreakdown: [], openQuestions: 0, ytdCaptured: 0, yearTarget: 0)
  }

  @Test func setupPromptsFollowTheCurrentQuarter() {
    let now = chicagoDate(10, 16)
    let plain = UserCardDTO(id: "c0", issuer: "CHASE", name: "Sample", last4: "0003", hasRotating: false)
    let missing = UserCardDTO(id: "c1", issuer: "DISCOVER", name: "Sample", last4: "0002", hasRotating: true)
    let past = RotatingBonusDTO(year: 2026, quarter: 3, multiplier: 5, unit: "PERCENT", activated: true)
    let stale = UserCardDTO(id: "c1", issuer: "DISCOVER", name: "Sample", last4: "0002", rotating: [past])
    let off = RotatingBonusDTO(year: 2026, quarter: 4, multiplier: 5, unit: "PERCENT", activated: false)
    let on = RotatingBonusDTO(year: 2026, quarter: 4, multiplier: 5, unit: "PERCENT", activated: true)
    let label = Rewards.shortLabel(missing)
    #expect(CardRules.setupPrompts([plain], now: now, calendar: chicago).isEmpty)
    #expect(CardRules.setupPrompts([missing], now: now, calendar: chicago)
      == [SetupPrompt(cardId: "c1", title: "Set Up Q4 Categories", detail: label)])
    #expect(CardRules.setupPrompts([stale], now: now, calendar: chicago).map(\.title) == ["Set Up Q4 Categories"])
    let entered = UserCardDTO(id: "c1", issuer: "DISCOVER", name: "Sample", last4: "0002", rotating: [off])
    #expect(CardRules.setupPrompts([entered], now: now, calendar: chicago).map(\.title) == ["Activate Q4 Categories"])
    let done = UserCardDTO(id: "c1", issuer: "DISCOVER", name: "Sample", last4: "0002", rotating: [on])
    #expect(CardRules.setupPrompts([done], now: now, calendar: chicago).isEmpty)
  }

  @Test func endingSoonListsUnusedPerksInTheLastWeek() {
    func cards(_ b: BenefitDTO) -> [UserCardDTO] {
      [UserCardDTO(id: "c1", issuer: "AMEX", name: "Sample", last4: "0001", benefits: [b])]
    }
    let late = chicagoDate(10, 26)
    #expect(CardRules.endingSoon(cards(perk(amount: 7, used: 0)), now: late, calendar: chicago)
      == [EndingSoon(cardId: "c1", benefitId: "b1", text: "Coffee Credit · $7.00 left · ends Oct 31")])
    #expect(CardRules.endingSoon(cards(perk(amount: 7, used: 0)), now: chicagoDate(10, 20), calendar: chicago).isEmpty)
    #expect(CardRules.endingSoon(cards(perk(amount: 7, used: 7)), now: late, calendar: chicago).isEmpty)
    #expect(CardRules.endingSoon(cards(perk(autoMode: "perk", amount: 7, used: 0)), now: late, calendar: chicago).isEmpty)
  }
}
