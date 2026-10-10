import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// The Accounts connection dot: what a check decides, and when.
  @Suite(.serialized)
  @MainActor
  struct MacLinkStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!
    let noon = Date(timeIntervalSince1970: 1_790_000_000)

    func store(
      gates: [Gate] = [], _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> MacLinkStore {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session(handler, gates: gates))
      let noon = noon
      return MacLinkStore(client: { c }, now: { noon })
    }

    nonisolated static let ok: (Int, Data) = (200, Data(#"{"available":false}"#.utf8))

    @Test func startsChecking() {
      let s = store { _ in Self.ok }
      #expect(s.link == .checking)
      #expect(s.lastContact == nil)
    }

    @Test func anAnswerIsConnected() async {
      let s = store { _ in Self.ok }
      await s.check()
      #expect(s.link == .connected)
      #expect(s.lastContact == noon)
    }

    @Test func itSendsOneLightGet() async {
      let s = store { _ in Self.ok }
      await s.check()
      let r = StubURLProtocol.requests
      #expect(r.count == 1)
      #expect(r.first?.httpMethod == "GET")
      #expect(r.first?.url?.path == "/api/update/phone")
    }

    @Test func aServerErrorStillMeansTheMacAnswered() async {
      let s = store { _ in (500, Data(#"{"error":"Sample failure"}"#.utf8)) }
      await s.check()
      #expect(s.link == .connected)
    }

    @Test func noAnswerIsUnreachable() async {
      let s = store { _ in throw URLError(.timedOut) }
      await s.check()
      #expect(s.link == .unreachable)
      #expect(s.lastContact == nil)
    }

    @Test func aProxyGatewayErrorIsUnreachable() async {
      let s = store { _ in (502, Data()) }
      await s.check()
      #expect(s.link == .unreachable)
    }

    @Test func aRefusedTokenIsItsOwnState() async {
      let s = store { _ in (401, Data(#"{"error":"Unauthorized"}"#.utf8)) }
      await s.check()
      #expect(s.link == .tokenRejected)
    }

    @Test func noServerIsNotConfigured() async {
      let s = MacLinkStore(client: { nil })
      await s.check()
      #expect(s.link == .notConfigured)
    }

    @Test func losingTheMacKeepsTheLastContact() async {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let s = store { _ in
        count.n += 1
        if count.n == 1 { return Self.ok }
        throw URLError(.cannotConnectToHost)
      }
      await s.check()
      await s.check()
      #expect(s.link == .unreachable)
      #expect(s.lastContact == noon)
    }

    @Test func aCheckInFlightLeavesTheDotAsItWas() async {
      let gate = Gate { _ in true }
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let s = store(gates: []) { _ in
        count.n += 1
        return Self.ok
      }
      await s.check()
      StubURLProtocol.gates = [gate]
      let second = Task { await s.check() }
      await gate.arrival()
      #expect(s.link == .connected)
      gate.open()
      await second.value
      #expect(s.link == .connected)
    }

    @Test func aCancelledCheckIsSilent() async {
      let s = store { _ in throw CancellationError() }
      await s.check()
      #expect(s.link == .checking)
    }

    @Test func anOlderCheckFinishingLastIsIgnored() async {
      let gate = Gate { _ in true }
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let s = store(gates: [gate]) { _ in
        // Answers in the order they are let through: the newer check
        // first, then the held older one, which says the Mac is gone.
        count.n += 1
        return count.n == 1 ? Self.ok : (502, Data())
      }
      let first = Task { await s.check() }
      await gate.arrival()
      await s.check()
      gate.open()
      await first.value
      #expect(s.link == .connected)
    }

    @Test func aServerChangeStartsOver() async {
      let s = store { _ in Self.ok }
      await s.check()
      s.serverChanged()
      #expect(s.link == .checking)
      #expect(s.lastContact == nil)
    }
  }
}

/// The popover's words, worked out from the state and the data's age.
struct MacLinkTextTests {
  let now = Date(timeIntervalSince1970: 1_790_000_000)

  @Test func connectedSaysHowFreshTheDataIs() {
    let t = MacLinkText(.connected, updated: now.addingTimeInterval(-120), now: now)
    #expect(t.title == "Connected to Your Mac")
    #expect(t.detail == "Updated 2 minutes ago")
  }

  @Test func underAMinuteIsJustNow() {
    let t = MacLinkText(.connected, updated: now.addingTimeInterval(-20), now: now)
    #expect(t.detail == "Updated just now")
  }

  @Test func connectedWithNothingLoadedHasNoDetail() {
    #expect(MacLinkText(.connected, updated: nil, now: now).detail == nil)
  }

  @Test func unreachableSaysHowOldTheDataIsAndWhatToCheck() {
    let t = MacLinkText(.unreachable, updated: now.addingTimeInterval(-3 * 3600), now: now)
    #expect(t.title == "Can't Reach Your Mac")
    #expect(t.detail == "Last updated 3 hours ago")
    #expect(t.checks == ["Tailscale is on", "Your Mac is awake", "Budget is running on it"])
  }

  @Test func unreachableWithNoDataStillSaysWhatToCheck() {
    let t = MacLinkText(.unreachable, updated: nil, now: now)
    #expect(t.detail == nil)
    #expect(t.checks.count == 3)
  }

  /// A menu shows two lines under a title; every subtitle is a short line.
  @Test func onlyUnreachableHasChecks() {
    for link in [MacLink.checking, .connected, .tokenRejected, .notConfigured] {
      #expect(MacLinkText(link, updated: now, now: now).checks.isEmpty)
    }
  }

  @Test func theOtherStates() {
    let checking = MacLinkText(.checking, updated: now.addingTimeInterval(-120), now: now)
    #expect(checking.title == "Checking Your Mac…")
    #expect(checking.detail == "Last updated 2 minutes ago")
    let token = MacLinkText(.tokenRejected, updated: nil, now: now)
    #expect(token.title == "Access Token Not Accepted")
    #expect(token.detail == "Re-enter it in Settings → Server.")
    let none = MacLinkText(.notConfigured, updated: nil, now: now)
    #expect(none.title == "No Server Set")
    #expect(none.detail == "Add your Mac in Settings → Server.")
  }
}

extension StubbedNetworkTests {
  /// How old the Accounts data on screen is.
  @Suite(.serialized)
  @MainActor
  struct AccountsFreshnessTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data), cache: ResponseCache)
      -> APIClient
    {
      APIClient(
        baseURL: base, session: StubURLProtocol.session(handler), token: "sample-token",
        cache: cache)
    }

    func tempCache() -> ResponseCache {
      ResponseCache(root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
    }

    @Test func aLoadStampsNow() async throws {
      let body = try TestData.accountsJSON()
      let c = client({ _ in (200, body) }, cache: tempCache())
      let noon = Date(timeIntervalSince1970: 1_790_000_000)
      let s = AccountsStore(client: { c }, now: { noon })
      await s.load()
      #expect(s.updatedAt == noon)
    }

    @Test func savedDataCarriesWhenItWasSaved() async throws {
      let cache = tempCache()
      let body = try TestData.accountsJSON()
      let saver = client({ _ in (200, body) }, cache: cache)
      _ = try await saver.accounts()
      let saved = try #require(saver.savedAccountsDate())
      #expect(abs(saved.timeIntervalSinceNow) < 60)

      let offline = client({ _ in throw URLError(.timedOut) }, cache: cache)
      let s = AccountsStore(client: { offline })
      await s.load()
      #expect(s.data != nil)
      #expect(s.updatedAt == saved)
    }

    @Test func aFailedLoadKeepsTheOldStamp() async throws {
      final class Count: @unchecked Sendable { var n = 0 }
      let count = Count()
      let body = try TestData.accountsJSON()
      let c = client(
        { _ in
          count.n += 1
          if count.n == 1 { return (200, body) }
          throw URLError(.timedOut)
        }, cache: tempCache())
      let noon = Date(timeIntervalSince1970: 1_790_000_000)
      let s = AccountsStore(client: { c }, now: { noon })
      await s.load()
      await s.load()
      #expect(s.updatedAt == noon)
    }
  }
}
