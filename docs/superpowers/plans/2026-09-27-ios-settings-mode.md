# iPhone Settings → Mode Implementation Plan

> **Revised after build (2026-09-27):** the Theme store (Task 2) and the Mode page (Task 3) were later removed. Pro Mode is now a switch on the Settings screen, and the app follows the iPhone's own Light/Dark setting. The spec is the current source of truth.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings → Mode screen to the iPhone app for picking Normal or Pro and Light, Dark or System. Both choices are shared with the web through `/api/ui-state`, and the theme restyles the phone.

**Architecture:** `ProMode` (it exists already) and a new `Theme` store are both `@MainActor @Observable`. `RootView` owns them, loads them at launch and on foreground, and applies `.preferredColorScheme`. A new `APIClient.putUIState` sends the writes. `ModeSettingsView` is pushed from `SettingsView`.

**Tech Stack:** Swift 6, SwiftUI, iOS 26, Swift Testing, `StubURLProtocol`.

**Spec:** `docs/superpowers/specs/2026-09-27-ios-settings-mode-design.md`

## Global Constraints

- Work in `ios/` on branch `ios-settings-mode`. Read `ios/CLAUDE.md` first.
- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. New files under `BudgetPhone/` or `BudgetPhoneTests/` join their targets automatically.
- Test command, run from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Before every commit, run `bash ../scripts/test-scrub.sh`.
- Every stubbed suite nests under `StubbedNetworkTests` with `@Suite(.serialized)`.
- Inside `Task { }`, use `do throws(APIError) { … }`.
- **The live server holds real data.** Never send it a PUT. Don't tap Mode or Appearance rows in the simulator against a real server.
- Copy wording verbatim from `../src/components/SettingsMode.tsx`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: `putUIState` and `ProMode.choose`

**Files:**
- Create: `ios/BudgetPhone/Networking/APIClient+Settings.swift`
- Modify: `ios/BudgetPhone/Shared/ProMode.swift`
- Create: `ios/BudgetPhoneTests/SettingsModeTests.swift`

**Interfaces:**
- Produces:
  - `APIClient.putUIState(key: String, value: String) async throws(APIError)`
  - `ProMode.choose(_ pro: Bool) async`
  - `ProMode.saveFailed: Bool`, which the view can set so it can be cleared on dismiss
  - `SettingsModeTests`, with the helpers `client(_:)`, `json(_:)` and `ok(_:)`

- [ ] **Step 1: Write the failing tests**

Create `ios/BudgetPhoneTests/SettingsModeTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

extension StubbedNetworkTests {
  /// Settings → Mode: the ProMode and Theme stores' writes and races,
  /// against StubURLProtocol.
  @Suite(.serialized)
  @MainActor
  struct SettingsModeTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
      APIClient(baseURL: base, session: StubURLProtocol.session(handler))
    }

    func ok(_ json: String) -> (Int, Data) { (200, Data(json.utf8)) }

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
      let c = client { r in
        if r.httpMethod == "GET" {
          Thread.sleep(forTimeInterval: 0.1)
          return self.ok(#"{"value":"normal"}"#)
        }
        return self.ok(#"{"ok":true}"#)
      }
      let mode = ProMode { c }
      let loading = Task { await mode.load() }
      try await Task.sleep(for: .milliseconds(20))
      await mode.choose(true)
      await loading.value
      #expect(mode.isPro, "the older read must not overwrite the choice")
    }

    @Test func aFailedSaveKeepsTheChoiceAndFlagsIt() async throws {
      var fail = true
      let c = client { _ in
        if fail { return (500, Data(#"{"error":"Failed to save"}"#.utf8)) }
        return self.ok(#"{"ok":true}"#)
      }
      let mode = ProMode { c }
      await mode.choose(true)
      #expect(mode.isPro)
      #expect(mode.saveFailed)

      fail = false
      await mode.choose(false)
      #expect(!mode.saveFailed, "the next choice clears the stale flag")
    }

    @Test func anUnreachableServerFlagsTheSaveToo() async throws {
      let c = client { _ in throw URLError(.cannotConnectToHost) }
      let mode = ProMode { c }
      await mode.choose(true)
      #expect(mode.saveFailed)
    }
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the test command from the Global Constraints.
Expected: a compile failure saying `ProMode` has no member `choose` or `saveFailed`.

- [ ] **Step 3: Add `putUIState`**

Create `ios/BudgetPhone/Networking/APIClient+Settings.swift`:

```swift
import Foundation

/// The body pushSynced sends (`../src/lib/ui-state.ts`).
private struct UIStatePut: Encodable {
  let key: String
  let value: String
}

extension APIClient {
  /// PUT /api/ui-state — `{ key, value }`; the value replaces the stored one.
  func putUIState(key: String, value: String) async throws(APIError) {
    _ = try await send(
      "PUT", "api/ui-state", body: encode(UIStatePut(key: key, value: value)), timeout: 15)
  }
}
```

- [ ] **Step 4: Add `choose` and the read guard to `ProMode`**

Replace the whole body of `ios/BudgetPhone/Shared/ProMode.swift` with:

```swift
import Foundation
import Observation

/// The shared Normal / Pro setting, as useProMode.ts reads it: the
/// `pro-mode` key, else the legacy `analytics-mode` key, and only the string
/// "pro" means Pro. Until it has loaded — and whenever it cannot — the phone
/// behaves as Normal, so a Pro control never appears and then vanishes.
/// Settings → Mode changes it through `choose`. Unlike the web, the phone
/// never pushes the legacy value forward; the web does that migration.
@MainActor
@Observable
final class ProMode {
  static let key = "pro-mode"
  static let legacyKey = "analytics-mode"

  private(set) var isPro = false
  /// True after the first successful read or a choice — useProMode's
  /// `!loading`. Until then `isPro` is just the untrue-but-safe default, so
  /// callers that would otherwise show a Normal-mode-only hint should wait
  /// for this.
  private(set) var hasLoaded = false
  /// The last choice didn't reach the server. The choice still applies here;
  /// Settings → Mode shows a banner and clears this on dismiss.
  var saveFailed = false
  /// Bumped by every load and every choice, so a read that lands after a
  /// newer one — or after a choice — is dropped (useProMode's `chosen`).
  private var generation = 0
  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// resolveProMode.
  static func resolve(_ value: UIStateValue) -> Bool { value.string == "pro" }

  func load() async {
    guard let client = client() else { return }
    generation += 1
    let mine = generation
    do throws(APIError) {
      let stored = try await client.uiState(Self.key)
      let pro = stored.isStored ? Self.resolve(stored) : Self.resolve(try await client.uiState(Self.legacyKey))
      guard mine == generation else { return }
      isPro = pro
      hasLoaded = true
    } catch {
      // Keep whatever was last known; a failed read is not a mode change.
    }
  }

  /// useProMode's choose: applies at once, then saves.
  func choose(_ pro: Bool) async {
    generation += 1
    isPro = pro
    hasLoaded = true
    saveFailed = false
    guard let client = client() else { return }
    do throws(APIError) {
      try await client.putUIState(key: Self.key, value: pro ? "pro" : "normal")
    } catch {
      if error != .cancelled { saveFailed = true }
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run the test command.
Expected: every test passes, including the existing `TransactionsStoreTests` ProMode tests.

- [ ] **Step 6: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Networking/APIClient+Settings.swift BudgetPhone/Shared/ProMode.swift BudgetPhoneTests/SettingsModeTests.swift
git commit -m "Let the phone change the Normal/Pro mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `Theme` store

**Files:**
- Create: `ios/BudgetPhone/Shared/Theme.swift`
- Modify: `ios/BudgetPhoneTests/SettingsModeTests.swift` (add a `// MARK: Theme` block inside `SettingsModeTests`)

**Interfaces:**
- Consumes: `APIClient.putUIState(key:value:)`, `APIClient.uiState(_:) -> UIStateValue`, and the `SettingsModeTests` helpers (all from Task 1)
- Produces:
  - `Theme(client: @escaping @MainActor () -> APIClient?, defaults: UserDefaults = .standard)`
  - `Theme.Choice` (`.light`, `.dark`, `.system`; `String` raw values)
  - `Theme.choice`, `Theme.hasLoaded`, `Theme.saveFailed` (settable), `Theme.colorScheme: ColorScheme?`
  - `Theme.load() async`, `Theme.choose(_:) async`
  - `static Theme.resolve(_ value: UIStateValue) -> Choice`, `Theme.key = "theme"`, `Theme.cacheKey = "theme.cached"`

- [ ] **Step 1: Write the failing tests**

Add this inside `struct SettingsModeTests`, after the ProMode tests:

```swift
    // MARK: Theme

    /// A throwaway defaults suite, so the local copy never touches the app's.
    func freshDefaults() -> UserDefaults {
      let name = "SettingsModeTests.\(UUID().uuidString)"
      let defaults = UserDefaults(suiteName: name)!
      defaults.removePersistentDomain(forName: name)
      return defaults
    }

    @Test func resolveKeepsOnlyLightAndDark() throws {
      func value(_ json: String) throws -> UIStateValue {
        try JSONDecoder().decode(UIStateValue.self, from: Data(json.utf8))
      }
      #expect(Theme.resolve(try value(#"{"value":"light"}"#)) == .light)
      #expect(Theme.resolve(try value(#"{"value":"dark"}"#)) == .dark)
      #expect(Theme.resolve(try value(#"{"value":"system"}"#)) == .system)
      #expect(Theme.resolve(try value(#"{"value":null}"#)) == .system)
      #expect(Theme.resolve(try value(#"{"value":"sepia"}"#)) == .system)
      #expect(Theme.resolve(try value(#"{"value":{"odd":true}}"#)) == .system)
    }

    @Test func colorSchemeFollowsTheChoice() async throws {
      let c = client { _ in self.ok(#"{"ok":true}"#) }
      let theme = Theme(client: { c }, defaults: freshDefaults())
      #expect(theme.colorScheme == nil, "System leaves it to iOS")
      await theme.choose(.light)
      #expect(theme.colorScheme == .light)
      await theme.choose(.dark)
      #expect(theme.colorScheme == .dark)
    }

    @Test func choosingSendsExactlyTheKeyAndValueIncludingSystem() async throws {
      let c = client { _ in self.ok(#"{"ok":true}"#) }
      let theme = Theme(client: { c }, defaults: freshDefaults())
      await theme.choose(.system)
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.httpMethod == "PUT")
      #expect(request.url?.path() == "/api/ui-state")
      #expect(try json(request) == ["key": "theme", "value": "system"])
      #expect(theme.hasLoaded)
    }

    @Test func loadReadsTheThemeKey() async throws {
      let c = client { _ in self.ok(#"{"value":"dark"}"#) }
      let theme = Theme(client: { c }, defaults: freshDefaults())
      #expect(!theme.hasLoaded)
      await theme.load()
      #expect(theme.choice == .dark)
      #expect(theme.hasLoaded)
      #expect(TestData.query(of: try #require(StubURLProtocol.requests.first), "key") == "theme")
    }

    @Test func theLocalCopyStartsTheNextLaunchInTheRightScheme() async throws {
      let defaults = freshDefaults()
      var stored = #"{"value":"dark"}"#
      let c = client { r in r.httpMethod == "GET" ? self.ok(stored) : self.ok(#"{"ok":true}"#) }

      #expect(Theme(client: { c }, defaults: defaults).choice == .system, "nothing cached yet")

      await Theme(client: { c }, defaults: defaults).load()
      let next = Theme(client: { c }, defaults: defaults)
      #expect(next.choice == .dark, "a successful read is cached")
      #expect(!next.hasLoaded, "a cached value is not a read")

      await next.choose(.light)
      #expect(Theme(client: { c }, defaults: defaults).choice == .light, "a choice is cached")

      stored = #"{"value":null}"#
      await Theme(client: { c }, defaults: defaults).load()
      #expect(Theme(client: { c }, defaults: defaults).choice == .system)
    }

    @Test func aFailedThemeReadChangesNothing() async throws {
      let defaults = freshDefaults()
      defaults.set("dark", forKey: Theme.cacheKey)
      let c = client { _ in throw URLError(.timedOut) }
      let theme = Theme(client: { c }, defaults: defaults)
      await theme.load()
      #expect(theme.choice == .dark)
      #expect(!theme.hasLoaded)
    }

    @Test func aThemeChoiceMadeWhileAReadIsInFlightSurvivesIt() async throws {
      let c = client { r in
        if r.httpMethod == "GET" {
          Thread.sleep(forTimeInterval: 0.1)
          return self.ok(#"{"value":"dark"}"#)
        }
        return self.ok(#"{"ok":true}"#)
      }
      let theme = Theme(client: { c }, defaults: freshDefaults())
      let loading = Task { await theme.load() }
      try await Task.sleep(for: .milliseconds(20))
      await theme.choose(.light)
      await loading.value
      #expect(theme.choice == .light)
    }

    @Test func aFailedThemeSaveKeepsTheChoiceAndFlagsIt() async throws {
      var fail = true
      let c = client { _ in
        if fail { throw URLError(.cannotConnectToHost) }
        return self.ok(#"{"ok":true}"#)
      }
      let theme = Theme(client: { c }, defaults: freshDefaults())
      await theme.choose(.dark)
      #expect(theme.choice == .dark)
      #expect(theme.saveFailed)
      fail = false
      await theme.choose(.light)
      #expect(!theme.saveFailed)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the test command.
Expected: a compile failure saying it cannot find `Theme` in scope.

- [ ] **Step 3: Implement `Theme`**

Create `ios/BudgetPhone/Shared/Theme.swift`:

```swift
import Observation
import SwiftUI

/// The shared Light / Dark / System setting, as useTheme.ts keeps it: the
/// `theme` key in the ui-state store, shared with every browser. On the phone
/// Light and Dark force the app's color scheme and System follows iOS.
///
/// The last known choice is also kept on the phone, so the app launches in
/// the right scheme before the server answers. This is the web's
/// localStorage copy. The server's value wins once it is read.
@MainActor
@Observable
final class Theme {
  enum Choice: String, CaseIterable, Sendable {
    case light, dark, system
  }

  static let key = "theme"
  static let cacheKey = "theme.cached"

  private(set) var choice: Choice
  /// True after the first successful read or a choice. Until then Settings
  /// shows no checkmark (useTheme's `loading`).
  private(set) var hasLoaded = false
  /// The last choice didn't reach the server. The choice still applies here;
  /// Settings → Mode shows a banner and clears this on dismiss.
  var saveFailed = false
  /// Bumped by every load and every choice, so a read that lands after a
  /// newer one — or after a choice — is dropped (useTheme's `chosen`).
  private var generation = 0
  private let client: @MainActor () -> APIClient?
  private let defaults: UserDefaults

  init(client: @escaping @MainActor () -> APIClient?, defaults: UserDefaults = .standard) {
    self.client = client
    self.defaults = defaults
    choice = defaults.string(forKey: Self.cacheKey).flatMap(Choice.init(rawValue:)) ?? .system
  }

  /// resolveTheme in ../src/lib/theme.ts: anything but "light" or "dark",
  /// including nothing stored, is System.
  static func resolve(_ value: UIStateValue) -> Choice {
    switch value.string {
    case "light": .light
    case "dark": .dark
    default: .system
    }
  }

  /// themeAttribute in ../src/lib/theme.ts: nil lets iOS decide.
  var colorScheme: ColorScheme? {
    switch choice {
    case .light: .light
    case .dark: .dark
    case .system: nil
    }
  }

  func load() async {
    guard let client = client() else { return }
    generation += 1
    let mine = generation
    do throws(APIError) {
      let stored = try await client.uiState(Self.key)
      guard mine == generation else { return }
      apply(Self.resolve(stored))
    } catch {
      // Keep whatever was last known; a failed read is not a theme change.
    }
  }

  /// useTheme's choose: applies at once, then saves. "system" is stored too.
  func choose(_ next: Choice) async {
    generation += 1
    apply(next)
    saveFailed = false
    guard let client = client() else { return }
    do throws(APIError) {
      try await client.putUIState(key: Self.key, value: next.rawValue)
    } catch {
      if error != .cancelled { saveFailed = true }
    }
  }

  private func apply(_ next: Choice) {
    choice = next
    hasLoaded = true
    defaults.set(next.rawValue, forKey: Self.cacheKey)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the test command. Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Shared/Theme.swift BudgetPhoneTests/SettingsModeTests.swift
git commit -m "Add the shared Light/Dark/System theme store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wire it up: `RootView`, `TransactionsView`, `SettingsView`, `ModeSettingsView`

**Files:**
- Modify: `ios/BudgetPhone/App/RootView.swift`
- Modify: `ios/BudgetPhone/Transactions/TransactionsView.swift` (the `proMode` `@State` and its two loads)
- Modify: `ios/BudgetPhone/Settings/SettingsView.swift`
- Create: `ios/BudgetPhone/Settings/ModeSettingsView.swift`

**Interfaces:**
- Consumes: `ProMode` (with `choose`, `saveFailed`, `hasLoaded`, `isPro`) and `Theme` (with `choice`, `choose`, `saveFailed`, `hasLoaded`, `colorScheme`) from Tasks 1 and 2
- Produces: `TransactionsView(proMode: ProMode)`, `SettingsView(proMode: ProMode, theme: Theme)`, `ModeSettingsView(proMode: ProMode, theme: Theme)`

There are no unit tests for the views, which follows the repo's pattern. The existing suite must still pass, and the check at the end is visual.

- [ ] **Step 1: Hand `ProMode` to `TransactionsView` instead of creating it there**

In `ios/BudgetPhone/Transactions/TransactionsView.swift`:
- Replace `@State private var proMode = ProMode(client: Self.client)` with `let proMode: ProMode`.
- In `.task`, delete the line `await proMode.load()`.
- In the `.onChange(of: scenePhase)` `Task`, delete `await proMode.load()`.
- Change the comment above `.onChange` to `// Another device may have changed categories meanwhile.`

- [ ] **Step 2: Create `ModeSettingsView`**

Create `ios/BudgetPhone/Settings/ModeSettingsView.swift`:

```swift
import SwiftUI

/// Settings → Mode: the web's SettingsMode.tsx. Normal / Pro, then
/// Light / Dark / System, both shared with the web through ui-state.
struct ModeSettingsView: View {
  let proMode: ProMode
  let theme: Theme

  private struct Option<Value: Hashable>: Identifiable {
    let value: Value
    let label: String
    let blurb: String
    var id: Value { value }
  }

  // MODES and THEMES in ../src/components/SettingsMode.tsx, word for word.
  private static let modes: [Option<Bool>] = [
    Option(
      value: false, label: "Normal",
      blurb: "Summary cards, spending by category, and the monthly trend."),
    Option(
      value: true, label: "Pro",
      blurb:
        "Everything in Normal, plus the income and tax organizer, the cash-flow diagram, the cumulative spending graph, the flight comparison under Benefits, and splitting one payment across categories in the ledger."
    ),
  ]
  private static let themes: [Option<Theme.Choice>] = [
    Option(value: .light, label: "Light", blurb: "Always the paper palette."),
    Option(value: .dark, label: "Dark", blurb: "Always the terminal palette."),
    Option(
      value: .system, label: "System",
      blurb: "Follow whatever this device is set to, and change with it."),
  ]

  /// Where the phone differs from the web on purpose: the web keeps a failed
  /// save in one browser's localStorage, but the phone's next read would
  /// quietly undo it, so say so.
  static let saveFailed = "Couldn't save to the server. Other devices keep the old setting."

  var body: some View {
    Form {
      Section("Mode") {
        ForEach(Self.modes) { option in
          ChoiceRow(
            label: option.label, blurb: option.blurb,
            isCurrent: proMode.hasLoaded && proMode.isPro == option.value
          ) {
            Task { await proMode.choose(option.value) }
          }
        }
      }
      Section {
        ForEach(Self.themes) { option in
          ChoiceRow(
            label: option.label, blurb: option.blurb,
            isCurrent: theme.hasLoaded && theme.choice == option.value
          ) {
            Task { await theme.choose(option.value) }
          }
        }
      } header: {
        Text("Appearance")
      } footer: {
        Text("This follows you between browsers, like the rest of your settings.")
      }
    }
    .safeAreaInset(edge: .top) {
      if proMode.saveFailed || theme.saveFailed {
        Banner(text: Self.saveFailed) {
          proMode.saveFailed = false
          theme.saveFailed = false
        }
      }
    }
    .navigationTitle("Mode")
    .navigationSubtitle("How much detail the app shows, and how it looks.")
  }
}

/// One choice: its label and the web's blurb, with a checkmark when current.
private struct ChoiceRow: View {
  let label: String
  let blurb: String
  let isCurrent: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(label).foregroundStyle(.primary)
          Text(blurb).font(.footnote).foregroundStyle(.secondary)
        }
        Spacer(minLength: 8)
        if isCurrent {
          Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(.tint)
        }
      }
      .contentShape(.rect)
    }
    .accessibilityAddTraits(isCurrent ? .isSelected : [])
  }
}
```

- [ ] **Step 3: Link Mode from `SettingsView`**

Replace the contents of `ios/BudgetPhone/Settings/SettingsView.swift` with:

```swift
import SwiftUI

struct SettingsView: View {
  let proMode: ProMode
  let theme: Theme

  private var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
  }

  var body: some View {
    NavigationStack {
      Form {
        // The web's Settings sections. Categories, Rules and Connections
        // join Mode here as they are ported.
        Section {
          NavigationLink("Mode") { ModeSettingsView(proMode: proMode, theme: theme) }
        }
        ServerForm()
        Section("About") {
          LabeledContent("Version", value: version)
        }
      }
      .navigationTitle("Settings")
    }
  }
}
```

- [ ] **Step 4: Own both stores in `RootView` and apply the theme**

Replace the contents of `ios/BudgetPhone/App/RootView.swift` with:

```swift
import SwiftUI

/// First launch asks for the server; after that, the tabs. Owns the two
/// app-wide settings, so the ledger and Settings → Mode share one copy, and
/// applies the shared theme to everything, the setup screen included.
struct RootView: View {
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @Environment(\.scenePhase) private var scenePhase
  @State private var proMode = ProMode(client: Self.client)
  @State private var theme = Theme(client: Self.client)

  static func client() -> APIClient? { ServerAddress.saved().map { APIClient(baseURL: $0) } }

  var body: some View {
    Group {
      if ServerAddress.normalize(server) == nil {
        ServerSetupView()
      } else {
        TabView {
          Tab("Accounts", systemImage: "building.columns") {
            AccountsView()
          }
          Tab("Transactions", systemImage: "list.bullet.rectangle") {
            TransactionsView(proMode: proMode)
          }
          Tab("Settings", systemImage: "gear") {
            SettingsView(proMode: proMode, theme: theme)
          }
        }
      }
    }
    .preferredColorScheme(theme.colorScheme)
    // Re-read when the server changes, too: a new server has its own settings.
    .task(id: server) { await loadSettings() }
    // Another device may have changed either setting meanwhile.
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      Task { await loadSettings() }
    }
  }

  private func loadSettings() async {
    await proMode.load()
    await theme.load()
  }
}
```

- [ ] **Step 5: Build and run the full suite**

Run the test command.
Expected: it builds and every test passes. If `.navigationSubtitle` fails to compile, check the iOS 26 SDK spelling. The API is `navigationSubtitle(_:)`. Do not drop the subtitle.

- [ ] **Step 6: Look at it in the simulator (GET only)**

Build, launch on the iPhone 17 Pro simulator, and open Settings → Mode. Take screenshots in both light and dark mode, and at an accessibility text size. **Don't tap any Mode or Appearance row.** A tap sends a PUT to the live server.
Check:
- The wording matches `SettingsMode.tsx`.
- The checkmarks match the server's current values once loaded.
- The blurbs wrap and don't truncate.

- [ ] **Step 7: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/App/RootView.swift BudgetPhone/Transactions/TransactionsView.swift BudgetPhone/Settings/SettingsView.swift BudgetPhone/Settings/ModeSettingsView.swift
git commit -m "Add Settings → Mode to the iPhone app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
