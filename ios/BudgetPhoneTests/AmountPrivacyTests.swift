import Testing
@testable import BudgetPhone

struct AmountPrivacyTests {
  @Test func storageKeyIsStable() {
    // Renaming it would silently reveal amounts for anyone who hid them.
    #expect(AmountPrivacy.storageKey == "amounts.hidden")
  }

  @Test func maskReplacesEveryFigureWithItsSign() {
    #expect(AmountPrivacy.mask("$1,234.56") == "$••••••")
    #expect(AmountPrivacy.mask("-$12.00") == "$••••••")
    #expect(AmountPrivacy.mask("+$3.50") == "$••••••")
    #expect(AmountPrivacy.mask("\u{2212}$3.50") == "$••••••")
    #expect(AmountPrivacy.mask("$1.2K") == "$••••••")
    #expect(AmountPrivacy.mask("$0") == "$••••••")
  }

  @Test func maskKeepsTheWordsAround() {
    #expect(AmountPrivacy.mask("Payment due Oct 15, 2026 · in 20d · min $35.00")
      == "Payment due Oct 15, 2026 · in 20d · min $••••••")
    #expect(AmountPrivacy.mask("$45.00 over the $1,200.00 limit") == "$•••••• over the $•••••• limit")
    #expect(AmountPrivacy.mask("$30.00/mo across 4 active") == "$••••••/mo across 4 active")
    #expect(AmountPrivacy.mask("Average —") == "Average —")
    #expect(AmountPrivacy.mask("$9.99", with: "hidden amount") == "hidden amount")
  }
}
