import Foundation

/// A preset the Add Card sheet offers (CARD_PRESETS in
/// ../src/data/card-presets.ts). Only what the picker shows; the server
/// fills in the rates, credits and fee from the slug.
struct CardPreset: Equatable, Identifiable, Sendable {
  let slug: String
  let issuer: String
  let name: String
  var id: String { slug }
}

/// The credits-vs-fee panel (FeeTracker in UserCardItem.tsx).
struct FeeSummary: Equatable, Sendable {
  /// creditsYtd − annualFee.
  let net: Double
  let breakEven: Bool
  /// 0...1, how far the credits have paid the fee off; 1 with no fee.
  let fill: Double
  let hasFee: Bool
  let text: String
}

/// Ports of the Benefits → Cards rules and wording: ../src/lib/categories.ts
/// (ISSUERS, MONTH_NAMES, BENEFIT_PERIODS, PERIOD_LABELS,
/// TRACKABLE_CATEGORIES), ../src/lib/rewards.ts (REWARD_CATEGORIES) and
/// ../src/components/benefits/UserCardItem.tsx.
enum CardRules {
  /// ISSUERS, in order.
  static let issuers = ["AMEX", "CHASE", "DISCOVER"]

  /// MONTH_NAMES.
  static let monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]

  /// BENEFIT_PERIODS.
  static let benefitPeriods = ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]

  /// PERIOD_LABELS.
  static func periodLabel(_ period: String) -> String {
    switch period {
    case "MONTHLY": "Monthly"
    case "QUARTERLY": "Quarterly"
    case "SEMIANNUAL": "Semi-annual"
    case "ANNUAL": "Annual"
    default: period
    }
  }

  /// TRACKABLE_CATEGORIES: the spending a credit can be tracked against.
  static let trackableCategories = [
    "FOOD_AND_DRINK", "TRAVEL", "TRANSPORTATION", "ENTERTAINMENT", "GENERAL_MERCHANDISE",
    "PERSONAL_CARE", "RENT_AND_UTILITIES", "GENERAL_SERVICES", "MEDICAL", "HOME_IMPROVEMENT",
  ]

  /// REWARD_CATEGORIES: the bonus categories, then OTHER.
  static let rewardCategories = Rewards.bonusCategories + ["OTHER"]

  /// The route's lowest start year (../src/app/api/user-cards/route.ts).
  static let earliestStartYear = 1980

  /// CARD_PRESETS, in the web's order.
  static let presets: [CardPreset] = [
    CardPreset(slug: "amex-gold", issuer: "AMEX", name: "Gold Card"),
    CardPreset(slug: "amex-platinum", issuer: "AMEX", name: "The Platinum Card"),
    CardPreset(slug: "amex-blue-cash-preferred", issuer: "AMEX", name: "Blue Cash Preferred"),
    CardPreset(slug: "amex-green", issuer: "AMEX", name: "Green Card"),
    CardPreset(slug: "chase-sapphire-reserve", issuer: "CHASE", name: "Sapphire Reserve"),
    CardPreset(slug: "chase-sapphire-preferred", issuer: "CHASE", name: "Sapphire Preferred"),
    CardPreset(slug: "chase-freedom-unlimited", issuer: "CHASE", name: "Freedom Unlimited"),
    CardPreset(slug: "chase-freedom-flex", issuer: "CHASE", name: "Freedom Flex"),
    CardPreset(slug: "discover-it-cash-back", issuer: "DISCOVER", name: "Discover it Cash Back"),
    CardPreset(slug: "discover-it-chrome", issuer: "DISCOVER", name: "Discover it Chrome"),
    CardPreset(slug: "discover-it-miles", issuer: "DISCOVER", name: "Discover it Miles"),
  ]

  /// The add form's option text, without the web's "— auto-fills rates".
  static func presetLabel(_ preset: CardPreset) -> String {
    "\(Rewards.issuerLabel(preset.issuer)) \(preset.name)"
  }

  /// The card header's title: `displayName || name || "Card"`.
  static func title(_ card: UserCardDTO) -> String {
    if let d = card.displayName, !d.isEmpty { return d }
    if let n = card.name, !n.isEmpty { return n }
    return "Card"
  }

  /// "Amex ··0001".
  static func issuerAndLast4(_ card: UserCardDTO) -> String {
    "\(Rewards.issuerLabel(card.issuer)) ··\(card.last4)"
  }

  /// "Feb 2024", or the bare year without a start month.
  static func memberSince(_ card: UserCardDTO) -> String {
    guard let m = card.membershipStartMonth, (1...12).contains(m) else {
      return "\(card.membershipStartYear)"
    }
    return "\(monthNames[m - 1].prefix(3)) \(card.membershipStartYear)"
  }

  /// "2 yrs", "1 yr", or nil in the first calendar year.
  static func yearsHeld(_ card: UserCardDTO, now: Date = .now, calendar: Calendar = .current) -> String? {
    let years = calendar.component(.year, from: now) - card.membershipStartYear
    guard years > 0 else { return nil }
    return "\(years) yr\(years > 1 ? "s" : "")"
  }

  /// "1/3 credits maxed".
  static func creditsMaxed(_ card: UserCardDTO) -> String {
    "\(card.benefitsUsedCount)/\(card.benefitCount) credits maxed"
  }

  /// The delete-card confirm.
  static func removeCardPrompt(_ card: UserCardDTO) -> String {
    "Remove \(issuerAndLast4(card)) and its benefits?"
  }

  /// The delete-credit confirm.
  static func deleteCreditPrompt(_ benefit: BenefitDTO) -> String {
    "Delete \"\(benefit.name)\" and everything logged against it?"
  }

  static func feeSummary(_ card: UserCardDTO) -> FeeSummary {
    let fee = card.annualFee
    let net = card.creditsYtd - fee
    let breakEven = net >= 0
    let ytd = Formatters.currency(card.creditsYtd)
    let max = Formatters.currency(card.creditsAnnualMax)
    if fee > 0 {
      let middle = breakEven ? "✓ paid for itself, \(Formatters.currency(net)) ahead"
        : "\(Formatters.currency(-net)) to break even"
      return FeeSummary(
        net: net, breakEven: breakEven, fill: min(1, card.creditsYtd / fee), hasFee: true,
        text: "\(ytd) captured this year · \(middle) · up to \(max) available")
    }
    var text = "No annual fee · \(ytd) in credits captured this year"
    if card.creditsAnnualMax > 0 { text += " · up to \(max) available" }
    return FeeSummary(net: net, breakEven: breakEven, fill: 1, hasFee: false, text: text)
  }

  /// Whether the perk switch is on.
  static func perkOn(_ b: BenefitDTO) -> Bool { b.perkActiveFrom != nil }

  /// Whether clearing a manual log leaves something to fall back on.
  static func canAuto(_ b: BenefitDTO) -> Bool {
    perkOn(b) || !b.matchText.isEmpty || !b.matchCategories.isEmpty
  }

  /// BenefitRow's hint under the bar.
  static func creditHint(_ b: BenefitDTO, calendar: Calendar = .current) -> String {
    switch b.source {
    case "auto":
      switch b.autoMode {
      case "perk":
        let on = b.perkActiveFrom.flatMap(Formatters.parseISO).map { Formatters.date($0, calendar: calendar) } ?? ""
        return "Perk active since \(on) · \(b.periodLabel)"
      case "credits": return "From statement credits in transactions · \(b.periodLabel)"
      default: return "From \(b.categoryLabels.joined(separator: ", ")) spending · \(b.periodLabel)"
      }
    case "manual": return "Manually logged · \(b.periodLabel)"
    default: return "Not tracked · \(b.periodLabel)"
    }
  }

  /// YearStrip's click: a pinned window clears, a captured one pins at 0,
  /// anything else pins at its target.
  static func windowCycleValue(_ w: BenefitPeriodDTO) -> Double? {
    w.manual ? nil : w.captured ? 0 : w.target
  }

  /// YearStrip's header: "3/9 captured · $30.00 of $120.00".
  static func yearSummary(_ b: BenefitDTO) -> String {
    let elapsed = b.yearBreakdown.filter { !$0.future }
    let captured = elapsed.filter(\.captured).count
    return "\(captured)/\(elapsed.count) captured · \(Formatters.currency(b.ytdCaptured)) of \(Formatters.currency(b.yearTarget))"
  }

  /// `Math.round(n).toLocaleString()`.
  static func roundedCount(_ n: Double) -> String {
    Int(Formatters.mathRound(n)).formatted(.number.locale(Locale(identifier: "en_US")))
  }

  /// The earnings total: "12,345 pts" for points, else dollars.
  static func formatEarned(_ n: Double, isPoints: Bool) -> String {
    isPoints ? "\(roundedCount(n)) pts" : Formatters.currency(n)
  }

  /// An earnings row's "vs. next best" cell: "—" when even.
  static func formatVsBest(_ n: Double) -> String {
    n == 0 ? "—" : "\(n > 0 ? "+" : "−")\(Formatters.currency(abs(n)))"
  }

  /// "+$12.00 vs. next best" / "−$3.00 vs. next best".
  static func formatIncremental(_ n: Double) -> String {
    "\(n >= 0 ? "+" : "−")\(Formatters.currency(abs(n))) vs. next best"
  }

  /// A typed amount: digits and one decimal point; a comma counts as the
  /// point. nil when it isn't a finite number.
  static func number(_ text: String) -> Double? {
    let t = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
    guard !t.isEmpty, let v = Double(t), v.isFinite else { return nil }
    return v
  }

  /// The last-4 field: digits only, at most four.
  static func last4Input(_ text: String) -> String {
    String(text.filter(\.isASCII).filter(\.isNumber).prefix(4))
  }

  /// `items` after a List drag (SwiftUI's `move(fromOffsets:toOffset:)`,
  /// kept here so the store needn't import SwiftUI).
  static func moved<T>(_ items: [T], from source: IndexSet, to destination: Int) -> [T] {
    let moving = source.sorted().map { items[$0] }
    var rest = items.enumerated().filter { !source.contains($0.offset) }.map(\.element)
    let at = destination - source.filter { $0 < destination }.count
    rest.insert(contentsOf: moving, at: min(max(0, at), rest.count))
    return rest
  }
}
