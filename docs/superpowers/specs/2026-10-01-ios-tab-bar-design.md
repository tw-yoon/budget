# iPhone App — Shrinking Tab Bar Design

**Status:** Approved in chat 2026-10-01. Branch `ios-custom-tab-bar`, cut from `main`. Revised the same day after the owner saw it running: the bar shows icons only, and labels move to an accessibility setting (*Revision* below).

**Goal:** Scrolling down any screen shrinks the tab bar: the bar and its icons get a little smaller, and all five tabs stay visible and tappable. Scrolling up brings the full bar back, as Instagram does. The bar shows icons only; **Settings → Accessibility → Tab Bar Labels** adds labels and keeps the bar full size.

**Replaces:** `.tabBarMinimizeBehavior(.onScrollDown)` on `RootView`'s `TabView` (merged earlier the same day). Apple's minimize shrinks the bar to the current tab's icon at one side. It only does so on pages iOS judges long enough (in practice only the Ledger), and it does not come back on scroll up. None of that can be configured, so the phone draws its own bar.

**No server changes.** Nothing here touches the network.

---

## Revision (2026-10-01)

The first build faded the labels out while the bar shrank. The owner found the animation ugly and chose:

- **Icons only by default.** The labels never show, so shrinking is only a resize: nothing fades in or out.
- **Tab Bar Labels** switch in a new **Accessibility** section of Settings. On: labels under the icons, the bar stays full size, and it never shrinks or animates. Off by default. Kept on this iPhone only (`@AppStorage`), like hidden accounts; the web has no tab bar, so there is nothing to sync.
- **Reduce Motion:** the size changes instantly instead of animating.

Where the sections below still mention labels or a crossfade, this revision wins.

---

## Decisions already made

| Question | Decision |
|---|---|
| Whose bar | Our own, drawn over the content. Apple's `TabView` still hosts the five tabs, so each tab loads only when first opened and keeps its own navigation stack. Apple's bar is hidden. Replacing `TabView` with a hand-made page switcher was rejected: it would re-create that lifecycle for no gain. |
| Look | Apple's iOS 26 bar style: a Liquid Glass capsule (`.glassEffect`), five filled icons, and a highlight behind the selected tab. Labels only with the Tab Bar Labels setting. |
| Shrunk look | The bar gets shorter (52 → 44 pt) and narrower, and the icons a little smaller. All five tabs stay visible. With Tab Bar Labels on (62 pt), it never shrinks. |
| Tapping | Tapping any icon switches to that tab at once and always brings the full bar back, the selected tab included. Only the selected tab's pages may resize the bar, so a page left behind while still gliding cannot shrink it again. Switching keeps each tab where you left it. Tapping the tab already selected scrolls the page on screen to the top, as Instagram does (stopping any glide first); this goes through the UIKit scroll view, since SwiftUI's `ScrollPosition` moves a `ScrollView` but not a `List` or `Form`. |
| When it shrinks | After scrolling down a short distance on any screen inside a tab, pushed screens included. |
| When it comes back | On any upward scroll past a small threshold, at the top of the page, during pull-to-refresh, and on switching tabs. |
| Sheets | Cover the bar, as they cover Apple's. |
| Keyboard | The bar stays at the bottom, behind the keyboard, as Apple's does. It does not ride up with it. |
| Selected tab | Not remembered across launches, as today. |
| Landscape | No special handling: the same bar, stretched to the wider screen. |

---

## Project layout

New files (folder-synchronized groups; no project file edits):

| File | What it holds |
|---|---|
| `Shared/AppTab.swift` | `AppTab`, the five tabs in order with their titles and SF Symbols. |
| `Shared/AppTabBar.swift` | The bar view, full and shrunk. |
| `Shared/TabBarScroll.swift` | `TabBarState` (shared), `TabBarScrollRule` (the pure rule), and the `.tabBarScrollTracking()` modifier. |
| `BudgetPhoneTests/TabBarScrollRuleTests.swift` | Swift Testing suite for the rule. |
| `BudgetPhoneTests/AppTabBarTests.swift` | Tab order, the content inset in both modes, and the never-shrink-with-labels rule. |

Changed: `App/RootView.swift`, `Settings/SettingsView.swift` (the Accessibility section), `Transactions/TransactionsView.swift` (full bar on a segment switch), plus one modifier line on each scrolling screen inside a tab (listed under *Scroll tracking*).

## Tabs — `AppTab`

`enum AppTab: CaseIterable, Hashable` with `accounts`, `activity`, `analytics`, `benefits`, `settings`, in that order. Each case has a `title` and a `systemImage`, the same as today:

| Case | Title | Symbol |
|---|---|---|
| `accounts` | Accounts | `building.columns` |
| `activity` | Activity | `list.bullet.rectangle` |
| `analytics` | Analytics | `chart.pie` |
| `benefits` | Benefits | `creditcard` |
| `settings` | Settings | `gear` |

The comment explaining why the tab says "Activity", not "Transactions", moves here with it.

## Root — `RootView`

- `TabView(selection: $selected)` with `Tab(value:)` for each `AppTab`. `selected` is `@State`, starting at `.accounts`.
- Each tab's content gets `.toolbarVisibility(.hidden, for: .tabBar)`. It also gets a clear bottom `safeAreaInset`, tall enough that a list's last row can scroll clear of the full bar. The inset stays the full height while the bar is shrunk, so content never jumps.
- `AppTabBar` sits over the `TabView` in `.overlay(alignment: .bottom)`, padded `bottomGap` from the bottom, filling the overlay's height (`.frame(maxHeight: .infinity, alignment: .bottom)`) before `.ignoresSafeArea(.all, edges: .bottom)`, so it is measured from the screen's bottom edge and stays behind the keyboard. A small host view reads `TabBarState` itself, so a shrink redraws only the bar, not every tab.
- `RootView` owns one `TabBarState` and puts it in the environment for the scroll modifier.
- Changing `selected` sets `state.isCompact = false`. So does switching the Ledger / Venmo / Zelle segment (`TransactionsView`), which covers a segment that is still loading or showing an error and so has no scroll view.
- Reads the Tab Bar Labels setting (`@AppStorage(AppTabBar.labelsKey)`) and passes it to the bar and to the content inset.
- `.tabBarMinimizeBehavior(.onScrollDown)` is removed.

**Risk, checked first:** Apple's bar must stay hidden on screens pushed inside a tab. If `.toolbarVisibility(.hidden, for: .tabBar)` on the tab content does not hold there, apply it on each pushed screen as well. If that also fails, stop and report back; replacing `TabView` is a new decision.

## The bar — `AppTabBar`

Inputs: the selection binding, `isCompact`, and `showsLabels`. Contents: an `HStack` of five buttons inside one glass capsule. It shrinks only when `isCompact && !showsLabels`.

- **Full, icons only:** filled icons, height 52 pt. The bar's side margins match Apple's bar.
- **Full, with labels:** icon above a small fixed-size label (10 pt, not Dynamic Type, like Apple's), height 62 pt. Never shrinks.
- **Shrunk:** the whole bar scaled by 44/52 toward its bottom centre, so it is a smaller copy of the full bar: every icon moves in a straight line (the middle one straight down) and nothing re-lays out. Plain (not interactive) glass, which otherwise wobbles under a tap.
- **Selected tab:** tinted with the app's accent color, with a capsule highlight behind it, as Apple's bar has.
- **Animation:** no fixed animation while scrolling: the bar follows the finger (see *The rule*); after a drag stops part way, or on a reset, it finishes on a spring (`response: 0.5`, `dampingFraction: 0.86`) between the two sizes, so a reversed scroll turns the bar around mid-motion instead of restarting it. None with labels on, and none with Reduce Motion on: the size just changes.
- Each button is the full width of its slot and at least 44 pt tall, so a shrunk icon is still easy to hit.

**Accessibility**

- The bar is one container with the `.isTabBar` trait. Each button is labelled with its tab's title whether or not labels show, and the selected one carries `.isSelected`.
- `.accessibilityShowsLargeContentViewer()` on each button (with the filled icon), so a long press at large text sizes shows the icon and title, as Apple's bar does.

## Scroll state — `TabBarState`

`@MainActor @Observable final class TabBarState` holds `isCompact`, `selected` (the tab on screen; only its pages may write the bar state) and `scrollToTopRequests` (bumped by a tap on the selected tab). It is shared by the bar and every scroll modifier. RootView also sets an `appTab` environment value on each tab's content, so a page knows which tab it belongs to.

## The rule — `TabBarScrollRule`

A plain value type with no SwiftUI or UIKit, so it can be unit tested. Each tracked scroll view holds its own copy.

`mutating func update(offset: CGFloat, maxOffset: CGFloat) -> Bool?` takes:

- `offset`: distance scrolled from the top, 0 at rest at the top. Negative while pulling down.
- `maxOffset`: the largest resting offset (content height minus visible height, never below 0).

It returns `true` to shrink, `false` to show the full bar, or `nil` for no change.

1. Clamp `offset` to `0...maxOffset`. Rubber-banding past either end then reads as no movement: the bounce at the bottom of a list is not an upward scroll, and a pull-to-refresh is not a downward one.
2. At the top (clamped offset ≤ 1 pt): return `false`.
3. Otherwise compare with the previous clamped offset to get the direction. When the direction changes, the point where it changed becomes the anchor.
4. Moving down, once `offset − anchor ≥ 24 pt`: return `true`.
5. Moving up, once `anchor − offset ≥ 8 pt`: return `false`.
6. Otherwise return `nil`.

The first call only records the offset and returns `nil` unless at the top. The thresholds are named constants and can be tuned on the simulator. Tests pin the rule, not the exact numbers: they read the constants.

## Scroll tracking — `.tabBarScrollTracking()`

A `ViewModifier` that keeps a `TabBarScrollRule` in `@State` and reads `TabBarState` from the environment.

- It uses `onScrollGeometryChange` to take `offset = contentOffset.y + contentInsets.top` and `maxOffset = max(0, contentSize.height + contentInsets.top + contentInsets.bottom − containerSize.height)`.
- It passes them to the rule, and writes `isCompact` only when the result is non-nil and differs from the current value.
- With no `TabBarState` in the environment (previews, `ServerSetupView`), it does nothing.
- A `ScrollToTopProbe` behind each tracked scroll view scrolls it to the top when `scrollToTopRequests` changes, if it is on screen in the selected tab. It finds the UIKit scroll view (vertical, not a text view) and stops any glide first.
- When it appears it starts a fresh rule and shows the full bar: `onScrollGeometryChange` does not report a newly shown scroll view.
- It writes only while on screen (`onAppear` / `onDisappear`), so a list in a hidden tab or under a pushed screen cannot change the bar.

Applied to every `List`, `Form` and `ScrollView` on a screen shown inside a tab:

| Where | Screens |
|---|---|
| Tab roots | `AccountsView`, `LedgerView` (the list and the empty-state scroll view), `P2PCategorizerView` (the same two), `AnalyticsView`, `BestCardsView`, `SettingsView` |
| Pushed screens | `AccountEditView`, `TransactionDetailView`, `LinkPurchaseView`, `SubscriptionsView`, `CategoriesView`, `CategoryDetailView`, `RulesView`, `RuleDetailView`, `ConnectionsView` |

Sheets (`LimitSheet`, `AddSplitSheet`, `AddRuleSheet`, `AddDebitCardSheet`, `AddSubscriptionSheet`) and `ServerSetupView` are left alone: the bar is not visible there.

## Testing

**Unit tests (`TabBarScrollRuleTests`).** The rule touches no network, so the suite does not nest under `StubbedNetworkTests`. It covers:

- full at the top
- shrinks after scrolling down past the threshold, and not before
- comes back after scrolling up past the threshold
- direction changes re-anchor (down, up a little, down again)
- the bounce past the bottom does not bring the bar back
- a pull-down past the top keeps it full
- a page too short to scroll (`maxOffset == 0`) never shrinks
- a pull past the top followed by a small downward step does not shrink (the lower clamp)

**Unit tests (`AppTabBarTests`):** tab order, titles and symbols; the content inset clears the full bar in both modes and is 0 while the keyboard is up; the bar never shrinks with labels on.

**On the simulator (scrolling only; never pull-to-refresh on Accounts or the Ledger):**

- Every tab shrinks and comes back.
- Apple's bar stays hidden on a pushed screen.
- A shrunk bar switches tabs with one tap.
- The last row of a long list scrolls clear of the bar.
- The keyboard on the Ledger search covers the bar rather than lifting it (the Simulator's software keyboard: I/O → Keyboard → Toggle Software Keyboard).
- Tab Bar Labels on: labels show, the bar stays full while scrolling. Off: icons only, and it shrinks.

**Left to the owner:** a VoiceOver pass (tab names with and without labels, selected tab announced). Agents check the labels and traits in code review.

## Follow the finger (2026-10-02)

Replaces the shrink/expand thresholds above. `TabBarState.progress` (0 full, 1 shrunk) moves with the scroll: each point scrolled changes it by 1/140 (`TabBarScrollRule.travel`), clamped to 0...1, and it is 0 at the top. Offsets are clamped as before, so the bounce at the bottom and a pull-to-refresh do not move it. When scrolling comes to rest (`onScrollPhaseChange` → `.idle`) part way, the bar springs on in the direction it was last moving. Taps, tab and segment switches and a newly shown page call `TabBarState.expand()`, which springs to 0. The bar draws `scaleEffect(1 − (1 − 44/58) × smoothstep(progress))` toward its bottom centre: 58 pt tall full (23 pt icons), 44 pt shrunk, easing into either end. With labels on it stays full. With Reduce Motion on it still follows the finger (the finger drives it, as in Instagram); only the finish after a drag becomes a 0.15 s ease-out instead of the spring (`response: 0.5`, `dampingFraction: 0.86`).

**Suspension (2026-10-02):** every change to `progress` reaches the bar through one spring (`TabBarState.motion`: `response: 0.55`, `dampingFraction: 0.72`), so the bar trails the finger slightly and coasts into full or small with a little overshoot instead of stopping dead. The finish after a drag and `expand()` use the same spring. With Reduce Motion on, a 0.12 s ease-out with no overshoot.
