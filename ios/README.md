# Budget for iPhone

A native SwiftUI client for the Budget web app. It reads and edits the same
data by calling the web app's own API, so the Budget server has to be running
somewhere the phone can reach.

Screens so far:

- **Accounts** — net worth, balances, due dates; refresh from Plaid; rename a
  card or set its due day and limit; hide an account from the totals (this
  iPhone only).
- **Activity** (Transactions) — the ledger with search, filters, sort and Sync; each
  row's category, link to a purchase, splits (Pro), refunds and Venmo
  breakdown; the Venmo and Zelle categorizers, with Venmo CSV import.
- **Analytics** — summary cards over 3, 6 or 12 months, spending by category,
  and monthly spending against income; in Pro mode, the cumulative Spending
  graph with an editable monthly limit. A Subscriptions card opens the list of
  recurring charges: pull down to detect from banks, + to add, swipe to delete.
- **Benefits** — Best card: for each bonus category, the card that earns most
  and the next two, with your card images.
- **Settings** — the Pro Mode switch, Categories (add, rename, merge, delete,
  Plaid labels, subcategories), Rules (add, on/off, category, delete, Apply
  Now, Use Rule for These), Connections (debit cards; connected banks, with
  disconnect — connecting stays on the Mac), and the server address.

Designs: `../docs/superpowers/specs/2026-09-26-ios-accounts-design.md`,
`../docs/superpowers/specs/2026-09-26-ios-transactions-design.md`,
`../docs/superpowers/specs/2026-09-27-ios-settings-mode-design.md`,
`../docs/superpowers/specs/2026-09-30-ios-analytics-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-subscriptions-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-benefits-best-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-settings-categories-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-settings-rules-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-settings-connections-design.md`.

## Before you start

- A Mac with Xcode 26 or later (free from the Mac App Store).
- The Budget server set up and running on that Mac: follow `../README.md`
  first. The app has no data of its own.
- To run on a phone: an iPhone on iOS 26, a free Apple ID, a cable, and
  Tailscale on both the Mac and the phone ("Reaching the Mac" below).

## Run in the simulator

```bash
open BudgetPhone.xcodeproj
```

Pick an iPhone simulator and press Run (⌘R). On first launch, enter
`http://localhost:3000` — the simulator shares the Mac's network.

Tests: ⌘U in Xcode, or

```bash
xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData
```

## Run on your iPhone (free Apple ID)

1. `cp Config/Local.example.xcconfig Config/Local.xcconfig`
2. Xcode → Settings → Accounts → add your Apple ID. It creates a free
   "Personal Team". Click that team to see its ten-character Team ID (or
   find it in Keychain Access, under the "Apple Development" certificate's
   Organizational Unit). Put it in `DEVELOPMENT_TEAM` in
   `Config/Local.xcconfig` **before** opening the project.
3. Open the project and select the **BudgetPhone** target → Signing &
   Capabilities. With the Team ID already in `Local.xcconfig`, it should
   show your Personal Team without you touching the picker — leave it as is.
   If Xcode says the bundle identifier is taken, change `BUNDLE_ID_PREFIX` in
   `Local.xcconfig` too.

   Doing it in this order matters: picking the team from the Signing &
   Capabilities picker instead writes your Team ID straight into the tracked
   `BudgetPhone.xcodeproj/project.pbxproj`, a public repo. If that happens,
   run `git checkout -- BudgetPhone.xcodeproj/project.pbxproj` before
   committing — `scripts/test-scrub.sh` also fails the build if a Team ID
   slips into the project file.
4. Connect the iPhone by cable. On the phone: Settings → Privacy & Security →
   Developer Mode → on (it restarts).
5. Choose the iPhone as the run destination and press Run. The first time,
   trust the developer on the phone: Settings → General → VPN & Device
   Management.
6. In the app, enter the Mac's `https://…ts.net` address and its access
   token. Set both up as described in "Reaching the Mac" below.

**Every 7 days** a free signature expires and the app stops opening. Connect
the phone and press Run again; nothing on the phone is lost.

## Reaching the Mac

The server listens on the Mac only, so the phone cannot reach it over Wi-Fi,
even at home. The phone always goes through Tailscale: install it on the Mac
and the iPhone, sign in to the same account on both, and keep it connected on
the phone.

iOS blocks plain `http` to a Tailscale IP (`100.x.y.z`), so the app needs an
`https` address. Let Tailscale provide it:

1. In the Tailscale admin console, enable MagicDNS and HTTPS certificates
   (DNS page), and allow Serve when the CLI prints its link.
2. On the Mac, run `tailscale serve --bg 3000`. It prints
   `https://<mac-name>.<tailnet>.ts.net` and keeps running across restarts.
   The CLI is at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`.
3. Put that address in the app's Settings → Server, with no port.
4. Open Budget on the Mac, Settings → Remote Access, copy the token, and
   paste it into the app's Settings → Server.
