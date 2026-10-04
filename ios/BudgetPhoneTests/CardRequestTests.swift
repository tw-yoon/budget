import Foundation
import Testing
@testable import BudgetPhone

/// Every Benefits → Cards request body, as the web sends it.
struct CardRequestTests {
  func json<T: Encodable>(_ value: T) throws -> [String: Any] {
    try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
  }

  @Test func presetCardBody() throws {
    let body = try json(NewUserCard.preset(slug: "amex-gold", last4: "0001", startYear: 2024, startMonth: 2))
    #expect(Set(body.keys) == ["presetSlug", "last4", "membershipStartYear", "membershipStartMonth"])
    #expect(body["presetSlug"] as? String == "amex-gold")
    #expect(body["last4"] as? String == "0001")
    #expect(body["membershipStartYear"] as? Int == 2024)
    #expect(body["membershipStartMonth"] as? Int == 2)
  }

  @Test func customCardBodySendsNullsLikeTheWeb() throws {
    let body = try json(NewUserCard.custom(issuer: "CHASE", name: nil, last4: "0002", startYear: 2023, startMonth: nil))
    #expect(Set(body.keys) == ["issuer", "name", "last4", "membershipStartYear", "membershipStartMonth"])
    #expect(body["issuer"] as? String == "CHASE")
    #expect(body["name"] is NSNull)
    #expect(body["membershipStartMonth"] is NSNull)
    #expect(body["membershipStartYear"] as? Int == 2023)
    let named = try json(NewUserCard.custom(issuer: "AMEX", name: "Sample", last4: "0003", startYear: 2025, startMonth: 7))
    #expect(named["name"] as? String == "Sample" && named["membershipStartMonth"] as? Int == 7)
  }

  @Test func cardPatchSendsOnlyItsKeys() throws {
    #expect(try json(UserCardPatch()).isEmpty)
    #expect(UserCardPatch().isEmpty)
    let fee = try json(UserCardPatch(annualFee: .set(95)))
    #expect(Set(fee.keys) == ["annualFee"] && fee["annualFee"] as? Double == 95)
    let month = try json(UserCardPatch(membershipStartMonth: .clear))
    #expect(Set(month.keys) == ["membershipStartMonth"] && month["membershipStartMonth"] is NSNull)
    let all = try json(UserCardPatch(annualFee: .set(0), membershipStartMonth: .set(3), pointValueCents: .set(1.25)))
    #expect(all["annualFee"] as? Double == 0 && all["membershipStartMonth"] as? Int == 3)
    #expect(all["pointValueCents"] as? Double == 1.25)
  }

  @Test func rateBody() throws {
    let body = try json(NewRewardRate(userCardId: "c1", category: "GAS", multiplier: 1.5, unit: "PERCENT"))
    #expect(Set(body.keys) == ["userCardId", "category", "multiplier", "unit"])
    #expect(body["userCardId"] as? String == "c1" && body["category"] as? String == "GAS")
    #expect(body["multiplier"] as? Double == 1.5 && body["unit"] as? String == "PERCENT")
  }

  @Test func creditBody() throws {
    let manual = try json(NewBenefit(userCardId: "c1", name: "Sample Credit", amount: 50, period: "ANNUAL", category: nil))
    #expect(Set(manual.keys) == ["userCardId", "name", "amount", "period", "category"])
    #expect(manual["category"] is NSNull)
    #expect(manual["name"] as? String == "Sample Credit" && manual["amount"] as? Double == 50)
    #expect(manual["period"] as? String == "ANNUAL")
    let tracked = try json(NewBenefit(userCardId: "c1", name: "X", amount: 5, period: "MONTHLY", category: "TRAVEL"))
    #expect(tracked["category"] as? String == "TRAVEL")
  }

  @Test func benefitPatchBodies() throws {
    let used = try json(BenefitPatch.usedManual(12.5))
    #expect(Set(used.keys) == ["usedManual"] && used["usedManual"] as? Double == 12.5)
    let auto = try json(BenefitPatch.usedManual(nil))
    #expect(Set(auto.keys) == ["usedManual"] && auto["usedManual"] is NSNull)
    let pin = try json(BenefitPatch.window(key: "2026-03", value: 10))
    #expect(Set(pin.keys) == ["periodKey", "value"])
    #expect(pin["periodKey"] as? String == "2026-03" && pin["value"] as? Double == 10)
    let unpin = try json(BenefitPatch.window(key: "2026-03", value: nil))
    #expect(unpin["value"] is NSNull)
    let perk = try json(BenefitPatch.perkActive(true))
    #expect(Set(perk.keys) == ["perkActive"] && perk["perkActive"] as? Bool == true)
  }

  @Test func reorderBody() throws {
    let body = try json(CardOrder(ids: ["c2", "c1"]))
    #expect(Set(body.keys) == ["ids"] && body["ids"] as? [String] == ["c2", "c1"])
  }
}

/// The card Edit sheet: only what changed goes out.
struct CardEditFormTests {
  @Test func anUntouchedFormIsEmpty() throws {
    for card in try TestData.userCards() {
      #expect(CardEditForm(card: card).patch(against: card).isEmpty)
      #expect(CardEditForm(card: card).isValid)
    }
  }

  @Test func onlyTheEditedFieldIsSent() throws {
    let card = try TestData.userCards()[0]
    var form = CardEditForm(card: card)
    form.feeText = "95"
    #expect(form.patch(against: card) == UserCardPatch(annualFee: .set(95)))
  }

  @Test func clearingTheMonthSendsNull() throws {
    let card = try TestData.userCards()[0]
    var form = CardEditForm(card: card)
    form.startMonth = nil
    #expect(form.patch(against: card) == UserCardPatch(membershipStartMonth: .clear))
    form.startMonth = 5
    #expect(form.patch(against: card) == UserCardPatch(membershipStartMonth: .set(5)))
  }

  @Test func pointValueOnlyOnAPointsCard() throws {
    let points = try TestData.userCards()[0]
    var form = CardEditForm(card: points)
    #expect(form.showsPointValue)
    form.pointValueText = "2"
    #expect(form.patch(against: points) == UserCardPatch(pointValueCents: .set(2)))
    let cash = try TestData.userCards()[1]
    var cashForm = CardEditForm(card: cash)
    #expect(!cashForm.showsPointValue)
    cashForm.pointValueText = "2"
    #expect(cashForm.patch(against: cash).isEmpty)
  }

  @Test func invalidValuesBlockSave() throws {
    let card = try TestData.userCards()[0]
    var form = CardEditForm(card: card)
    form.feeText = "-1"
    #expect(!form.isValid)
    form.feeText = ""
    #expect(!form.isValid)
    form.feeText = "0"
    #expect(form.isValid && form.patch(against: card) == UserCardPatch(annualFee: .set(0)))
    form.pointValueText = "0"
    #expect(!form.isValid)
  }

  @Test func retypingTheSameValueIsNoChange() throws {
    let card = try TestData.userCards()[0]
    var form = CardEditForm(card: card)
    form.feeText = "250.0"
    #expect(form.patch(against: card).isEmpty)
  }
}
