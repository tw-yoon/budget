import Foundation
import Testing
@testable import BudgetPhone

/// Settings → Rules: labels and wording (../src/components/RulesDashboard.tsx),
/// with no network.
struct RuleTextTests {
  func rules() throws -> [RuleDTO] {
    try JSONDecoder().decode(RulesResponse.self, from: TestData.fixture("rules")).rules
  }

  @Test func decodesTheFixture() throws {
    let r = try rules()
    #expect(r.map(\.id) == ["r1", "r2"])
    #expect(r[0].outcome == RuleDTO.Outcome(applied: 6, pending: 0, handSet: 3))
    #expect(r[1].outcome == nil, "a rule that is off has no outcome")
    #expect(r[1].enabled == false)
    #expect(r[1].category == "Transportation > Transit")
  }

  @Test func labelsMatchTheWeb() {
    #expect(RuleText.fields == ["MERCHANT", "NAME", "EITHER"])
    #expect(RuleText.matchTypes == ["CONTAINS", "EQUALS", "STARTS_WITH", "REGEX"])
    #expect(RuleText.fieldLabel("MERCHANT") == "Merchant")
    #expect(RuleText.fieldLabel("NAME") == "Description")
    #expect(RuleText.fieldLabel("EITHER") == "Merchant or description")
    #expect(RuleText.matchLabel("CONTAINS") == "contains")
    #expect(RuleText.matchLabel("EQUALS") == "equals")
    #expect(RuleText.matchLabel("STARTS_WITH") == "starts with")
    #expect(RuleText.matchLabel("REGEX") == "matches regex")
    #expect(RuleText.fieldLabel("OTHER") == "OTHER", "an unknown code shows as itself")
    #expect(RuleText.matchLabel("FUZZY") == "FUZZY")
  }

  @Test func plural() {
    #expect(RuleText.plural(1, "transaction") == "1 transaction")
    #expect(RuleText.plural(0, "transaction") == "0 transactions")
    #expect(RuleText.plural(2, "transaction") == "2 transactions")
  }

  @Test func outcomeLine() {
    #expect(RuleText.outcomeLine(.init(applied: 0, pending: 0, handSet: 0)) == "No matching transactions yet")
    #expect(RuleText.outcomeLine(.init(applied: 4, pending: 0, handSet: 0)) == "Matches 4: 4 set by this rule")
    #expect(RuleText.outcomeLine(.init(applied: 6, pending: 0, handSet: 3))
      == "Matches 9: 6 set by this rule \u{00B7} 3 set by hand (kept)")
    #expect(RuleText.outcomeLine(.init(applied: 1, pending: 2, handSet: 3))
      == "Matches 6: 1 set by this rule \u{00B7} 2 waiting for Apply Now \u{00B7} 3 set by hand (kept)")
  }

  @Test func applyNotice() {
    #expect(RuleText.applyNotice(ApplyResult(updated: 12, kept: 0)) == "Re-categorized 12 transactions.")
    #expect(RuleText.applyNotice(ApplyResult(updated: 1, kept: 1))
      == "Re-categorized 1 transaction. 1 matching transaction set by hand was kept.")
    #expect(RuleText.applyNotice(ApplyResult(updated: 0, kept: 2))
      == "Re-categorized 0 transactions. 2 matching transactions set by hand were kept.")
  }

  @Test func takeOverWording() {
    #expect(RuleText.takeOverTitle(count: 3, pattern: "Sample Mart", category: "Sample Groceries")
      == "Replace the category you set by hand on 3 transactions matching \"Sample Mart\" with \"Sample Groceries\"?")
    #expect(RuleText.takeOverMessage == "They'll follow this rule from then on.")
    #expect(RuleText.takeOverNotice(pattern: "Sample Mart", updated: 1) == "\"Sample Mart\" now sets 1 more transaction.")
    #expect(RuleText.takeOverNotice(pattern: "Sample Mart", updated: 3) == "\"Sample Mart\" now sets 3 more transactions.")
  }

  @Test func fixedStrings() {
    #expect(RuleText.updateFailed == "Failed to update the rule.")
    #expect(RuleText.footer
      == "Rules run top-to-bottom on each sync; the first match wins. They never overwrite a category you set by hand or one from Venmo, unless you tap Use Rule for These on a rule. Set a rule's category to Transfer to exclude matching transactions from spending. Tap Apply Now to run them over existing transactions.")
  }

  @Test func categoryOptionsKeepAMissingCurrentCategoryFirst() {
    #expect(RuleText.categoryOptions(["A", "B"], current: "B") == ["A", "B"])
    #expect(RuleText.categoryOptions(["A", "B"], current: "Gone") == ["Gone", "A", "B"])
    #expect(RuleText.categoryOptions(["A", "B"], current: "") == ["A", "B"])
  }
}
