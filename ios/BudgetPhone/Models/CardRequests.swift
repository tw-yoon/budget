import Foundation

// Request bodies for Benefits → Cards, each exactly what the web sends
// (../src/components/benefits/CardsSection.tsx, UserCardItem.tsx,
// useUserCards.ts).

/// POST /api/user-cards. A preset fixes the issuer and name and seeds rates
/// and credits; a custom card names its issuer. `name` and
/// `membershipStartMonth` go out as null when empty, as the web's do.
enum NewUserCard: Encodable, Equatable, Sendable {
  case preset(slug: String, last4: String, startYear: Int, startMonth: Int?)
  case custom(issuer: String, name: String?, last4: String, startYear: Int, startMonth: Int?)

  private enum CodingKeys: String, CodingKey {
    case presetSlug, issuer, name, last4, membershipStartYear, membershipStartMonth
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .preset(let slug, let last4, let year, let month):
      try c.encode(slug, forKey: .presetSlug)
      try c.encode(last4, forKey: .last4)
      try c.encode(year, forKey: .membershipStartYear)
      try c.encode(month, forKey: .membershipStartMonth)
    case .custom(let issuer, let name, let last4, let year, let month):
      try c.encode(issuer, forKey: .issuer)
      try c.encode(name, forKey: .name)
      try c.encode(last4, forKey: .last4)
      try c.encode(year, forKey: .membershipStartYear)
      try c.encode(month, forKey: .membershipStartMonth)
    }
  }
}

/// PATCH /api/user-cards/:id. The route writes only the keys present, so
/// only what changed is sent; a cleared start month is null.
struct UserCardPatch: Encodable, Equatable, Sendable {
  var annualFee: PatchValue<Double> = .unchanged
  var membershipStartMonth: PatchValue<Int> = .unchanged
  var pointValueCents: PatchValue<Double> = .unchanged

  var isEmpty: Bool {
    annualFee == .unchanged && membershipStartMonth == .unchanged && pointValueCents == .unchanged
  }

  private enum CodingKeys: String, CodingKey { case annualFee, membershipStartMonth, pointValueCents }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try Self.put(annualFee, .annualFee, &c)
    try Self.put(membershipStartMonth, .membershipStartMonth, &c)
    try Self.put(pointValueCents, .pointValueCents, &c)
  }

  private static func put<V>(
    _ value: PatchValue<V>, _ key: CodingKeys, _ c: inout KeyedEncodingContainer<CodingKeys>
  ) throws {
    switch value {
    case .unchanged: break
    case .set(let v): try c.encode(v, forKey: key)
    case .clear: try c.encodeNil(forKey: key)
    }
  }
}

/// POST /api/rewards — adds a rate, or overrides the card's rate for that
/// category (the route upserts on card + category).
struct NewRewardRate: Encodable, Equatable, Sendable {
  let userCardId: String
  let category: String
  let multiplier: Double
  let unit: String
}

/// POST /api/benefits. `category` is null for a credit tracked by hand.
struct NewBenefit: Encodable, Equatable, Sendable {
  let userCardId: String
  let name: String
  let amount: Double
  let period: String
  let category: String?

  private enum CodingKeys: String, CodingKey { case userCardId, name, amount, period, category }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(userCardId, forKey: .userCardId)
    try c.encode(name, forKey: .name)
    try c.encode(amount, forKey: .amount)
    try c.encode(period, forKey: .period)
    try c.encode(category, forKey: .category)
  }
}

/// PATCH /api/benefits/:id — one of the route's three bodies.
enum BenefitPatch: Encodable, Equatable, Sendable {
  /// `{ usedManual }`: log the current period; nil reverts to auto.
  case usedManual(Double?)
  /// `{ periodKey, value }`: pin one window; nil clears the pin.
  case window(key: String, value: Double?)
  /// `{ perkActive }`: switch a flat-value perk on or off.
  case perkActive(Bool)

  private enum CodingKeys: String, CodingKey { case usedManual, periodKey, value, perkActive }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .usedManual(let n): try c.encode(n, forKey: .usedManual)
    case .window(let key, let value):
      try c.encode(key, forKey: .periodKey)
      try c.encode(value, forKey: .value)
    case .perkActive(let on): try c.encode(on, forKey: .perkActive)
    }
  }
}

/// POST /api/user-cards/reorder — every card id, in the new order.
struct CardOrder: Encodable, Equatable, Sendable {
  let ids: [String]
}

/// The card Edit sheet's state, kept apart from the view so the diff and the
/// validation can be tested without SwiftUI. Fee and point value are compared
/// as typed text, so an untouched field is never re-sent (see AccountEditForm).
struct CardEditForm: Equatable {
  var startMonth: Int?
  var feeText: String
  var pointValueText: String
  /// The web edits the point value only on a points card with earnings.
  let showsPointValue: Bool

  private let initialFeeText: String
  private let initialPointValueText: String

  init(card: UserCardDTO) {
    startMonth = card.membershipStartMonth
    feeText = Formatters.plainNumber(card.annualFee)
    pointValueText = Formatters.plainNumber(card.pointValueCents)
    showsPointValue = card.earnings?.unit == "X"
    initialFeeText = feeText
    initialPointValueText = pointValueText
  }

  /// The route's rules: a fee of 0 or more, a point value above 0.
  var fee: Double? { CardRules.number(feeText).flatMap { $0 >= 0 ? $0 : nil } }
  var pointValue: Double? { CardRules.number(pointValueText).flatMap { $0 > 0 ? $0 : nil } }

  var isFeeValid: Bool { feeText == initialFeeText || fee != nil }
  var isPointValueValid: Bool { pointValueText == initialPointValueText || pointValue != nil }
  var isValid: Bool { isFeeValid && isPointValueValid }

  /// Only what differs from `card`.
  func patch(against card: UserCardDTO) -> UserCardPatch {
    var patch = UserCardPatch()
    if startMonth != card.membershipStartMonth {
      patch.membershipStartMonth = startMonth.map(PatchValue.set) ?? .clear
    }
    if feeText != initialFeeText, let fee, fee != card.annualFee {
      patch.annualFee = .set(fee)
    }
    if showsPointValue, pointValueText != initialPointValueText, let pointValue,
      pointValue != card.pointValueCents
    {
      patch.pointValueCents = .set(pointValue)
    }
    return patch
  }
}
