import Foundation
import Testing
@testable import BudgetPhone

struct UpdateModelTests {
  @Test func decodesTheStatus() throws {
    let json = #"{"version":"1.0.0","latest":"1.1.0","available":true,"canUpdate":true,"updating":false,"failed":null,"checkedAt":"2026-01-01T00:00:00.000Z"}"#
    let s = try JSONDecoder().decode(UpdateStatus.self, from: Data(json.utf8))
    #expect(s == UpdateStatus(version: "1.0.0", latest: "1.1.0", available: true, canUpdate: true, updating: false, failed: nil, checkedAt: "2026-01-01T00:00:00.000Z"))
  }

  @Test func decodesThePhoneStatus() throws {
    let json = #"{"available":true,"installing":false,"failed":"Install failed.","lastInstalled":null}"#
    let s = try JSONDecoder().decode(PhoneUpdateStatus.self, from: Data(json.utf8))
    #expect(s == PhoneUpdateStatus(available: true, installing: false, failed: "Install failed.", lastInstalled: nil))
  }

  @Test func comparesVersionsByNumber() {
    #expect(AppVersion.isNewer("0.12.0", than: "0.11.0"))
    #expect(AppVersion.isNewer("0.10.0", than: "0.9.1"))
    #expect(!AppVersion.isNewer("0.11.0", than: "0.11.0"))
    #expect(!AppVersion.isNewer("0.9.0", than: "0.11.0"))
    #expect(AppVersion.isNewer("1.0", than: "0.99.9"))
  }

  @Test func pollOutcomeMatchesTheWeb() {
    let base = UpdateStatus(version: "1.0.0", latest: "1.1.0", available: true, canUpdate: true, updating: false, failed: nil, checkedAt: "")
    #expect(UpdatePoll.outcome(nil) == .waiting)
    var s = base; s.updating = true
    #expect(UpdatePoll.outcome(s) == .waiting)
    s = base; s.version = "1.1.0"; s.updating = true
    #expect(UpdatePoll.outcome(s) == .waiting)
    s = base; s.version = "1.1.0"
    #expect(UpdatePoll.outcome(s) == .done)
    // A release without a version bump still ends.
    #expect(UpdatePoll.outcome(base) == .done)
    s = base; s.failed = "boom"
    #expect(UpdatePoll.outcome(s) == .failed("boom"))
  }

  @Test func readsTheDatesInsideASignedProfile() throws {
    // A profile is a signed blob with the plist inside; invented dates.
    let plist = """
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0"><dict>
      <key>CreationDate</key><date>2026-01-04T10:00:00Z</date>
      <key>ExpirationDate</key><date>2026-01-11T10:00:00Z</date>
      <key>Name</key><string>Sample Profile</string>
      </dict></plist>
      """
    var blob = Data([0x30, 0x82, 0x01, 0x00, 0xFF, 0x00])
    blob.append(Data(plist.utf8))
    blob.append(Data([0x00, 0xA0, 0x82]))
    let p = try #require(Provisioning.parse(blob))
    #expect(p.created == ISO8601DateFormatter().date(from: "2026-01-04T10:00:00Z"))
    #expect(p.expires == ISO8601DateFormatter().date(from: "2026-01-11T10:00:00Z"))
    #expect(Provisioning.parse(Data("no plist here".utf8)) == nil)
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct UpdateStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    nonisolated func status(_ version: String, updating: Bool = false, failed: String? = nil) -> (Int, Data) {
      let failedJSON = failed.map { "\"\($0)\"" } ?? "null"
      return (200, Data(#"{"version":"\#(version)","latest":"1.1.0","available":true,"canUpdate":true,"updating":\#(updating),"failed":\#(failedJSON),"checkedAt":""}"#.utf8))
    }

    @Test func loadAsksWithoutForcingACheck() async {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { _ in status("1.0.0") })
      let store = UpdateStore { c }
      await store.load()
      #expect(store.status?.version == "1.0.0")
      #expect(StubURLProtocol.requests.first?.url?.query == nil)
    }

    @Test func aFailedLoadHidesTheRow() async {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { _ in throw URLError(.timedOut) })
      let store = UpdateStore { c }
      await store.load()
      #expect(store.status == nil)
    }

    @Test func installPostsAnEmptyBodyThenPollsUntilTheNewVersion() async throws {
      var gets = 0
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (202, Data(#"{"ok":true}"#.utf8)) }
        gets += 1
        switch gets {
        case 1: return status("1.0.0")                   // load
        case 2: return status("1.0.0", updating: true)   // first poll
        case 3: throw URLError(.cannotConnectToHost)     // server stopped
        default: return status("1.1.0")
        }
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      await store.load()
      await store.install()
      #expect(store.phase == .updated(to: "1.1.0"))
      #expect(store.status?.version == "1.1.0")
      let post = try #require(StubURLProtocol.requests.first { $0.httpMethod == "POST" })
      #expect(post.url?.path == "/api/update")
      #expect(StubURLProtocol.body(of: post) == Data("{}".utf8))
    }

    @Test func aRefusedInstallSaysWhy() async {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        r.httpMethod == "POST" ? (409, Data(#"{"error":"Budget is already up to date."}"#.utf8)) : status("1.0.0")
      })
      let store = UpdateStore { c }
      await store.load()
      await store.install()
      #expect(store.phase == .idle)
      #expect(store.startError == "Budget is already up to date.")
    }

    @Test func aLoadDuringAnUpdateFollowsItInsteadOfOfferingInstall() async {
      var gets = 0
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (409, Data(#"{"error":"An update is already running."}"#.utf8)) }
        gets += 1
        switch gets {
        case 1: return status("1.0.0", updating: true)   // opened mid-update
        case 2: throw URLError(.cannotConnectToHost)     // server stopped
        default: return status("1.0.0")                  // back, no version bump
        }
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      await store.load()
      #expect(store.phase == .updated(to: "1.0.0"))
      #expect(store.status?.updating == false)
      #expect(!StubURLProtocol.requests.contains { $0.httpMethod == "POST" })
    }

    @Test func aFailedUpdateShowsTheLog() async {
      var gets = 0
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (202, Data(#"{"ok":true}"#.utf8)) }
        gets += 1
        return gets == 1 ? status("1.0.0") : status("1.0.0", failed: "Build failed")
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      await store.load()
      await store.install()
      #expect(store.phase == .failed("Build failed"))
    }

    @Test func givesUpAfterTheLimit() async {
      var gets = 0
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (202, Data(#"{"ok":true}"#.utf8)) }
        gets += 1
        return status("1.0.0", updating: gets > 1)
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      store.pollLimit = .milliseconds(60)
      await store.load()
      await store.install()
      #expect(store.phase == .stillNotBack)
    }

    @Test func loadDuringAnUpdateKeepsTheRow() async {
      var gets = 0
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (202, Data(#"{"ok":true}"#.utf8)) }
        gets += 1
        if gets == 1 { return status("1.0.0") }
        throw URLError(.cannotConnectToHost)
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(200)
      store.pollLimit = .seconds(5)
      await store.load()
      let install = Task { await store.install() }
      try? await Task.sleep(for: .milliseconds(50))
      #expect(store.phase == .updating)
      await store.load()
      #expect(store.status?.version == "1.0.0")
      #expect(store.phase == .updating)
      install.cancel()
      await install.value
    }

    @Test func aLoadAfterNotBackReturnsToIdle() async {
      var gets = 0
      var back = false
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (202, Data(#"{"ok":true}"#.utf8)) }
        gets += 1
        return status("1.0.0", updating: gets > 1 && !back)
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      store.pollLimit = .milliseconds(40)
      await store.load()
      await store.install()
      #expect(store.phase == .stillNotBack)
      back = true
      await store.load()
      #expect(store.phase == .idle)
      #expect(store.status != nil)
    }

    @Test func aLoadAfterAFailedUpdateReturnsToIdleWithTheLog() async {
      var gets = 0
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (202, Data(#"{"ok":true}"#.utf8)) }
        gets += 1
        return gets == 1 ? status("1.0.0") : status("1.0.0", failed: "Build failed")
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      await store.load()
      await store.install()
      #expect(store.phase == .failed("Build failed"))
      await store.load()
      #expect(store.phase == .idle)
      #expect(store.status?.failed == "Build failed")
    }
  }
}
