import Foundation

// Settings → Rules (../src/app/api/rules/**). Each body carries only its
// own fields, exactly as RulesDashboard.tsx sends them.

private struct CategoryPatch: Encodable { let category: String }
private struct EnabledPatch: Encodable { let enabled: Bool }

extension APIClient {
  /// GET /api/rules — all rules in evaluation order, with outcomes.
  func rules() async throws(APIError) -> RulesResponse {
    try await get("api/rules", timeout: 15, saveAs: "rules")
  }

  func savedRules() -> RulesResponse? { saved("rules", "api/rules") }

  /// POST /api/rules — `{ field, matchType, pattern, category }`.
  func createRule(_ rule: NewRule) async throws(APIError) {
    _ = try await send("POST", "api/rules", body: encode(rule), timeout: 15)
  }

  /// PATCH /api/rules/:id — `{ category }` only.
  func setRuleCategory(id: String, _ category: String) async throws(APIError) {
    _ = try await send(
      "PATCH", "api/rules/\(id)", body: encode(CategoryPatch(category: category)), timeout: 15)
  }

  /// PATCH /api/rules/:id — `{ enabled }` only.
  func setRuleEnabled(id: String, _ enabled: Bool) async throws(APIError) {
    _ = try await send(
      "PATCH", "api/rules/\(id)", body: encode(EnabledPatch(enabled: enabled)), timeout: 15)
  }

  /// DELETE /api/rules/:id.
  func deleteRule(id: String) async throws(APIError) {
    _ = try await send("DELETE", "api/rules/\(id)", timeout: 15)
  }

  /// POST /api/rules/apply — re-runs every enabled rule over existing
  /// transactions, hence the long timeout.
  func applyRules() async throws(APIError) -> ApplyResult {
    try decode(await send("POST", "api/rules/apply", body: Data("{}".utf8), timeout: 60))
  }

  /// POST /api/rules/:id/take-over — the rule replaces the hand-set
  /// categories on the rows it is the first match for.
  func takeOverRule(id: String) async throws(APIError) -> TakeOverResult {
    try decode(
      await send("POST", "api/rules/\(id)/take-over", body: Data("{}".utf8), timeout: 30))
  }
}
