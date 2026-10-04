import Foundation

// Mirrors of the rules routes (../src/app/api/rules/**).

/// GET /api/rules — one rule, in evaluation order, with how the rows it is
/// the first match for stand. `outcome` is null for a rule that is off.
struct RuleDTO: Decodable, Equatable, Sendable, Identifiable {
  struct Outcome: Decodable, Equatable, Sendable {
    let applied: Int
    let pending: Int
    let handSet: Int
  }
  let id: String
  let field: String
  let matchType: String
  let pattern: String
  let category: String
  let priority: Int
  let enabled: Bool
  let outcome: Outcome?
}

struct RulesResponse: Decodable, Equatable, Sendable {
  let rules: [RuleDTO]
}

/// POST /api/rules — the four fields RuleForm sends.
struct NewRule: Encodable, Equatable, Sendable {
  let field: String
  let matchType: String
  let pattern: String
  let category: String
}

/// POST /api/rules/apply.
struct ApplyResult: Decodable, Equatable, Sendable {
  let updated: Int
  let kept: Int
}

/// POST /api/rules/:id/take-over.
struct TakeOverResult: Decodable, Equatable, Sendable {
  let updated: Int
}
