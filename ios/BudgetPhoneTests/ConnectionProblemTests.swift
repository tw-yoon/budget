import Foundation
import Testing
@testable import BudgetPhone

/// Plain-language grouping of failures (no network).
struct ConnectionProblemTests {
  let unreachableSentence =
    "Can't reach your Mac. Check that Tailscale is on and the Mac is awake with Budget running."
  let cantReachBanner = "Showing saved data — can't reach your Mac."

  func expectCantReach(_ error: APIError) {
    let p = ConnectionProblem(error)
    #expect(p.title == "Can't Reach Your Mac")
    #expect(p.systemImage == "wifi.exclamationmark")
    #expect(p.message == "Budget on this iPhone can't connect to your Mac. Check these, then tap Retry:")
    #expect(p.steps == [
      "Tailscale is on — open the Tailscale app on this iPhone and turn it on.",
      "Your Mac is on and awake.",
      "Budget is running on your Mac.",
    ])
  }

  @Test func unreachableIsCantReach() {
    let e = APIError.unreachable("The request timed out.")
    expectCantReach(e)
    #expect(e.isUnreachable)
    #expect(e.message == unreachableSentence)
    #expect(e.detail == "The request timed out.")
    #expect(e.loadBanner == cantReachBanner)
  }

  @Test(arguments: [502, 503, 504])
  func proxyStatusesAreUnreachable(status: Int) {
    let e = APIError.server(status: status, message: "Bad Gateway")
    expectCantReach(e)
    #expect(e.isUnreachable)
    #expect(e.message == unreachableSentence)
    #expect(e.detail == "Bad Gateway")
    #expect(e.loadBanner == cantReachBanner)
  }

  @Test func otherServerStatusIsSomethingWentWrong() {
    let e = APIError.server(status: 500, message: "Database is locked")
    let p = ConnectionProblem(e)
    #expect(!e.isUnreachable)
    #expect(e.detail == nil)
    #expect(p.title == "Something Went Wrong")
    #expect(p.systemImage == "exclamationmark.triangle")
    #expect(p.message == "Database is locked")
    #expect(p.steps.isEmpty)
    #expect(e.loadBanner == "Database is locked")
  }

  @Test func unauthorizedNeedsToken() {
    let e = APIError.unauthorized
    let p = ConnectionProblem(e)
    #expect(!e.isUnreachable)
    #expect(p.title == "Access Token Needed")
    #expect(p.systemImage == "key")
    #expect(p.message == "Your Mac didn't accept this iPhone's access token. Go to Settings → Server and paste the current token. You'll find it on the Mac in Budget's Settings → Remote Access.")
    #expect(p.steps.isEmpty)
    #expect(e.loadBanner == "Showing saved data — access token not accepted. Re-enter it in Settings → Server.")
  }

  @Test func decodingIsSomethingWentWrong() {
    let e = APIError.decoding("Missing field.")
    let p = ConnectionProblem(e)
    #expect(!e.isUnreachable)
    #expect(p.title == "Something Went Wrong")
    #expect(p.message == e.message)
    #expect(p.steps.isEmpty)
    #expect(e.loadBanner == e.message)
  }

  @Test func notConfiguredUsesTheCantReachLayout() {
    let e = APIError.notConfigured
    expectCantReach(e)
    #expect(!e.isUnreachable)
    #expect(e.detail == nil)
    #expect(e.loadBanner == "No server is set.")
  }
}
