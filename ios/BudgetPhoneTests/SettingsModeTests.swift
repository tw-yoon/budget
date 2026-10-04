import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Pro Mode: the ProMode store's writes and races,
  /// against StubURLProtocol.
  @Suite(.serialized)
  @MainActor
  struct SettingsModeTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(
      gates: [Gate] = [], _ handler: @escaping (URLRequest) throws -> (Int, Data)
    ) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler, gates: gates))
    }

    nonisolated func ok(_ json: String) -> (Int, Data) { (200, Data(json.utf8)) }
    nonisolated var saveError: (Int, Data) { (500, Data(#"{"error":"Failed to save"}"#.utf8)) }

    /// The `value` a PUT sends, so a handler can answer per choice.
    nonisolated func sentValue(_ request: URLRequest) -> String? {
      StubURLProtocol.body(of: request)
        .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }?["value"]
    }

    nonisolated static func isGET(_ r: URLRequest) -> Bool { r.httpMethod == "GET" }
    nonisolated static func isPUT(_ r: URLRequest) -> Bool { r.httpMethod == "PUT" }

    /// The JSON body of a recorded request, as a dictionary.
    func json(_ request: URLRequest) throws -> [String: String] {
      let body = try #require(StubURLProtocol.body(of: request))
      return try #require(try JSONSerialization.jsonObject(with: body) as? [String: String])
    }

    // MARK: ProMode

    @Test func choosingProSendsExactlyTheKeyAndValue() async throws {
      let c = client { _ in self.ok(#"{"ok":true}"#) }
      let mode = ProMode { c }
      await mode.choose(true)
      #expect(mode.isPro)
      #expect(mode.hasLoaded, "a choice settles the question")
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "PUT")
      #expect(request.url?.path() == "/api/ui-state")
      #expect(try json(request) == ["key": "pro-mode", "value": "pro"])
    }

    @Test func choosingNormalSendsNormal() async throws {
      let c = client { _ in self.ok(#"{"ok":true}"#) }
      let mode = ProMode { c }
      await mode.choose(false)
      #expect(try json(#require(StubURLProtocol.requests.first)) == ["key": "pro-mode", "value": "normal"])
    }

    @Test func aChoiceMadeWhileAReadIsInFlightSurvivesIt() async throws {
      let read = Gate(Self.isGET)
      let c = client(gates: [read]) { r in
        r.httpMethod == "GET" ? self.ok(#"{"value":"normal"}"#) : self.ok(#"{"ok":true}"#)
      }
      let mode = ProMode { c }
      let loading = Task { await mode.load() }
      await read.arrival()
      await mode.choose(true)
      read.open()
      await loading.value
      #expect(mode.isPro, "the older read must not overwrite the choice")
    }

    @Test func aReadStartedWhileASaveIsInFlightDoesNotOverwriteTheChoice() async throws {
      let save = Gate(Self.isPUT)
      let c = client(gates: [save]) { r in
        // The server still holds the old value until the PUT is stored.
        r.httpMethod == "GET" ? self.ok(#"{"value":"normal"}"#) : self.ok(#"{"ok":true}"#)
      }
      let mode = ProMode { c }
      let choosing = Task { await mode.choose(true) }
      await save.arrival()
      await mode.load()
      #expect(mode.isPro, "a read that may predate the save is dropped")
      save.open()
      await choosing.value
      #expect(mode.isPro)
      #expect(!mode.saveFailed)
    }

    @Test func aSaveFailureIsFlaggedEvenIfALoadRanMeanwhile() async throws {
      let save = Gate(Self.isPUT)
      let c = client(gates: [save]) { r in
        r.httpMethod == "GET" ? self.ok(#"{"value":"normal"}"#) : self.saveError
      }
      let mode = ProMode { c }
      let choosing = Task { await mode.choose(true) }
      await save.arrival()
      await mode.load()
      save.open()
      await choosing.value
      #expect(mode.isPro)
      #expect(mode.saveFailed, "a load is not a newer choice")
    }

    @Test func aFailedSaveKeepsTheChoiceAndFlagsIt() async throws {
      let c = client { r in self.sentValue(r) == "pro" ? self.saveError : self.ok(#"{"ok":true}"#) }
      let mode = ProMode { c }
      await mode.choose(true)
      #expect(mode.isPro)
      #expect(mode.saveFailed)

      await mode.choose(false)
      #expect(!mode.saveFailed, "the next choice clears the stale flag")
    }

    @Test func theNextChoiceClearsTheFlagBeforeSending() async throws {
      let second = Gate { r in r.httpMethod == "PUT" && self.sentValue(r) == "normal" }
      let c = client(gates: [second]) { r in
        self.sentValue(r) == "pro" ? self.saveError : self.ok(#"{"ok":true}"#)
      }
      let mode = ProMode { c }
      await mode.choose(true)
      #expect(mode.saveFailed)
      let choosing = Task { await mode.choose(false) }
      await second.arrival()
      #expect(!mode.saveFailed, "cleared while the PUT is still in flight")
      second.open()
      await choosing.value
      #expect(!mode.saveFailed)
    }

    @Test func anUnreachableServerFlagsTheSaveToo() async throws {
      let c = client { _ in throw URLError(.cannotConnectToHost) }
      let mode = ProMode { c }
      await mode.choose(true)
      #expect(mode.saveFailed)
    }

    @Test func aStaleSaveFailureDoesNotFlagANewerChoice() async throws {
      let first = Gate(Self.isPUT)
      let c = client(gates: [first]) { r in
        self.sentValue(r) == "pro" ? self.saveError : self.ok(#"{"ok":true}"#)
      }
      let mode = ProMode { c }
      let choosing = Task { await mode.choose(true) }
      await first.arrival()
      await mode.choose(false)
      first.open()
      await choosing.value
      #expect(!mode.isPro)
      #expect(!mode.saveFailed)
    }
  }
}
