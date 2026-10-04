# iPhone app — working rules

Native SwiftUI client for the Budget web app in the parent folder. It has no
backend of its own: every screen calls the web app's HTTP API (`../src/app/api`).
Human setup (simulator, signing, device) is in `README.md`; designs and plans
are in `../docs/superpowers/specs/` and `../docs/superpowers/plans/`
(`*-ios-*`).

## Build and test

Run from this folder:

```bash
xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet
```

- Target: iOS 26, iPhone only, Swift 6. Default actor isolation is
  nonisolated; stores are `@MainActor @Observable` explicitly.
- Simulator: iPhone 17 Pro (402×874 pt, the same screen as the 16 Pro).
- Also run `bash ../scripts/test-scrub.sh` before committing. It scans this
  folder too.

## Project file

- Never edit `BudgetPhone.xcodeproj/project.pbxproj`. The app and test
  targets use folder-synchronized groups: a file under `BudgetPhone/` joins
  the app, a file under `BudgetPhoneTests/` joins the tests (non-Swift files
  there become test resources).
- Signing lives in `Config/Local.xcconfig` (gitignored). Never set a team in
  Xcode's Signing UI. It writes `DEVELOPMENT_TEAM` into the tracked project,
  and the scrub check fails on it.
- `build/` and `xcuserdata/` are gitignored; never commit them.

## Code layout

| Folder | What goes there |
|---|---|
| `Networking/` | `APIClient` (`send` / `encode` / `decode`, typed `APIError`) plus one `APIClient+<Screen>.swift` extension per screen |
| `Models/` | Codable mirrors of `../src/types/index.ts`; property names equal the JSON keys |
| `Support/` | Formatters and ports of web helpers (`LedgerRules.swift`) |
| `Shared/` | Cross-screen pieces: `Banner`, `Notice`, `ProMode` |
| `Accounts/`, `Transactions/`, `Analytics/`, `Subscriptions/`, `Benefits/`, `Settings/` | One folder per screen: its store and its views |
| `BudgetPhoneTests/` | Swift Testing suites; `TestSupport.swift` has fixtures and `StubURLProtocol` |

## Rules that are easy to break

- **Match the web.** Wording, order and rules copy the web app. Each port
  names its web source in a comment (e.g. `formatSignedAmount` in
  `../src/lib/format.ts`); read that source before changing a port. Where
  the phone deliberately differs, the spec says so.
- **Writes send only what changed**, in exactly the body the route expects.
  Every request body has a test asserting its JSON.
- **Store failure rules:** with nothing loaded, an error is full-screen.
  With data showing, it becomes a banner and the data stays. A successful
  load clears the banner. A user action (refresh, sync, import) clears a
  stale banner before its network call. `.cancelled` is always silent.
  Overlapping loads are guarded by a generation counter.
- **Refresh is pull-to-refresh**, not a toolbar button. On Accounts it
  refreshes balances from Plaid; on the Ledger it runs Sync.
- **Segmented tabs** (Transactions: Ledger / Venmo / Zelle; Benefits:
  Cards / Best card): the bar has one item, `SwitcherBar`: the switcher
  centred and at most one trailing button per segment, drawn by the tab
  (not a segment's own `.toolbar`) with `barGlass`, so it fades on a switch.
  Grouped grey background in every state (fill the screen first: a bare
  ProgressView is only spinner-sized). The ledger search field is a custom
  glass field at the bottom, just above AppTabBar, not `.searchable` (the
  system's bottom search sits behind the custom tab bar).
- **Accessibility sizes:** at `dynamicTypeSize.isAccessibilitySize`, stack
  label/amount pairs vertically; amounts never wrap mid-number.
- **Test isolation:** any suite using `StubURLProtocol` must nest under the
  `.serialized` parent suite `StubbedNetworkTests`
  (`extension StubbedNetworkTests { @Suite(.serialized) … }`). Otherwise
  two stubbed suites run in parallel and answer each other's requests.
- **Typed throws in closures:** inside `Task { }` write
  `do throws(APIError) { … }`. Closures passed around lose their error type;
  route writes through an enum instead (see `TransactionDetailView.Write`).
  Don't pass an `@MainActor @Sendable` closure into `Binding(set:)`. It
  crashed the Swift 6.2 compiler.

## The live server holds real money data

A running Budget server (usually `http://localhost:3000`, which the
simulator can reach) serves the owner's real accounts.

- Agents may only send it **GET** requests. Never change a category, link,
  split or account; never import; never pull-to-refresh on Accounts or the
  Ledger (those call Plaid). To see a pull's UI, use a scratch build whose
  refresh only reloads.
- Test writes against `StubURLProtocol`, not the server. Leave write checks
  on the simulator to the owner.

## Public repo

This repo is published. Nothing from the live server goes into code,
comments, docs, fixtures or commit messages: no real names, merchants,
institutions, card names or masks, amounts, or transaction counts. Use
invented values (`Sample Mart`, `Example Bank`, `Sample Rewards Card ··0002`).
The scrub check cannot catch these, so check your own diff for them.
