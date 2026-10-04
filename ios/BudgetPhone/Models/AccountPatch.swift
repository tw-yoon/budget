import Foundation

/// One field of a PATCH body. `.unchanged` leaves the key out entirely, so the
/// server keeps whatever it has — which may be an edit another device made
/// since this one loaded. `.clear` sends null.
enum PatchValue<Value: Encodable & Equatable & Sendable>: Equatable, Sendable {
  case unchanged
  case set(Value)
  case clear
}

/// Body for PATCH /api/accounts/:id. The route applies only the keys present
/// (`"displayName" in body`), so a patch carrying just the edited fields
/// cannot overwrite a field it did not touch.
struct AccountPatch: Encodable, Equatable, Sendable {
  var displayName: PatchValue<String> = .unchanged
  var manualDueDay: PatchValue<Int> = .unchanged
  var manualCreditLimit: PatchValue<Double> = .unchanged

  var isEmpty: Bool {
    displayName == .unchanged && manualDueDay == .unchanged
      && manualCreditLimit == .unchanged
  }

  private enum CodingKeys: String, CodingKey {
    case displayName, manualDueDay, manualCreditLimit
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try Self.encode(displayName, .displayName, into: &c)
    try Self.encode(manualDueDay, .manualDueDay, into: &c)
    try Self.encode(manualCreditLimit, .manualCreditLimit, into: &c)
  }

  private static func encode<V>(
    _ value: PatchValue<V>,
    _ key: CodingKeys,
    into c: inout KeyedEncodingContainer<CodingKeys>
  ) throws {
    switch value {
    case .unchanged: break
    case .set(let v): try c.encode(v, forKey: key)
    case .clear: try c.encodeNil(forKey: key)
    }
  }
}

/// The edit form's state, kept apart from the view so the diff and the
/// validation can be tested without SwiftUI.
struct AccountEditForm: Equatable {
  var name: String
  var dueDay: Int?
  var creditLimitText: String

  /// What `creditLimitText` was initialised to. `Formatters.plainNumber`
  /// rounds to a handful of fraction digits, so re-parsing the text and
  /// comparing it to `account.manualCreditLimit` can disagree with the
  /// stored value even though the user never touched the field — the exact
  /// silent-rewrite a partial PATCH exists to avoid. Comparing the text
  /// itself sidesteps that.
  private let initialCreditLimitText: String

  init(account: AccountDTO) {
    name = account.displayName ?? ""
    dueDay = account.manualDueDay
    creditLimitText = account.manualCreditLimit.map(Formatters.plainNumber) ?? ""
    initialCreditLimitText = creditLimitText
  }

  enum LimitInput: Equatable {
    case empty
    case value(Double)
    case invalid
  }

  var creditLimit: LimitInput {
    let t = creditLimitText.trimmingCharacters(in: .whitespaces)
    if t.isEmpty { return .empty }
    guard let v = Double(t), v.isFinite, v >= 0 else { return .invalid }
    return .value(v)
  }

  var isValid: Bool { creditLimit != .invalid }

  /// Only what differs from `account`. Due day and limit are compared only
  /// for credit accounts, the only ones whose form shows them.
  func patch(against account: AccountDTO) -> AccountPatch {
    var patch = AccountPatch()

    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let newName: String? = trimmed.isEmpty ? nil : trimmed
    if newName != account.displayName {
      patch.displayName = newName.map(PatchValue.set) ?? .clear
    }

    guard account.isCredit else { return patch }

    if dueDay != account.manualDueDay {
      patch.manualDueDay = dueDay.map(PatchValue.set) ?? .clear
    }

    if creditLimitText != initialCreditLimitText {
      let newLimit: Double?
      switch creditLimit {
      case .empty: newLimit = nil
      case .value(let v): newLimit = v
      case .invalid: return patch  // Save is disabled; never send a bad limit.
      }
      if newLimit != account.manualCreditLimit {
        patch.manualCreditLimit = newLimit.map(PatchValue.set) ?? .clear
      }
    }
    return patch
  }
}
