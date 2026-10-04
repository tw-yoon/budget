# iPhone Shrinking Tab Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrolling down any screen shrinks the tab bar (labels gone, bar and icons a little smaller, all five tabs still visible and tappable). Scrolling up brings the full bar back.

**Architecture:**
- Task 1: a pure `TabBarScrollRule` decides shrink / full / no change from one scroll view's offsets.
- Task 2: the app draws its own glass `AppTabBar` over Apple's `TabView`, whose bar is hidden. Nothing shrinks yet.
- Task 3: a `.tabBarScrollTracking()` modifier feeds every tab screen's scroll view into the rule and writes the shared `TabBarState`.

**Tech Stack:** Swift 6, SwiftUI (iOS 26: `glassEffect`, `onScrollGeometryChange`, `Tab(value:)`), Swift Testing.

**Spec:** `docs/superpowers/specs/2026-10-01-ios-tab-bar-design.md`

## Global Constraints

- Work in `ios/` on branch `ios-custom-tab-bar`. Read `ios/CLAUDE.md` first. It is binding.
- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. Files under `BudgetPhone/` and `BudgetPhoneTests/` join their targets automatically.
- Test command, run from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Run `bash ../scripts/test-scrub.sh` before every commit.
- Target iOS 26, iPhone only. The default actor isolation is nonisolated. SwiftUI views are `@MainActor` through `View`.
- **The live server holds real money data.** Implementers never run the app or touch the simulator. The controller does the simulator checks listed after Tasks 2 and 3, scrolling only, and never pulls to refresh on Accounts or the Ledger.
- Tab titles and symbols stay exactly: Accounts `building.columns`, Activity `list.bullet.rectangle`, Analytics `chart.pie`, Benefits `creditcard`, Settings `gear`.
- Tapping a tab switches to it at once, shrunk or not. Tapping the selected tab does nothing.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The scroll rule

**Files:**
- Create: `ios/BudgetPhone/Shared/TabBarScroll.swift`
- Test: `ios/BudgetPhoneTests/TabBarScrollRuleTests.swift`

**Interfaces (produces):**
- `struct TabBarScrollRule` with `static let shrinkDistance: CGFloat`, `static let expandDistance: CGFloat`, `static let topZone: CGFloat`, and `mutating func update(offset: CGFloat, maxOffset: CGFloat) -> Bool?` (`true` = shrink, `false` = full, `nil` = no change).
- `struct TabBarScrollOffsets: Equatable` with `var offset: CGFloat`, `var maxOffset: CGFloat`, `init(offset:maxOffset:)` and `init(_ geometry: ScrollGeometry)`.

- [ ] **Step 1: Write the failing tests**

Create `ios/BudgetPhoneTests/TabBarScrollRuleTests.swift`:

```swift
import SwiftUI
import Testing
@testable import BudgetPhone

struct TabBarScrollRuleTests {
  let shrink = TabBarScrollRule.shrinkDistance
  let expand = TabBarScrollRule.expandDistance

  /// Feeds the offsets to one rule in order and returns each answer.
  func run(_ offsets: [CGFloat], maxOffset: CGFloat = 2000) -> [Bool?] {
    var rule = TabBarScrollRule()
    return offsets.map { rule.update(offset: $0, maxOffset: maxOffset) }
  }

  @Test func fullAtTheTop() {
    #expect(run([0]) == [false])
    #expect(run([300, 0]) == [nil, false])
  }

  @Test func theFirstOffsetAwayFromTheTopOnlyRecords() {
    #expect(run([300]) == [nil])
  }

  @Test func shrinksOnlyOnceDownPastTheThreshold() {
    #expect(run([100, 100 + shrink - 1, 100 + shrink]) == [nil, nil, true])
  }

  @Test func comesBackOnceUpPastTheThreshold() {
    let low = 100 + shrink
    #expect(run([100, low, low - expand + 1, low - expand]) == [nil, true, nil, false])
  }

  @Test func aDirectionChangeReanchors() {
    let a = 100 + shrink - 1  // down, not far enough
    let b = a - (expand - 1)  // up, not far enough
    let c = b + shrink - 1    // down again: past the threshold from 100, not from b
    #expect(c - 100 >= shrink)  // otherwise this case proves nothing
    #expect(run([100, a, b, c, b + shrink]) == [nil, nil, nil, nil, true])
  }

  @Test func theBounceAtTheBottomIsNotAnUpwardScroll() {
    let end: CGFloat = 1000
    // Shrunk near the bottom, then rubber-banding past the end and settling.
    let answers = run([900, 900 + shrink, end + 60, end + 20, end], maxOffset: end)
    #expect(answers[1] == true)
    #expect(!answers.contains(false))
  }

  @Test func aPullPastTheTopKeepsItFull() {
    #expect(run([-80, -20, 0]) == [false, false, false])
  }

  @Test func aPageTooShortToScrollNeverShrinks() {
    #expect(run([0, 30, 60, 90], maxOffset: 0) == [false, false, false, false])
  }

  @Test func offsetsCountFromTheTopOfTheContent() {
    // At rest at the top, UIKit reports contentOffset.y == -contentInsets.top.
    let geometry = ScrollGeometry(
      contentOffset: CGPoint(x: 0, y: 150), contentSize: CGSize(width: 402, height: 3000),
      contentInsets: EdgeInsets(top: 100, leading: 0, bottom: 34, trailing: 0),
      containerSize: CGSize(width: 402, height: 874))
    #expect(TabBarScrollOffsets(geometry) == TabBarScrollOffsets(offset: 250, maxOffset: 3000 + 100 + 34 - 874))
  }

  @Test func shortContentHasNoRoomToScroll() {
    let geometry = ScrollGeometry(
      contentOffset: CGPoint(x: 0, y: -100), contentSize: CGSize(width: 402, height: 300),
      contentInsets: EdgeInsets(top: 100, leading: 0, bottom: 34, trailing: 0),
      containerSize: CGSize(width: 402, height: 874))
    #expect(TabBarScrollOffsets(geometry) == TabBarScrollOffsets(offset: 0, maxOffset: 0))
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the test command. Expected: build failure, `cannot find 'TabBarScrollRule' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/BudgetPhone/Shared/TabBarScroll.swift`:

```swift
import SwiftUI

/// Decides when the tab bar shrinks, from one scroll view's position. Plain
/// arithmetic, so it is unit tested; each tracked scroll view keeps its own
/// copy.
struct TabBarScrollRule {
  /// Scrolling down this far from where the downward run began shrinks the bar.
  static let shrinkDistance: CGFloat = 24
  /// Scrolling up this far from where the upward run began brings it back.
  static let expandDistance: CGFloat = 8
  /// Within this distance of the top, the page counts as at the top.
  static let topZone: CGFloat = 1

  private var last: CGFloat?
  private var anchor: CGFloat = 0
  private var movingDown = true

  /// `offset` is the distance scrolled from the top (negative while pulling
  /// down), `maxOffset` the largest resting offset. Returns `true` to shrink
  /// the bar, `false` to show it full, `nil` to leave it as it is.
  mutating func update(offset: CGFloat, maxOffset: CGFloat) -> Bool? {
    // Rubber-banding past either end reads as no movement: the bounce at the
    // bottom is not an upward scroll, a pull-to-refresh not a downward one.
    let y = min(max(offset, 0), max(maxOffset, 0))
    defer { self.last = y }
    if y <= Self.topZone {
      anchor = y
      movingDown = true
      return false
    }
    guard let last else {
      anchor = y
      return nil
    }
    guard y != last else { return nil }
    let down = y > last
    if down != movingDown {
      movingDown = down
      anchor = last
    }
    if down && y - anchor >= Self.shrinkDistance { return true }
    if !down && anchor - y >= Self.expandDistance { return false }
    return nil
  }
}

/// What `TabBarScrollRule` reads from a scroll view.
struct TabBarScrollOffsets: Equatable {
  var offset: CGFloat
  var maxOffset: CGFloat

  init(offset: CGFloat, maxOffset: CGFloat) {
    self.offset = offset
    self.maxOffset = maxOffset
  }

  /// UIKit puts the top of the content at `-contentInsets.top`; this counts
  /// from there, so 0 is at rest at the top.
  init(_ geometry: ScrollGeometry) {
    let insets = geometry.contentInsets
    offset = geometry.contentOffset.y + insets.top
    maxOffset = max(0, geometry.contentSize.height + insets.top + insets.bottom - geometry.containerSize.height)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the test command. Expected: all tests pass, including the ten new ones.

- [ ] **Step 5: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Shared/TabBarScroll.swift BudgetPhoneTests/TabBarScrollRuleTests.swift
git commit -m "Add the rule for when the iPhone tab bar shrinks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The app's own tab bar

**Files:**
- Create: `ios/BudgetPhone/Shared/AppTab.swift`
- Create: `ios/BudgetPhone/Shared/AppTabBar.swift`
- Modify: `ios/BudgetPhone/Shared/TabBarScroll.swift` (append `TabBarState`)
- Modify: `ios/BudgetPhone/App/RootView.swift` (the `TabView` block, lines 25–46 today)
- Test: `ios/BudgetPhoneTests/AppTabBarTests.swift`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `enum AppTab: CaseIterable, Hashable` with `.accounts, .activity, .analytics, .benefits, .settings`, plus `var title: String` and `var systemImage: String`.
  - `@MainActor @Observable final class TabBarState { var isCompact: Bool }`, put in the environment by `RootView`.
  - `struct AppTabBar: View` with `init(selection: Binding<AppTab>, isCompact: Bool)`, `enum Metrics`, and `nonisolated static func contentInset(bottomSafeArea: CGFloat) -> CGFloat`.

- [ ] **Step 1: Write the failing tests**

Create `ios/BudgetPhoneTests/AppTabBarTests.swift`:

```swift
import CoreGraphics
import Testing
@testable import BudgetPhone

@MainActor
struct AppTabBarTests {
  @Test func tabsKeepTheirOrderTitlesAndSymbols() {
    #expect(AppTab.allCases.map(\.title) == ["Accounts", "Activity", "Analytics", "Benefits", "Settings"])
    #expect(
      AppTab.allCases.map(\.systemImage)
        == ["building.columns", "list.bullet.rectangle", "chart.pie", "creditcard", "gear"])
  }

  @Test func contentClearsTheFullBar() {
    let m = AppTabBar.Metrics.self
    let barTop = m.bottomGap + m.fullHeight + m.clearance
    // Above the home indicator, the inset adds what the safe area lacks…
    #expect(AppTabBar.contentInset(bottomSafeArea: 34) == barTop - 34)
    // …and on a phone without one, all of it.
    #expect(AppTabBar.contentInset(bottomSafeArea: 0) == barTop)
  }

  @Test func noExtraInsetWhileTheKeyboardIsUp() {
    // The bar sits behind the keyboard, so nothing needs to clear it.
    #expect(AppTabBar.contentInset(bottomSafeArea: 336) == 0)
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the test command. Expected: build failure, `cannot find 'AppTab' in scope`.

- [ ] **Step 3: Create `AppTab`**

Create `ios/BudgetPhone/Shared/AppTab.swift`:

```swift
/// The five tabs, in the bar's order.
enum AppTab: CaseIterable, Hashable {
  case accounts, activity, analytics, benefits, settings

  var title: String {
    switch self {
    case .accounts: "Accounts"
    // "Activity", not "Transactions": the long label made the tab bar uneven.
    case .activity: "Activity"
    case .analytics: "Analytics"
    case .benefits: "Benefits"
    case .settings: "Settings"
    }
  }

  var systemImage: String {
    switch self {
    case .accounts: "building.columns"
    case .activity: "list.bullet.rectangle"
    case .analytics: "chart.pie"
    case .benefits: "creditcard"
    case .settings: "gear"
    }
  }
}
```

- [ ] **Step 4: Add `TabBarState`**

Append to `ios/BudgetPhone/Shared/TabBarScroll.swift`:

```swift

/// Whether the tab bar is shrunk. RootView owns it; the bar reads it and
/// every tracked scroll view writes it.
@MainActor @Observable final class TabBarState {
  var isCompact = false
}
```

- [ ] **Step 5: Create `AppTabBar`**

Create `ios/BudgetPhone/Shared/AppTabBar.swift`:

```swift
import SwiftUI

/// The tab bar. The app draws its own because Apple's cannot shrink this
/// way: while a page scrolls down this one keeps all five tabs, dropping the
/// labels and getting a little smaller. Apple's bar is hidden (RootView).
struct AppTabBar: View {
  @Binding var selection: AppTab
  let isCompact: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  enum Metrics {
    static let fullHeight: CGFloat = 62
    static let compactHeight: CGFloat = 44
    /// Space at each side of the bar.
    static let fullMargin: CGFloat = 21
    static let compactMargin: CGFloat = 60
    /// From the bottom of the screen to the bottom of the bar.
    static let bottomGap: CGFloat = 21
    /// Between a list's last row and the top of the full bar.
    static let clearance: CGFloat = 8
    static let fullIcon: CGFloat = 21
    static let compactIcon: CGFloat = 17
  }

  /// Extra bottom inset for each tab's content, on top of its safe area, so
  /// a list's last row can scroll clear of the full bar. `bottomSafeArea` is
  /// the home indicator's height, or the keyboard's while it is up; the bar
  /// sits behind the keyboard, so then nothing extra is needed.
  nonisolated static func contentInset(bottomSafeArea: CGFloat) -> CGFloat {
    max(0, Metrics.bottomGap + Metrics.fullHeight + Metrics.clearance - bottomSafeArea)
  }

  var body: some View {
    ZStack {
      bar
        // With Reduce Motion, swap the whole bar with a fade instead of
        // resizing it.
        .id(reduceMotion ? isCompact : false)
        .transition(.opacity)
    }
    .animation(
      reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.35, bounce: 0.15),
      value: isCompact)
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(.isTabBar)
  }

  private var bar: some View {
    HStack(spacing: 0) {
      ForEach(AppTab.allCases, id: \.self) { item($0) }
    }
    .padding(.horizontal, 4)
    .frame(height: isCompact ? Metrics.compactHeight : Metrics.fullHeight)
    .glassEffect(.regular.interactive(), in: .capsule)
    .padding(.horizontal, isCompact ? Metrics.compactMargin : Metrics.fullMargin)
  }

  /// One tab. The button fills the bar's height, so a shrunk icon is still
  /// easy to hit; only the highlight is inset.
  private func item(_ tab: AppTab) -> some View {
    let selected = tab == selection
    return Button {
      selection = tab
    } label: {
      VStack(spacing: 2) {
        Image(systemName: tab.systemImage)
          .font(.system(size: isCompact ? Metrics.compactIcon : Metrics.fullIcon, weight: .medium))
        if !isCompact {
          // A fixed size, like Apple's tab labels; the large content viewer
          // covers big text sizes.
          Text(tab.title)
            .font(.system(size: 10, weight: .medium))
            .lineLimit(1)
        }
      }
      .foregroundStyle(selected ? Color.accentColor : Color.primary)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background {
        if selected {
          Capsule().fill(.quaternary).padding(.vertical, 4)
        }
      }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(tab.title)
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityShowsLargeContentViewer {
      Label(tab.title, systemImage: tab.systemImage)
    }
  }
}

#Preview("Full") {
  @Previewable @State var tab = AppTab.activity
  AppTabBar(selection: $tab, isCompact: false)
}

#Preview("Shrunk") {
  @Previewable @State var tab = AppTab.activity
  AppTabBar(selection: $tab, isCompact: true)
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run the test command. Expected: all tests pass.

- [ ] **Step 7: Rewire `RootView`**

In `ios/BudgetPhone/App/RootView.swift`:

1. Below `@State private var changes = DataChanges()`, add:

```swift
  @State private var selected = AppTab.accounts
  @State private var tabBar = TabBarState()
  /// The bottom safe area: the home indicator, or the keyboard while it is up.
  @State private var bottomSafeArea: CGFloat = 0
```

2. Replace the whole `TabView { … }` block in `body`, together with the `.tabBarMinimizeBehavior(.onScrollDown)` line and its two comment lines, with `tabs`. The `if` then reads:

```swift
      if ServerAddress.normalize(server) == nil {
        ServerSetupView()
      } else {
        tabs
      }
```

3. Add these two members after `body`:

```swift
  /// Apple's TabView still hosts the tabs, so each loads when first opened
  /// and keeps its own navigation, but its bar is hidden: AppTabBar replaces
  /// it.
  private var tabs: some View {
    TabView(selection: $selected) {
      ForEach(AppTab.allCases, id: \.self) { tab in
        Tab(tab.title, systemImage: tab.systemImage, value: tab) {
          page(tab)
            .toolbarVisibility(.hidden, for: .tabBar)
            .safeAreaInset(edge: .bottom, spacing: 0) {
              Color.clear.frame(height: AppTabBar.contentInset(bottomSafeArea: bottomSafeArea))
            }
        }
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.bottom } action: { bottomSafeArea = $0 }
    .overlay(alignment: .bottom) {
      AppTabBar(selection: $selected, isCompact: tabBar.isCompact)
        .padding(.bottom, AppTabBar.Metrics.bottomGap)
        // Measured from the bottom of the screen, and left behind the
        // keyboard rather than lifted by it, as Apple's bar is.
        .ignoresSafeArea(.all, edges: .bottom)
    }
    .environment(tabBar)
    .onChange(of: selected) { tabBar.isCompact = false }
  }

  @ViewBuilder private func page(_ tab: AppTab) -> some View {
    switch tab {
    case .accounts: AccountsView()
    case .activity: TransactionsView(proMode: proMode, catalog: catalog, changes: changes)
    case .analytics: AnalyticsView(proMode: proMode, changes: changes)
    case .benefits: BenefitsView()
    case .settings: SettingsView(proMode: proMode, catalog: catalog, changes: changes)
    }
  }
```

The `.task(id: server)` and `.onChange(of: scenePhase)` modifiers on the `Group` stay as they are.

- [ ] **Step 8: Build and run the tests**

Run the test command. Expected: build succeeds, all tests pass.

- [ ] **Step 9: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone/Shared/AppTab.swift BudgetPhone/Shared/AppTabBar.swift BudgetPhone/Shared/TabBarScroll.swift BudgetPhone/App/RootView.swift BudgetPhoneTests/AppTabBarTests.swift
git commit -m "Draw the iPhone tab bar in the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Controller checks on the simulator after Task 2** (scrolling and tapping only):

- One bar shows, ours. Apple's bar is gone on each tab root and on a pushed screen: open an account, then open Settings → Categories. If Apple's bar shows on a pushed screen, apply `.toolbarVisibility(.hidden, for: .tabBar)` to that screen too. If that also fails, stop and report back (spec: replacing `TabView` is a new decision).
- Tapping each icon switches tabs.
- The last row of Accounts scrolls clear of the bar.
- Tapping the Ledger's search field: the keyboard covers the bar, and the bar does not ride up.

---

### Task 3: Shrink on scroll

**Files:**
- Modify: `ios/BudgetPhone/Shared/TabBarScroll.swift` (append the modifier)
- Modify: the 15 screens listed in Step 2 (17 scroll containers)

**Interfaces:**
- Consumes: `TabBarScrollRule`, `TabBarScrollOffsets` (Task 1); `TabBarState` in the environment (Task 2).
- Produces: `extension View { func tabBarScrollTracking() -> some View }`.

- [ ] **Step 1: Add the modifier**

Append to `ios/BudgetPhone/Shared/TabBarScroll.swift`:

```swift

/// Reports this scroll view's movement to the tab bar, which shrinks while it
/// scrolls down. Put it on every List, Form and ScrollView shown inside a
/// tab. Sheets don't need it: they cover the bar.
struct TabBarScrollTracking: ViewModifier {
  /// Absent in previews and on the server setup screen; then it does nothing.
  @Environment(TabBarState.self) private var state: TabBarState?
  @State private var rule = TabBarScrollRule()

  func body(content: Content) -> some View {
    content.onScrollGeometryChange(for: TabBarScrollOffsets.self) { geometry in
      TabBarScrollOffsets(geometry)
    } action: { _, new in
      guard let state,
        let compact = rule.update(offset: new.offset, maxOffset: new.maxOffset),
        compact != state.isCompact
      else { return }
      state.isCompact = compact
    }
  }
}

extension View {
  /// See `TabBarScrollTracking`.
  func tabBarScrollTracking() -> some View {
    modifier(TabBarScrollTracking())
  }
}
```

- [ ] **Step 2: Track every scroll container inside a tab**

Insert `.tabBarScrollTracking()` as the first modifier after each container's closing brace, at the brace's indentation. Each row names the container's opening line and the line that follows its closing brace today. Where a file has two containers, edit by that context, not by line number:

| File | Container opens with | Next line after its closing `}` |
|---|---|---|
| `Accounts/AccountsView.swift` | `return List {` | `.listStyle(.insetGrouped)` |
| `Accounts/AccountEditView.swift` | `Form {` | `.navigationTitle(account.title)` |
| `Analytics/AnalyticsView.swift` | `ScrollView {` | `.refreshable {` |
| `Benefits/BestCardsView.swift` | `return List {` | `.listStyle(.insetGrouped)` |
| `Settings/SettingsView.swift` | `Form {` | `.safeAreaInset(edge: .top) {` |
| `Settings/CategoriesView.swift` | `List {` | `.listStyle(.insetGrouped)` |
| `Settings/CategoryDetailView.swift` | `Form {` | `.safeAreaInset(edge: .top) { CategoryMessages(store: store) }` |
| `Settings/ConnectionsView.swift` | `List {` | `.listStyle(.insetGrouped)` |
| `Settings/RuleDetailView.swift` | `Form {` | `.safeAreaInset(edge: .top) { RuleMessages(store: store) }` |
| `Settings/RulesView.swift` | `List {` | `.listStyle(.insetGrouped)` |
| `Subscriptions/SubscriptionsView.swift` | `List {` | `.listStyle(.insetGrouped)` |
| `Transactions/LedgerView.swift` | `ScrollView {` (empty state) | `.refreshable { await store.sync() }` |
| `Transactions/LedgerView.swift` | `List {` (in `list`) | `// Grouped, like the Venmo and Zelle lists, so switching segments keeps` |
| `Transactions/LinkPurchaseView.swift` | `Form {` | `.navigationTitle("Connect to a Purchase")` |
| `Transactions/P2PCategorizerView.swift` | `ScrollView {` (empty state) | `.refreshable { await store.load() }` |
| `Transactions/P2PCategorizerView.swift` | `List {` (in `list(_:)`) | `// Grouped like the Ledger, so the background stays the same grey when switching segments.` |
| `Transactions/TransactionDetailView.swift` | `Form {` | `.navigationTitle(t.title)` |

For example, `AccountsView.swift` ends up as:

```swift
    }
    .tabBarScrollTracking()
    .listStyle(.insetGrouped)
    .refreshable { await store.refresh() }
```

Leave the sheets (`LimitSheet`, `AddSplitSheet`, `AddRuleSheet`, `AddDebitCardSheet`, `AddSubscriptionSheet`) and `ServerSetupView` alone.

- [ ] **Step 3: Check the count**

Run from `ios/`:

```bash
grep -rn "\.tabBarScrollTracking()" BudgetPhone | wc -l
```

Expected: `17`.

- [ ] **Step 4: Build and run the tests**

Run the test command. Expected: build succeeds, all tests pass.

- [ ] **Step 5: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone
git commit -m "Shrink the iPhone tab bar while any tab scrolls down

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Controller checks on the simulator after Task 3** (scrolling and tapping only; never pull to refresh on Accounts or the Ledger):

- On each tab, scrolling down shrinks the bar and scrolling up brings it back. A pushed screen (an account, Settings → Categories) does the same.
- A shrunk bar switches tabs with one tap, and the new tab shows the full bar.
- The bounce at the bottom of the Ledger does not bring the bar back.
- Compare the full bar with the earlier screenshots of Apple's bar. Tune `AppTabBar.Metrics`, and the rule's thresholds if scrolling feels off. Commit any tuning separately.

---

### Task 4: Icons only, a Tab Bar Labels setting, and the final review's fixes

Added after the owner saw Tasks 1–3 running (spec: *Revision (2026-10-01)*). The bar shows icons only and shrinks by resizing alone. **Settings → Accessibility → Tab Bar Labels** adds labels and keeps the bar full size. The task also takes the final whole-branch review's fixes: a segment switch shows the full bar, hidden scroll views stop writing, the lower clamp gets a test, and RootView stops redrawing every tab on each shrink.

**Files:**
- Replace: `ios/BudgetPhone/Shared/AppTabBar.swift`
- Modify: `ios/BudgetPhone/App/RootView.swift`, `ios/BudgetPhone/Shared/TabBarScroll.swift` (the modifier only), `ios/BudgetPhone/Settings/SettingsView.swift`, `ios/BudgetPhone/Transactions/TransactionsView.swift`
- Test: `ios/BudgetPhoneTests/AppTabBarTests.swift` (replace), `ios/BudgetPhoneTests/TabBarScrollRuleTests.swift` (one new test)

**Interfaces:**
- Consumes: `AppTab`, `TabBarState`, `TabBarScrollRule`, `.tabBarScrollTracking()` (Tasks 1–3).
- Produces:
  - `AppTabBar.init(selection: Binding<AppTab>, isCompact: Bool, showsLabels: Bool)`
  - `static let labelsKey = "tabBar.labels"`
  - `nonisolated static func shrinks(isCompact: Bool, showsLabels: Bool) -> Bool`
  - `nonisolated static func contentInset(bottomSafeArea: CGFloat, showsLabels: Bool) -> CGFloat`
  - `Metrics.fullHeight` (52), `Metrics.labelledHeight` (62), `Metrics.compactHeight` (44)

- [ ] **Step 1: Write the failing tests**

Replace `ios/BudgetPhoneTests/AppTabBarTests.swift` with:

```swift
import CoreGraphics
import Testing
@testable import BudgetPhone

@MainActor
struct AppTabBarTests {
  @Test func tabsKeepTheirOrderTitlesAndSymbols() {
    #expect(AppTab.allCases.map(\.title) == ["Accounts", "Activity", "Analytics", "Benefits", "Settings"])
    #expect(
      AppTab.allCases.map(\.systemImage)
        == ["building.columns", "list.bullet.rectangle", "chart.pie", "creditcard", "gear"])
  }

  @Test(arguments: [false, true])
  func contentClearsTheFullBar(showsLabels: Bool) {
    let m = AppTabBar.Metrics.self
    let barTop = m.bottomGap + (showsLabels ? m.labelledHeight : m.fullHeight) + m.clearance
    // Above the home indicator, the inset adds what the safe area lacks…
    #expect(AppTabBar.contentInset(bottomSafeArea: 34, showsLabels: showsLabels) == barTop - 34)
    // …and on a phone without one, all of it.
    #expect(AppTabBar.contentInset(bottomSafeArea: 0, showsLabels: showsLabels) == barTop)
  }

  @Test func labelsNeedMoreRoom() {
    #expect(
      AppTabBar.contentInset(bottomSafeArea: 34, showsLabels: true)
        > AppTabBar.contentInset(bottomSafeArea: 34, showsLabels: false))
  }

  @Test(arguments: [false, true])
  func noExtraInsetWhileTheKeyboardIsUp(showsLabels: Bool) {
    // The bar sits behind the keyboard, so nothing needs to clear it.
    #expect(AppTabBar.contentInset(bottomSafeArea: 336, showsLabels: showsLabels) == 0)
  }

  @Test func shrinksOnlyWithoutLabels() {
    #expect(AppTabBar.shrinks(isCompact: true, showsLabels: false))
    #expect(!AppTabBar.shrinks(isCompact: true, showsLabels: true))
    #expect(!AppTabBar.shrinks(isCompact: false, showsLabels: false))
  }
}
```

In `ios/BudgetPhoneTests/TabBarScrollRuleTests.swift`, add after `aPageTooShortToScrollNeverShrinks`:

```swift
  @Test func aSmallStepAfterAPullDoesNotShrink() {
    // Without the lower clamp the pull would anchor at -80, and 5 pt down
    // would already count as 85.
    #expect(run([-80, 5]) == [false, nil])
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the test command. Expected: build failure, `extra argument 'showsLabels'` (or `type 'AppTabBar' has no member 'shrinks'`).

- [ ] **Step 3: Replace `AppTabBar`**

Replace `ios/BudgetPhone/Shared/AppTabBar.swift` with:

```swift
import SwiftUI

/// The tab bar. The app draws its own because Apple's cannot shrink this
/// way: while a page scrolls down this one keeps all five tabs and gets a
/// little smaller. Icons only; Settings → Accessibility → Tab Bar Labels adds
/// labels and keeps the bar full size. Apple's bar is hidden (RootView).
struct AppTabBar: View {
  @Binding var selection: AppTab
  let isCompact: Bool
  let showsLabels: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// The Tab Bar Labels setting, kept on this iPhone only.
  static let labelsKey = "tabBar.labels"

  enum Metrics {
    static let fullHeight: CGFloat = 52
    /// With Tab Bar Labels on.
    static let labelledHeight: CGFloat = 62
    static let compactHeight: CGFloat = 44
    /// Space at each side of the bar.
    static let fullMargin: CGFloat = 21
    static let compactMargin: CGFloat = 60
    /// From the bottom of the screen to the bottom of the bar.
    static let bottomGap: CGFloat = 21
    /// Between a list's last row and the top of the full bar.
    static let clearance: CGFloat = 8
    static let fullIcon: CGFloat = 21
    static let compactIcon: CGFloat = 17
    /// With labels, a fixed box for the icon, so every label starts at the
    /// same height whatever the symbol's own size.
    static let iconBox: CGFloat = 26
  }

  /// With labels on, the bar never shrinks.
  nonisolated static func shrinks(isCompact: Bool, showsLabels: Bool) -> Bool {
    isCompact && !showsLabels
  }

  /// Extra bottom inset for each tab's content, on top of its safe area, so
  /// a list's last row can scroll clear of the full bar. `bottomSafeArea` is
  /// the home indicator's height, or the keyboard's while it is up; the bar
  /// sits behind the keyboard, so then nothing extra is needed.
  nonisolated static func contentInset(bottomSafeArea: CGFloat, showsLabels: Bool) -> CGFloat {
    let height = showsLabels ? Metrics.labelledHeight : Metrics.fullHeight
    return max(0, Metrics.bottomGap + height + Metrics.clearance - bottomSafeArea)
  }

  private var shrunk: Bool { Self.shrinks(isCompact: isCompact, showsLabels: showsLabels) }

  private var height: CGFloat {
    if shrunk { return Metrics.compactHeight }
    return showsLabels ? Metrics.labelledHeight : Metrics.fullHeight
  }

  var body: some View {
    HStack(spacing: 0) {
      ForEach(AppTab.allCases, id: \.self) { item($0) }
    }
    .padding(.horizontal, 4)
    .frame(height: height)
    .glassEffect(.regular.interactive(), in: .capsule)
    .padding(.horizontal, shrunk ? Metrics.compactMargin : Metrics.fullMargin)
    // Only a resize: nothing fades. With Reduce Motion the size just changes.
    .animation(reduceMotion ? nil : .spring(duration: 0.35, bounce: 0.15), value: shrunk)
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(.isTabBar)
  }

  /// One tab. The button fills the bar's height, so a shrunk icon is still
  /// easy to hit; only the highlight is inset.
  private func item(_ tab: AppTab) -> some View {
    let selected = tab == selection
    return Button {
      selection = tab
    } label: {
      VStack(spacing: 2) {
        Image(systemName: tab.systemImage)
          .symbolVariant(.fill)
          .font(.system(size: shrunk ? Metrics.compactIcon : Metrics.fullIcon, weight: .medium))
          .frame(height: showsLabels ? Metrics.iconBox : nil)
        if showsLabels {
          // A fixed size, like Apple's tab labels; the large content viewer
          // covers big text sizes.
          Text(tab.title)
            .font(.system(size: 10, weight: .medium))
            .lineLimit(1)
            .accessibilityHidden(true)
        }
      }
      .foregroundStyle(selected ? Color.accentColor : Color.primary)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background {
        if selected {
          Capsule().fill(.quaternary).padding(.vertical, 4)
        }
      }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(tab.title)
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityShowsLargeContentViewer {
      Label(tab.title, systemImage: tab.systemImage)
        .symbolVariant(.fill)
    }
  }
}

#Preview("Icons") {
  @Previewable @State var tab = AppTab.activity
  AppTabBar(selection: $tab, isCompact: false, showsLabels: false)
}

#Preview("Shrunk") {
  @Previewable @State var tab = AppTab.activity
  AppTabBar(selection: $tab, isCompact: true, showsLabels: false)
}

#Preview("Labels") {
  @Previewable @State var tab = AppTab.activity
  AppTabBar(selection: $tab, isCompact: true, showsLabels: true)
}
```

- [ ] **Step 4: Wire `RootView`**

In `ios/BudgetPhone/App/RootView.swift`:

1. Below `@State private var bottomSafeArea: CGFloat = 0`, add:

```swift
  /// Settings → Accessibility → Tab Bar Labels.
  @AppStorage(AppTabBar.labelsKey) private var showsTabLabels = false
```

2. In `tabs`, change the inset line to:

```swift
              Color.clear.frame(
                height: AppTabBar.contentInset(bottomSafeArea: bottomSafeArea, showsLabels: showsTabLabels))
```

3. In the `.overlay`, replace `AppTabBar(selection: $selected, isCompact: tabBar.isCompact)` with `TabBarHost(selection: $selected, showsLabels: showsTabLabels)`. Keep its `.padding`, `.frame`, `.ignoresSafeArea` and the comment.

4. At the end of the file, after `RootView`'s closing brace, add:

```swift

/// Reads the shrink state itself, so a shrink redraws only the bar, not
/// every tab.
private struct TabBarHost: View {
  @Binding var selection: AppTab
  let showsLabels: Bool
  @Environment(TabBarState.self) private var state

  var body: some View {
    AppTabBar(selection: $selection, isCompact: state.isCompact, showsLabels: showsLabels)
  }
}
```

After this, `RootView.body` must not read `tabBar.isCompact` anywhere; the `.onChange(of: selected)` closure only writes it.

- [ ] **Step 5: Gate the scroll modifier on being on screen**

In `ios/BudgetPhone/Shared/TabBarScroll.swift`, change `TabBarScrollTracking` and its doc comment to:

```swift
/// Reports this scroll view's movement to the tab bar, which shrinks while it
/// scrolls down. Put it on every List, Form and ScrollView shown inside a
/// tab. Sheets don't need it: they cover the bar. A newly shown page starts
/// with a fresh rule and the full bar, and only a scroll view on screen
/// writes: not one in a hidden tab or under a pushed screen.
struct TabBarScrollTracking: ViewModifier {
  /// Absent in previews and on the server setup screen; then it does nothing.
  @Environment(TabBarState.self) private var state: TabBarState?
  @State private var rule = TabBarScrollRule()
  @State private var isOnScreen = false

  func body(content: Content) -> some View {
    content
      .onScrollGeometryChange(for: TabBarScrollOffsets.self) { geometry in
        TabBarScrollOffsets(geometry)
      } action: { _, new in
        guard isOnScreen, let state,
          let compact = rule.update(offset: new.offset, maxOffset: new.maxOffset),
          compact != state.isCompact
        else { return }
        state.isCompact = compact
      }
      .onAppear {
        isOnScreen = true
        rule = TabBarScrollRule()
        state?.isCompact = false
      }
      .onDisappear { isOnScreen = false }
  }
}
```

- [ ] **Step 6: Full bar on a segment switch**

In `ios/BudgetPhone/Transactions/TransactionsView.swift`:

1. Below `@Environment(\.scenePhase) private var scenePhase`, add:

```swift
  /// Absent in previews.
  @Environment(TabBarState.self) private var tabBar: TabBarState?
```

2. Directly above the existing `.onChange(of: scenePhase) { _, phase in`, add:

```swift
    // A segment still loading or showing an error has no scroll view to
    // bring the bar back, so switching does it.
    .onChange(of: segment) { tabBar?.isCompact = false }
```

- [ ] **Step 7: The setting**

In `ios/BudgetPhone/Settings/SettingsView.swift`:

1. Below `@State private var connections = ConnectionsStore(client: RootView.client)`, add:

```swift
  /// Kept on this iPhone only; the web has no tab bar.
  @AppStorage(AppTabBar.labelsKey) private var showsTabLabels = false
```

2. Directly above `ServerForm()` in the `Form`, add:

```swift
        Section("Accessibility") {
          Toggle("Tab Bar Labels", isOn: $showsTabLabels)
        }
```

- [ ] **Step 8: Build and run the tests**

Run the test command. Expected: build succeeds; all tests pass, including the new `AppTabBarTests` cases and `aSmallStepAfterAPullDoesNotShrink`.

- [ ] **Step 9: Commit**

```bash
bash ../scripts/test-scrub.sh
git add BudgetPhone BudgetPhoneTests
git commit -m "Show icons only in the iPhone tab bar, with a Tab Bar Labels setting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Controller checks on the simulator after Task 4** (scrolling, tapping, the Settings switch and the Ledger search field only):

- Icons only by default. Scrolling down shrinks the bar with no fading, and scrolling up brings it back.
- Settings → Accessibility → Tab Bar Labels on: labels show, and the bar stays full while scrolling. Turn it back off afterwards.
- Shrink on the Ledger, switch to Venmo: full bar.
- Keyboard: toggle the software keyboard (I/O → Keyboard → Toggle Software Keyboard), tap the Ledger search field. The keyboard covers the bar, and the bar does not ride up.
