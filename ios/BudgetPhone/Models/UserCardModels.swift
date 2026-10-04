import Foundation

// Mirrors of UserCardDTO, RewardRateDTO, BenefitDTO, BenefitPeriodDTO,
// EarningsDTO and EarningsCategoryDTO in ../src/types/index.ts.

struct RewardRateDTO: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let category: String
  let categoryLabel: String
  let multiplier: Double
  let unit: String  // "X" | "PERCENT"
  /// "4x" or "6%".
  let display: String
  let notes: String?

  init(
    id: String = "", category: String, multiplier: Double, unit: String,
    categoryLabel: String? = nil, display: String? = nil, notes: String? = nil
  ) {
    self.id = id
    self.category = category
    self.multiplier = multiplier
    self.unit = unit
    self.categoryLabel = categoryLabel ?? Rewards.label(for: category)
    self.display = display ?? Rewards.formatRate(multiplier, unit)
    self.notes = notes
  }
}

/// One period window of a credit's year ("Mar", "Q2").
struct BenefitPeriodDTO: Decodable, Equatable, Identifiable, Sendable {
  let label: String
  let short: String
  /// Stable period key ("2026-03"), used for manual overrides.
  let key: String
  let used: Double
  let target: Double
  let captured: Bool
  let manual: Bool
  let future: Bool
  var id: String { key }
}

struct BenefitDTO: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let notes: String?
  let amount: Double
  let period: String
  let matchCategories: [String]
  let categoryLabels: [String]
  let matchText: [String]
  /// ISO date the flat-value perk was switched on.
  let perkActiveFrom: String?
  let used: Double
  let cappedUsed: Double
  /// 0...1.
  let pct: Double
  let periodLabel: String
  let source: String  // "manual" | "auto" | "none"
  let autoMode: String?  // "spending" | "credits" | "perk"
  let yearBreakdown: [BenefitPeriodDTO]
  let ytdCaptured: Double
  let yearTarget: Double
}

struct EarningsCategoryDTO: Decodable, Equatable, Identifiable, Sendable {
  let category: String
  let categoryLabel: String
  let spend: Double
  let rate: String
  let isBonus: Bool
  let earned: Double
  let value: Double
  let vsBest: Double
  let bestAlternative: String?
  var id: String { category }
}

struct EarningsDTO: Decodable, Equatable, Sendable {
  let unit: String
  let pointValueCents: Double
  let totalSpend: Double
  let totalEarned: Double
  let totalValue: Double
  let incrementalValue: Double
  let byCategory: [EarningsCategoryDTO]
}

struct UserCardDTO: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let issuer: String
  let name: String?
  let last4: String
  let membershipStartYear: Int
  let membershipStartMonth: Int?
  let annualFee: Double
  let pointValueCents: Double
  /// "/api/card-art/<file>", or nil while the card has no image.
  let artUrl: String?
  let linked: Bool
  let linkedAccountName: String?
  /// The linked account's name from Accounts, shown over `name`.
  let displayName: String?
  let benefits: [BenefitDTO]
  let benefitCount: Int
  let benefitsUsedCount: Int
  let creditsYtd: Double
  let creditsAnnualMax: Double
  let rewardRates: [RewardRateDTO]
  /// nil when the card isn't linked to an account.
  let earnings: EarningsDTO?
  let earningsPeriodLabel: String

  init(
    id: String, issuer: String, name: String?, last4: String, displayName: String? = nil,
    artUrl: String? = nil, rewardRates: [RewardRateDTO] = [],
    membershipStartYear: Int = 2024, membershipStartMonth: Int? = nil,
    annualFee: Double = 0, pointValueCents: Double = 1, linked: Bool = false,
    linkedAccountName: String? = nil, benefits: [BenefitDTO] = [], benefitsUsedCount: Int = 0,
    creditsYtd: Double = 0, creditsAnnualMax: Double = 0, earnings: EarningsDTO? = nil,
    earningsPeriodLabel: String = ""
  ) {
    self.id = id
    self.issuer = issuer
    self.name = name
    self.last4 = last4
    self.displayName = displayName
    self.artUrl = artUrl
    self.rewardRates = rewardRates
    self.membershipStartYear = membershipStartYear
    self.membershipStartMonth = membershipStartMonth
    self.annualFee = annualFee
    self.pointValueCents = pointValueCents
    self.linked = linked
    self.linkedAccountName = linkedAccountName
    self.benefits = benefits
    self.benefitCount = benefits.count
    self.benefitsUsedCount = benefitsUsedCount
    self.creditsYtd = creditsYtd
    self.creditsAnnualMax = creditsAnnualMax
    self.earnings = earnings
    self.earningsPeriodLabel = earningsPeriodLabel
  }
}

struct UserCardsResponse: Decodable, Equatable, Sendable {
  var cards: [UserCardDTO]
}
