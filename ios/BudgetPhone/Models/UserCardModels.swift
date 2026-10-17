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

// Mirrors of PerkPurchaseDTO, PerkCreditDTO and PerkQuestionDTO.
struct PerkPurchaseDTO: Decodable, Equatable, Sendable {
  let id: String
  let date: String
  let name: String
  let amount: Double
}

struct PerkCreditDTO: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let date: String
  let name: String
  /// Positive.
  let amount: Double
  let how: String  // "auto" | "confirmed"
  let purchase: PerkPurchaseDTO?
}

struct PerkQuestionDTO: Decodable, Equatable, Identifiable, Sendable {
  let transactionId: String
  let date: String
  let name: String
  /// Positive.
  let amount: Double
  let cardId: String
  let cardName: String
  let suggestedBenefitId: String?
  let windowFull: Bool
  var id: String { transactionId }
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
  /// Statement credits placed in this window, date ascending.
  let credits: [PerkCreditDTO]
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
  /// Perk questions suggesting this perk.
  let openQuestions: Int
  let ytdCaptured: Double
  let yearTarget: Double
}

// In extensions so the memberwise inits stay. Older servers omit
// `credits` and `openQuestions`.
extension BenefitPeriodDTO {
  private enum CodingKeys: String, CodingKey { case label, short, key, used, target, captured, manual, future, credits }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      label: try c.decode(String.self, forKey: .label),
      short: try c.decode(String.self, forKey: .short),
      key: try c.decode(String.self, forKey: .key),
      used: try c.decode(Double.self, forKey: .used),
      target: try c.decode(Double.self, forKey: .target),
      captured: try c.decode(Bool.self, forKey: .captured),
      manual: try c.decode(Bool.self, forKey: .manual),
      future: try c.decode(Bool.self, forKey: .future),
      credits: try c.decodeIfPresent([PerkCreditDTO].self, forKey: .credits) ?? [])
  }
}

extension BenefitDTO {
  private enum CodingKeys: String, CodingKey {
    case id, name, notes, amount, period, matchCategories, categoryLabels, matchText, perkActiveFrom, used
    case cappedUsed, pct, periodLabel, source, autoMode, yearBreakdown, openQuestions, ytdCaptured, yearTarget
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      id: try c.decode(String.self, forKey: .id),
      name: try c.decode(String.self, forKey: .name),
      notes: try c.decodeIfPresent(String.self, forKey: .notes),
      amount: try c.decode(Double.self, forKey: .amount),
      period: try c.decode(String.self, forKey: .period),
      matchCategories: try c.decode([String].self, forKey: .matchCategories),
      categoryLabels: try c.decode([String].self, forKey: .categoryLabels),
      matchText: try c.decode([String].self, forKey: .matchText),
      perkActiveFrom: try c.decodeIfPresent(String.self, forKey: .perkActiveFrom),
      used: try c.decode(Double.self, forKey: .used),
      cappedUsed: try c.decode(Double.self, forKey: .cappedUsed),
      pct: try c.decode(Double.self, forKey: .pct),
      periodLabel: try c.decode(String.self, forKey: .periodLabel),
      source: try c.decode(String.self, forKey: .source),
      autoMode: try c.decodeIfPresent(String.self, forKey: .autoMode),
      yearBreakdown: try c.decode([BenefitPeriodDTO].self, forKey: .yearBreakdown),
      openQuestions: try c.decodeIfPresent(Int.self, forKey: .openQuestions) ?? 0,
      ytdCaptured: try c.decode(Double.self, forKey: .ytdCaptured),
      yearTarget: try c.decode(Double.self, forKey: .yearTarget))
  }
}

/// Mirror of RotatingBonusDTO: a card's bonus for one calendar quarter.
struct RotatingBonusDTO: Decodable, Equatable, Identifiable, Sendable {
  let year: Int
  let quarter: Int
  /// "2026-Q4".
  let key: String
  /// "Q4 2026".
  let label: String
  let multiplier: Double
  let unit: String  // "X" | "PERCENT"
  /// "5%".
  let display: String
  let categories: [String]
  let categoryLabels: [String]
  let merchants: [String]
  let excludeMerchants: [String]
  let cap: Double?
  let activated: Bool
  /// The quarter today falls in (server-local).
  let current: Bool
  var id: String { key }

  init(
    year: Int, quarter: Int, multiplier: Double, unit: String, categories: [String] = [],
    merchants: [String] = [], excludeMerchants: [String] = [], cap: Double? = nil, activated: Bool = true,
    current: Bool = false
  ) {
    self.year = year
    self.quarter = quarter
    self.key = "\(year)-Q\(quarter)"
    self.label = "Q\(quarter) \(year)"
    self.multiplier = multiplier
    self.unit = unit
    self.display = Rewards.formatRate(multiplier, unit)
    self.categories = categories
    self.categoryLabels = categories.map(Rewards.label(for:))
    self.merchants = merchants
    self.excludeMerchants = excludeMerchants
    self.cap = cap
    self.activated = activated
    self.current = current
  }
}

struct EarningsCategoryDTO: Decodable, Equatable, Identifiable, Sendable {
  /// Unique per row: the category, or "ROTATING-2026-Q4" for a quarter's bonus.
  let key: String
  let category: String
  let categoryLabel: String
  let spend: Double
  let rate: String
  let isBonus: Bool
  let earned: Double
  let value: Double
  let vsBest: Double
  let bestAlternative: String?
  var id: String { key }
}

// Older servers omit `key`; the category was the row's identity then.
extension EarningsCategoryDTO {
  private enum CodingKeys: String, CodingKey {
    case key, category, categoryLabel, spend, rate, isBonus, earned, value, vsBest, bestAlternative
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let category = try c.decode(String.self, forKey: .category)
    self.init(
      key: try c.decodeIfPresent(String.self, forKey: .key) ?? category, category: category,
      categoryLabel: try c.decode(String.self, forKey: .categoryLabel),
      spend: try c.decode(Double.self, forKey: .spend), rate: try c.decode(String.self, forKey: .rate),
      isBonus: try c.decode(Bool.self, forKey: .isBonus), earned: try c.decode(Double.self, forKey: .earned),
      value: try c.decode(Double.self, forKey: .value), vsBest: try c.decode(Double.self, forKey: .vsBest),
      bestAlternative: try c.decodeIfPresent(String.self, forKey: .bestAlternative))
  }
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
  /// Older servers omit both.
  let hasRotating: Bool
  /// Last 8 quarters, newest first.
  let rotating: [RotatingBonusDTO]

  init(
    id: String, issuer: String, name: String?, last4: String, displayName: String? = nil,
    artUrl: String? = nil, rewardRates: [RewardRateDTO] = [],
    membershipStartYear: Int = 2024, membershipStartMonth: Int? = nil,
    annualFee: Double = 0, pointValueCents: Double = 1, linked: Bool = false,
    linkedAccountName: String? = nil, benefits: [BenefitDTO] = [], benefitsUsedCount: Int = 0,
    creditsYtd: Double = 0, creditsAnnualMax: Double = 0, earnings: EarningsDTO? = nil,
    earningsPeriodLabel: String = "", hasRotating: Bool? = nil, rotating: [RotatingBonusDTO] = []
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
    self.hasRotating = hasRotating ?? !rotating.isEmpty
    self.rotating = rotating
  }
}

extension UserCardDTO {
  private enum CodingKeys: String, CodingKey {
    case id, issuer, name, last4, membershipStartYear, membershipStartMonth, annualFee, pointValueCents, artUrl
    case linked, linkedAccountName, displayName, benefits, benefitCount, benefitsUsedCount, creditsYtd
    case creditsAnnualMax, rewardRates, earnings, earningsPeriodLabel, hasRotating, rotating
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    issuer = try c.decode(String.self, forKey: .issuer)
    name = try c.decodeIfPresent(String.self, forKey: .name)
    last4 = try c.decode(String.self, forKey: .last4)
    membershipStartYear = try c.decode(Int.self, forKey: .membershipStartYear)
    membershipStartMonth = try c.decodeIfPresent(Int.self, forKey: .membershipStartMonth)
    annualFee = try c.decode(Double.self, forKey: .annualFee)
    pointValueCents = try c.decode(Double.self, forKey: .pointValueCents)
    artUrl = try c.decodeIfPresent(String.self, forKey: .artUrl)
    linked = try c.decode(Bool.self, forKey: .linked)
    linkedAccountName = try c.decodeIfPresent(String.self, forKey: .linkedAccountName)
    displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
    benefits = try c.decode([BenefitDTO].self, forKey: .benefits)
    benefitCount = try c.decode(Int.self, forKey: .benefitCount)
    benefitsUsedCount = try c.decode(Int.self, forKey: .benefitsUsedCount)
    creditsYtd = try c.decode(Double.self, forKey: .creditsYtd)
    creditsAnnualMax = try c.decode(Double.self, forKey: .creditsAnnualMax)
    rewardRates = try c.decode([RewardRateDTO].self, forKey: .rewardRates)
    earnings = try c.decodeIfPresent(EarningsDTO.self, forKey: .earnings)
    earningsPeriodLabel = try c.decode(String.self, forKey: .earningsPeriodLabel)
    hasRotating = try c.decodeIfPresent(Bool.self, forKey: .hasRotating) ?? false
    rotating = try c.decodeIfPresent([RotatingBonusDTO].self, forKey: .rotating) ?? []
  }
}

struct UserCardsResponse: Decodable, Equatable, Sendable {
  var cards: [UserCardDTO]
  /// Older servers omit it.
  var perkQuestions: [PerkQuestionDTO]

  private enum CodingKeys: String, CodingKey { case cards, perkQuestions }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    cards = try c.decode([UserCardDTO].self, forKey: .cards)
    perkQuestions = try c.decodeIfPresent([PerkQuestionDTO].self, forKey: .perkQuestions) ?? []
  }
}
