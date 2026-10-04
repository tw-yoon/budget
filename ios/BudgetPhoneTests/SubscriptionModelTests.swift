import Foundation
import Testing
@testable import BudgetPhone

struct SubscriptionModelTests {
  func response() throws -> SubscriptionsResponse {
    try JSONDecoder().decode(SubscriptionsResponse.self, from: TestData.fixture("subscriptions"))
  }

  @Test func decodesTheList() throws {
    let r = try response()
    #expect(r.subscriptions.map(\.id) == ["s1", "s2"])
    #expect(r.monthlyTotal == 15.49)
    #expect(r.subscriptions[0].nextDate == "2026-10-05T00:00:00.000Z")
    #expect(r.subscriptions[1].accountName == nil)
    #expect(!r.subscriptions[0].isDetected)
    #expect(r.subscriptions[1].isDetected)
  }

  /// The web header: `${formatCurrency(monthlyTotal)}/mo across ${active} active`.
  @Test func summaryCountsActiveOnly() throws {
    #expect(try response().activeCount == 1)
    #expect(try response().summary == "$15.49/mo across 1 active")
  }

  /// Cadence · account · next date, as the web row's second line.
  @Test func detailLine() throws {
    let r = try response()
    #expect(r.subscriptions[0].detailLine == "Monthly · Sample Rewards Card · next Oct 5, 2026")
    #expect(r.subscriptions[1].detailLine == "Yearly")
  }

  /// The stored calendar date, whatever the phone's time zone.
  @Test func nextDateReadsInUTC() {
    #expect(SubscriptionDTO.nextDateText("2026-10-05T00:00:00.000Z") == "Oct 5, 2026")
    #expect(SubscriptionDTO.nextDateText("not a date") == nil)
  }

  @Test func detectNoticeMatchesTheWeb() throws {
    func notice(_ json: String) throws -> String {
      try JSONDecoder().decode(DetectResult.self, from: Data(json.utf8)).notice
    }
    #expect(try notice(#"{"found":1,"errors":[]}"#) == "Found 1 recurring charge.")
    #expect(try notice(#"{"found":3,"errors":[]}"#) == "Found 3 recurring charges.")
    #expect(try notice(#"{"found":0,"errors":[{"institution":"Example Bank","error":"login required"},{"institution":"Other Bank","error":"timeout"}]}"#)
      == "Found 0 recurring charges. (Example Bank: login required; Other Bank: timeout)")
  }

  @Test func cadencesMatchTheWeb() {
    #expect(Cadence.allCases.map(\.rawValue) == ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY", "QUARTERLY", "YEARLY"])
    #expect(Cadence.allCases.map(\.label) == ["Weekly", "Every 2 weeks", "Twice a month", "Monthly", "Quarterly", "Yearly"])
  }

  @Test func dayIsTheCalendarDate() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    let date = calendar.date(from: DateComponents(year: 2026, month: 3, day: 7, hour: 23))!
    #expect(NewSubscription.day(date, calendar: calendar) == "2026-03-07")
  }
}
