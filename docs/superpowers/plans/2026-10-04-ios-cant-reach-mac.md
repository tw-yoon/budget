# Friendly "can't reach your Mac" screen — plan

Spec: `docs/superpowers/specs/2026-10-04-ios-cant-reach-mac-design.md` (read it first).
Branch `ios-cant-reach-mac`, in its own worktree. Builds on the saved data
from `2026-10-04-ios-instant-launch-design.md` (already merged).

## Global Constraints

- Read `ios/CLAUDE.md` first and follow it. Never edit
  `ios/BudgetPhone.xcodeproj/project.pbxproj`.
- Swift 6, iOS 26, Swift Testing. Stores are `@MainActor @Observable`.
- Any test suite using `StubURLProtocol` nests under `StubbedNetworkTests`.
- Store failure rules stay as they are: full screen with nothing showing,
  banner with data showing, `.cancelled` silent.
- Wording is exactly as in the spec (copy it verbatim).
- Never contact the live server at localhost:3000 from tests.
- Public repo: invented values only.
- Test command, from `ios/`:
  `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Before each commit: `bash scripts/test-scrub.sh` from budget-claude.
  Commit messages end with exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1: Classify failures in plain language

In `ios/BudgetPhone/Networking/APIError` (APIClient.swift) and a new
`ios/BudgetPhone/Shared/ConnectionProblem.swift`:

- `APIError.isUnreachable: Bool` — true for `.unreachable` and for
  `.server` with status 502, 503 or 504.
- `APIError.message` for `.unreachable` becomes the spec's plain sentence;
  the system's text moves to `var detail: String?` (the `.unreachable`
  payload; nil otherwise). Check every existing use of `.message` / tests
  that assert the old unreachable text and update them.
  A `.server` 502/503/504 `message` also becomes the plain unreachable
  sentence (its server text goes to `detail`).
- `APIError.loadBanner: String` — the spec's banner wording: can't reach,
  access token, else `message`.
- `struct ConnectionProblem: Equatable` with `title`, `systemImage`,
  `message`, `steps: [String]`, built by `init(_ error: APIError)` exactly
  per the spec's full-screen section (`.notConfigured` uses the can't-reach
  layout as today's ErrorView does).

Tests: `ios/BudgetPhoneTests/ConnectionProblemTests.swift` (plain suite):
each APIError case → the expected title, steps, message, loadBanner,
isUnreachable; 500 is not unreachable; 502/503/504 are.

## Task 2: The screen and the banners

- Move `ErrorView` out of `Accounts/AccountsView.swift` into
  `ios/BudgetPhone/Shared/ErrorView.swift`, same signature
  (`error`, `server`, `retry`). Draw a `ConnectionProblem`:
  `ContentUnavailableView` with the title and symbol; the message; the steps
  as a numbered list (left-aligned, readable at accessibility sizes); for
  can't-reach, the server address in small secondary text, and the
  system's `detail` under it in caption secondary; a prominent **Retry**.
- Every store's load-failure banner (the `banner = error.message` that sits
  next to `self.error = error` — the "data showing" path of a load, in
  Accounts, Transactions `reload`, Analytics `report` and `changeRange`,
  Subscriptions, Benefits, Categories, Rules, Connections, P2P) uses
  `error.loadBanner` instead. Action banners (refresh, sync, writes,
  `reloadPage`) keep `error.message`.
- Tests: for Accounts and Transactions under `StubbedNetworkTests`, data
  showing + unreachable reload → banner equals the can't-reach banner text;
  data showing + 401 → the token banner text; a 502 with nothing showing →
  `error.isUnreachable`.
- `CHANGELOG.md`: under `## Unreleased`, one plain line, e.g. "iPhone app:
  when it can't reach your Mac it says what to check (Tailscale, the Mac
  awake, Budget running), with a Retry button; with saved data showing, a
  short banner says so instead."

Run the full iOS suite and `npm test` from budget-claude (node_modules is
installed in the worktree).
