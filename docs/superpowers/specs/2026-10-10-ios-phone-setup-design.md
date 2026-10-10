# iPhone App — Guided Setup Design

**Status:** Draft for review, 2026-10-10. Branch `ios-phone-setup`, cut from `main`.

**Goal:** Putting the iPhone app on a friend's phone takes about 15 manual
steps in `ios/README.md`, and the hardest one (finding the Team ID in
Keychain Access) needs no human at all. Replace Steps 1–7 with one command
that does every step a script can do, and for the rest says exactly where to
click, then waits and checks.

---

## Decisions already made

| Question | Decision |
|---|---|
| Shape | A new `setup` subcommand of `ios/scripts/phone.sh`, run in Terminal. Not a web page, not docs only. |
| Re-running | Safe at any time. Every step checks first and skips what is already done; Step 5 always installs a fresh copy, which only renews the 7 days. |
| What stays manual | Downloading Xcode from the App Store, signing in to an Apple ID in Xcode, tapping Trust / Developer Mode / Trust Developer on the phone. The script can't do these; it explains them and waits. |
| Server and token | Filled in for the friend: the script reads them on the Mac and hands them to the app's first launch. |
| Xcode's Signing UI | Still never used. The Team ID goes in `Config/Local.xcconfig` as today. |
| Agents | Never run `setup` for real (it installs on a phone and adds a LaunchAgent), same as `install` and `schedule on`. Tests use stubs. |

---

## What the friend sees

```
cd ~/Documents/budget/ios
bash scripts/phone.sh setup
```

Steps run in order. Each prints a numbered heading (`Step 3 of 7: Team ID`).
A done step prints one `✓` line and moves on. A step that needs the friend
prints what to do, then `Press Return when done.`, and checks again after
Return; if still not done, it says what it still sees and asks again.
`Ctrl-C` stops at any point; running again picks up where it stopped.

### Before step 1: Budget and Tailscale

Stops with a pointer to the main guide (not a wait) when:

- `../package.json` is missing: Budget isn't in this folder (main guide Step 4).
- Budget isn't answering on `http://127.0.0.1:3000` → "Start Budget first
  (double-click Budget.command)".
- Tailscale isn't installed, isn't signed in, or `tailscale serve status`
  doesn't forward to port 3000 → main guide Step 8.

### Step 1: Xcode

| Check | If not done |
|---|---|
| `/Applications/Xcode.app` exists | `open` the Mac App Store page for Xcode; "Click Get, then Install. It's a big download (often an hour). Leave this window open and press Return when it has finished." |
| `xcode-select -p` points inside Xcode.app (friends who ran the main installer have it pointing at the Command Line Tools) | Fixed in the sudo step below. |
| `xcodebuild -license check` passes | Fixed in the sudo step below. |
| `xcodebuild -checkFirstLaunchStatus` exits 0 | Fixed in the sudo step below. |
| `xcodebuild -showsdks` lists an `iphoneos` SDK | `xcodebuild -downloadPlatform iOS` (no sudo), with "Downloading the iPhone parts of Xcode…". |

The three sudo fixes run together as one `sudo` call, after a line saying
"Your Mac's password is needed once to finish setting up Xcode. Nothing shows
while you type." The call is
`sudo sh -c 'xcode-select -s /Applications/Xcode.app && xcodebuild -license accept && xcodebuild -runFirstLaunch'`,
with only the parts that are needed.

### Step 2: Apple ID

Done when Xcode's preferences (`defaults read com.apple.dt.Xcode
IDEProvisioningTeamByIdentifier`) list at least one team. Otherwise:
`open -a Xcode`, then

```
In Xcode, click Xcode in the menu bar at the very top of the screen, then Settings…
Click Accounts. Click + at the bottom left, choose Apple ID, click Continue, and sign in.
You should see your name with "(Personal Team)". Then press Return here.
```

### Step 3: Team ID

- Creates `Config/Local.xcconfig` from `Local.example.xcconfig` if missing.
- `DEVELOPMENT_TEAM` already set → kept, `✓`.
- Otherwise reads the teams from the same preferences. One team → written
  in. Several → listed as `1) Your Name (Personal Team)  A1B2C3D4E5`, and the
  friend types a number; Personal Teams are listed first.
- The value is edited in place with the same last-line-wins reading as
  `xcconfig_value`, without touching other lines.

### Step 4: iPhone

Uses `devicectl list devices` (as `resolve_phone` does), but waits rather
than failing:

| Phone state | Says |
|---|---|
| No iPhone seen | "Plug your iPhone into this Mac with a cable and unlock it." |
| Seen, not paired | "On the iPhone, tap Trust and enter your passcode." |
| More than one paired, no `PHONE_DEVICE` | Lists them by name; the friend types a number; the name is written to `PHONE_DEVICE`. |
| `developerModeStatus` not `enabled` | "On the iPhone: Settings → Privacy & Security → scroll to the bottom → Developer Mode → turn it on → Restart. After it restarts, unlock it and tap Turn On." If the friend says it isn't there: "Keep the phone plugged in and unlocked; it can take a minute to appear." |

### Step 5: Install

Runs the existing `cmd_install`. On its known failures it explains and
waits instead of exiting:

- **Signed out** (already detected) → back to the Step 2 instructions.
- **Bundle ID taken** (`Failed Registering Bundle Identifier` or
  `cannot be registered to your development team` in the build output) →
  sets `BUNDLE_ID_PREFIX` to `local.budget.<6 random letters/digits>` itself
  and tries once more; no clicks.
- **Phone not seen** → the Step 4 wait.

Anything else: prints `cmd_install`'s message and the log path, and stops.

### Step 6: Connect

1. Reads the address: `tailscale status --json` → `Self.DNSName` without
   the trailing dot, as `https://<name>`.
2. Reads the token from `../data/access-token`. If the file is missing, a
   `GET http://127.0.0.1:3000/api/access/token` first (the server creates
   it on first read).
3. Launches the app:
   `devicectl device process launch --terminate-existing --device <id> <bundle id>`
   with `DEVICECTL_CHILD_BUDGET_SETUP_SERVER` and
   `DEVICECTL_CHILD_BUDGET_SETUP_TOKEN` in the environment. Environment
   variables, not arguments or `-e` JSON, so the token never appears in the
   Mac's process list.
4. If the launch fails because the developer isn't trusted (the error names
   an untrusted or unverified profile), says:
   ```
   On the iPhone: Settings → General → VPN & Device Management.
   Under Developer App, tap your Apple ID, then Trust, then Trust again.
   ```
   waits, and launches again.

`✓ Budget opened on your iPhone with your Mac's address filled in.`

### Step 7: Wi-Fi and schedule

1. "Unplug the cable. Keep the iPhone unlocked and on the same Wi-Fi as this
   Mac." Waits until `devicectl` still lists the phone as paired with a
   `localNetwork` transport. If it doesn't appear within about a minute:
   "Make sure both are on the same Wi-Fi, then press Return to look again."
   (Current Xcode connects paired phones over Wi-Fi by itself; there is no
   checkbox to tick.)
2. Runs `schedule_on`.
3. Ends with:
   ```
   All set. Budget is on your iPhone and opens until Saturday, October 17.
   Your Mac puts it on again every few days by itself while it's awake and
   the phone is on the same Wi-Fi.
   ```

---

## The iPhone app change

New `Networking/SetupHandoff.swift`:

```swift
/// Server and token handed over by `phone.sh setup` on first launch.
enum SetupHandoff {
  static func apply(environment: [String: String], defaults: UserDefaults = .standard)
}
```

- Reads `BUDGET_SETUP_SERVER` and `BUDGET_SETUP_TOKEN`.
- Does nothing when `ServerAddress.saved(in:)` is non-nil: it never
  replaces a server someone set.
- Otherwise, with a server that passes `ServerAddress.normalize`, saves it under
  `ServerAddress.storageKey` and the token with `AccessToken.save`, exactly
  as `ServerForm.save` does for a first-time save.
- Called once at app start (`BudgetPhoneApp.init`) with
  `ProcessInfo.processInfo.environment`, before `RootView` reads the server,
  so the setup screen is skipped and the tabs load straight away.

Tests (`BudgetPhoneTests/SetupHandoffTests.swift`, in-memory `TokenStore`
and a scratch `UserDefaults` suite): saves both when nothing is saved;
leaves an existing server and token untouched; ignores a bad address;
ignores a missing server; saves the server with no token.

---

## Script structure

`setup` lives in `phone.sh` beside `install`; each step is one
`setup_<name>` function returning 0 when done. A shared `wait_for` helper
runs a check, prints the instructions, reads a line, and loops. New tools
get the same swappable variables as today: `SUDO`, `XCODE_APP`,
`XCODE_SELECT`, `TAILSCALE`, `CURL`, `DEFAULTS`, `OPEN`, and `READ_INPUT`
(a file to read answers from in tests instead of the terminal).

`usage` lists `setup` first.

## Tests

`scripts/test-phone-reinstall.sh` gains setup cases with stubbed tools and a
scripted answers file:

- Everything already done → every step prints `✓`, no sudo, no waits.
- Xcode missing → opens the App Store page; after the stub "installs" it,
  continues.
- `xcode-select` on Command Line Tools and license not accepted → one sudo
  call containing both fixes and nothing else.
- Signed out → Step 2 instructions, waits, continues once a team appears.
- One team → written to `Local.xcconfig`; existing `DEVELOPMENT_TEAM` → kept;
  two teams → asks, writes the picked one.
- No phone, then unpaired, then Developer Mode off → each message in turn.
- Bundle ID taken → prefix changed and the build retried once.
- Untrusted developer on launch → trust instructions, launch retried.
- The launch gets the server and token through `DEVICECTL_CHILD_*`, and the
  token is not in the stub's argument list.
- Budget not running, or Tailscale not serving → stops with the pointer,
  exit code non-zero.

## Docs

`ios/README.md`:

- New main path: what you need (unchanged), then "Paste these two lines and
  follow what it says", with a screenshot-free description of each of the
  seven stops so the friend knows what's coming.
- The current Steps 1–7 move under **Doing it by hand**, with the
  "Connect via network" checkbox step replaced by "unplug and check it's
  still found".
- The `phone.sh` command table gains `setup`.

Main `README.md` Step 9 points at the new main path.
`CHANGELOG.md` `## Unreleased` gets one line.

## Out of scope

- Installing Xcode without the App Store (`xcodes`, `mas`): both need the
  friend's Apple ID password typed into a third-party tool.
- Opening Xcode's Accounts pane by script (needs Accessibility permission).
- A web page version of setup.
