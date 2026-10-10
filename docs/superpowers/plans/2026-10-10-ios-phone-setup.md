# iPhone Guided Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bash scripts/phone.sh setup` takes a friend from "Budget runs on my Mac" to "the app is on my iPhone, connected, and renews itself", doing every step a script can and explaining and waiting on the rest.

**Architecture:** A new `setup` subcommand in `ios/scripts/phone.sh`, made of one `setup_<step>` function per step plus small helpers for prompts and editing `Local.xcconfig`; it reuses `cmd_install`, `resolve_phone` and `schedule_on`. A tiny Swift type, `SetupHandoff`, saves the server and token that setup passes to the app's launch through environment variables.

**Tech Stack:** bash 3.2 (macOS `/bin/bash`), `xcrun devicectl`, `xcodebuild`, `plutil`, JXA (`osascript -l JavaScript`), SwiftUI / Swift Testing (iOS 26, Swift 6).

**Spec:** `docs/superpowers/specs/2026-10-10-ios-phone-setup-design.md`

All paths below are relative to `budget-claude/` in the worktree
`.worktrees/ios-phone-setup` (branch `ios-phone-setup`).
Every commit command first checks the branch:
`test "$(git branch --show-current)" = ios-phone-setup && git commit …`.

## Global Constraints

- Agents never run `phone.sh setup`, `install`, `auto` or `schedule on` for real. Only `bash scripts/test-phone-reinstall.sh` (stubs).
- Agents may only send the live server (`http://localhost:3000`) GET requests.
- Never edit `ios/BudgetPhone.xcodeproj/project.pbxproj`. New Swift files under `ios/BudgetPhone/` and `ios/BudgetPhoneTests/` join their targets automatically.
- Must run on macOS's bash 3.2: no `declare -A`, no `${var,,}`, no `mapfile`, no `read -t` fractional, no `|&`.
- The access token never goes into a command's arguments, the log, or the terminal.
- Public repo: no real names, phones, team IDs, hostnames or tokens in code, tests or docs. Use invented values (`Test Phone`, `A1B2C3D4E5`, `test-mac.example.ts.net`, `tok-123`).
- Before each commit: `bash scripts/test-scrub.sh` passes.
- Swift tests: `cd ios && xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Script tests: `bash scripts/test-phone-reinstall.sh` (prints `N passed, 0 failed`, exits 0).
- User-facing wording is plain English for non-technical friends, using `→` for menu paths, as in `ios/README.md`.

## Review Focus

- A phone name containing `&`, `/` or `|` (e.g. `Ann & Bo's iPhone`) written to `PHONE_DEVICE` must land in `Local.xcconfig` exactly as typed (sed escaping) — test in Task 4.
- Input running out (Ctrl-D, or a test's answers file ending) while setup waits must stop setup with exit 3, never loop forever — test in Task 2.
- The token must not appear in any stub's argument list, in `build/phone/log`, or in setup's output — test in Task 5.
- A second, older paired iPhone in the device list must produce the "which phone" question, not a silent pick or a failure — test in Task 4.
- Running setup again when everything is done must not call `sudo`, `open`, or ask anything; it reinstalls and ends `All set.` — test in Task 5.

---

### Task 1: The app accepts the setup handoff

**Files:**
- Create: `ios/BudgetPhone/Networking/SetupHandoff.swift`
- Modify: `ios/BudgetPhone/App/BudgetPhoneApp.swift`
- Test: `ios/BudgetPhoneTests/SetupHandoffTests.swift`

**Interfaces:**
- Consumes: `ServerAddress.storageKey`, `ServerAddress.saved(in:)`, `ServerAddress.normalize(_:)` (`Networking/ServerAddress.swift`); `TokenStore`, `AccessToken.store`, `AccessToken.normalize(_:)`, `MemoryTokenStore` (`Networking/AccessToken.swift`).
- Produces: environment keys `BUDGET_SETUP_SERVER` and `BUDGET_SETUP_TOKEN` (the script in Task 5 sets them as `DEVICECTL_CHILD_BUDGET_SETUP_SERVER` / `DEVICECTL_CHILD_BUDGET_SETUP_TOKEN`).

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/SetupHandoffTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

struct SetupHandoffTests {
  /// A fresh, empty defaults suite per test.
  private func emptyDefaults(_ name: String) throws -> UserDefaults {
    let defaults = try #require(UserDefaults(suiteName: "SetupHandoffTests.\(name)"))
    defaults.removePersistentDomain(forName: "SetupHandoffTests.\(name)")
    return defaults
  }

  private let env = [
    "BUDGET_SETUP_SERVER": "https://test-mac.example.ts.net/",
    "BUDGET_SETUP_TOKEN": " tok-123\n",
  ]

  @Test func savesServerAndTokenWhenNothingIsSaved() throws {
    let defaults = try emptyDefaults("fresh")
    let tokens = MemoryTokenStore()
    SetupHandoff.apply(environment: env, defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == "https://test-mac.example.ts.net")
    #expect(tokens.read() == "tok-123")
  }

  @Test func neverReplacesASavedServer() throws {
    let defaults = try emptyDefaults("saved")
    defaults.set("https://other.example.ts.net", forKey: ServerAddress.storageKey)
    let tokens = MemoryTokenStore("old-token")
    SetupHandoff.apply(environment: env, defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == "https://other.example.ts.net")
    #expect(tokens.read() == "old-token")
  }

  @Test func ignoresAnAddressThatDoesNotParse() throws {
    let defaults = try emptyDefaults("bad")
    let tokens = MemoryTokenStore()
    SetupHandoff.apply(
      environment: ["BUDGET_SETUP_SERVER": "not a url", "BUDGET_SETUP_TOKEN": "tok-123"],
      defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == nil)
    #expect(tokens.read() == nil)
  }

  @Test func ignoresALaunchWithoutAServer() throws {
    let defaults = try emptyDefaults("none")
    let tokens = MemoryTokenStore()
    SetupHandoff.apply(environment: ["BUDGET_SETUP_TOKEN": "tok-123"], defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == nil)
    #expect(tokens.read() == nil)
  }

  @Test func savesTheServerWithoutAToken() throws {
    let defaults = try emptyDefaults("notoken")
    let tokens = MemoryTokenStore()
    SetupHandoff.apply(
      environment: ["BUDGET_SETUP_SERVER": "https://test-mac.example.ts.net"],
      defaults: defaults, tokens: tokens)
    #expect(defaults.string(forKey: ServerAddress.storageKey) == "https://test-mac.example.ts.net")
    #expect(tokens.read() == nil)
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `ios/`): `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet -only-testing:BudgetPhoneTests/SetupHandoffTests`
Expected: build fails with `cannot find 'SetupHandoff' in scope`.

- [ ] **Step 3: Write the implementation**

`ios/BudgetPhone/Networking/SetupHandoff.swift`:

```swift
import Foundation

/// The server and token `scripts/phone.sh setup` hands the app on the launch
/// it starts, so a friend has nothing to type. It only fills an empty setup:
/// a server someone already saved is never replaced.
/// docs/superpowers/specs/2026-10-10-ios-phone-setup-design.md
enum SetupHandoff {
  static let serverKey = "BUDGET_SETUP_SERVER"
  static let tokenKey = "BUDGET_SETUP_TOKEN"

  static func apply(
    environment: [String: String],
    defaults: UserDefaults = .standard,
    tokens: any TokenStore = AccessToken.store
  ) {
    guard ServerAddress.saved(in: defaults) == nil,
      let url = environment[serverKey].flatMap(ServerAddress.normalize)
    else { return }
    defaults.set(url.absoluteString, forKey: ServerAddress.storageKey)
    tokens.write(environment[tokenKey].flatMap(AccessToken.normalize))
  }
}
```

`ios/BudgetPhone/App/BudgetPhoneApp.swift` becomes:

```swift
import SwiftUI

@main
struct BudgetPhoneApp: App {
  init() {
    // Before RootView reads the server, so a handed-over one skips setup.
    SetupHandoff.apply(environment: ProcessInfo.processInfo.environment)
  }

  var body: some Scene {
    WindowGroup {
      RootView()
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the Step 2 command. Expected: `SetupHandoffTests` all pass. Then run the full Swift test command from Global Constraints. Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
bash scripts/test-scrub.sh
git add ios/BudgetPhone/Networking/SetupHandoff.swift ios/BudgetPhone/App/BudgetPhoneApp.swift ios/BudgetPhoneTests/SetupHandoffTests.swift
test "$(git branch --show-current)" = ios-phone-setup && git commit -m "iPhone: take the server and token handed over by phone.sh setup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Setup skeleton, prompts, Budget/Tailscale check, Xcode step

**Files:**
- Modify: `ios/scripts/phone.sh` (new variables after `DAY=86400`; new helpers and functions before `usage()`; `usage` and the `case` at the bottom)
- Modify: `scripts/test-phone-reinstall.sh` (stubs, helpers, new test section before the final summary lines)

**Interfaces:**
- Consumes: `say`, `log`, `xcconfig_value`, `$STATE_DIR`, `$LOG`, `$XCODEBUILD`, `$OSASCRIPT` from `phone.sh`.
- Produces (used by Tasks 3–5):
  - `ask` — reads one line from fd 3 into `REPLY_LINE`; on EOF prints `Stopped.` and `exit 3`.
  - `press_return` — prints `Press Return when done. `, then `ask`.
  - `choose N` — asks for a number 1..N until valid; sets `CHOICE`.
  - `heading N TITLE` — prints a blank line and `Step N of 7: TITLE`.
  - `cmd_setup` — opens fd 3 from `$SETUP_INPUT`, runs `setup_budget`, then the steps; later tasks append steps to it.
  - Variables: `XCODE_APP`, `XCODE_SELECT`, `SUDO`, `DEFAULTS`, `OPEN`, `TAILSCALE`, `CURL`, `BUDGET_URL`, `TOKEN_FILE`, `EXAMPLE_XCCONFIG`, `SETUP_INPUT`, `POLL_SECONDS`, `POLL_TRIES`.
  - Test harness: `new_setup_case`, `answers` (writes the answers file), `teams_plist`, `phone_json` args 6 (transport, default `localNetwork`) and 7 (developer mode, default `enabled`), numbered sequence files `$STUB_DEVICES.<n>` / `$STUB_TEAMS.<n>`.

- [ ] **Step 1: Extend the test harness stubs**

In `scripts/test-phone-reinstall.sh`, replace the whole `xcodebuild` stub heredoc with:

```bash
cat >"$STUBS/xcodebuild" <<'EOF'
#!/bin/bash
echo "xcodebuild $*" >>"$STUB_CALLS"
case "${1:-}" in
  -license) exit "${STUB_LICENSE_RC:-0}" ;;
  -checkFirstLaunchStatus) exit "${STUB_FIRSTLAUNCH_RC:-0}" ;;
  -showsdks) echo "${STUB_SDKS-iOS SDKs: -sdk iphoneos26.0}"; exit 0 ;;
  -downloadPlatform) exit 0 ;;
esac
# The first STUB_BUILD_FAILS builds fail with STUB_BUILD_OUT.
n=$(( $(cat "$STUB_CALLS.builds" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$STUB_CALLS.builds"
if [ "$n" -le "${STUB_BUILD_FAILS:-0}" ]; then echo "${STUB_BUILD_OUT:-}"; exit 65; fi
[ -z "${STUB_BUILD_OUT:-}" ] || echo "$STUB_BUILD_OUT"
[ "${STUB_BUILD_RC:-0}" = 0 ] || exit "$STUB_BUILD_RC"
while [ $# -gt 0 ]; do [ "$1" = -derivedDataPath ] && dd="$2"; shift; done
app="$dd/Build/Products/Debug-iphoneos/BudgetPhone.app"
mkdir -p "$app"
if [ -z "${STUB_NO_PROFILE:-}" ]; then
  signed=${STUB_SIGNED:-$PHONE_NOW}
  iso() { date -j -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
  printf '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CreationDate</key><date>%s</date><key>ExpirationDate</key><date>%s</date></dict></plist>' \
    "$(iso "$signed")" "$(iso $((signed + 7 * 86400)))" >"$app/embedded.mobileprovision"
fi
exit 0
EOF
```

Replace the `devicectl` stub heredoc with:

```bash
cat >"$STUBS/devicectl" <<'EOF'
#!/bin/bash
echo "devicectl $*" >>"$STUB_CALLS"
# The nth device list comes from $STUB_DEVICES.n if that file exists.
if [ "${1:-} ${2:-}" = "list devices" ]; then
  n=$(( $(cat "$STUB_CALLS.lists" 2>/dev/null || echo 0) + 1 ))
  echo "$n" >"$STUB_CALLS.lists"
  src="$STUB_DEVICES"; [ -f "$STUB_DEVICES.$n" ] && src="$STUB_DEVICES.$n"
  while [ $# -gt 0 ]; do
    [ "$1" = --json-output ] && cp "$src" "$2"
    shift
  done
  exit 0
fi
# The first STUB_LAUNCH_FAILS launches fail with STUB_LAUNCH_OUT. Records
# what the launched app would get in its environment.
if [ "${1:-} ${2:-} ${3:-}" = "device process launch" ]; then
  echo "server=${DEVICECTL_CHILD_BUDGET_SETUP_SERVER:-} token=${DEVICECTL_CHILD_BUDGET_SETUP_TOKEN:-}" >>"$STUB_CALLS.env"
  n=$(( $(cat "$STUB_CALLS.launches" 2>/dev/null || echo 0) + 1 ))
  echo "$n" >"$STUB_CALLS.launches"
  if [ "$n" -le "${STUB_LAUNCH_FAILS:-0}" ]; then echo "${STUB_LAUNCH_OUT:-}"; exit 1; fi
  exit 0
fi
exit "${STUB_INSTALL_RC:-0}"
EOF
```

After the `launchctl` stub heredoc (before `chmod +x "$STUBS"/*`), add:

```bash
cat >"$STUBS/xcode-select" <<'EOF'
#!/bin/bash
echo "xcode-select $*" >>"$STUB_CALLS"
echo "${STUB_SELECT_PATH:-$XCODE_APP/Contents/Developer}"
EOF
cat >"$STUBS/sudo" <<'EOF'
#!/bin/bash
echo "sudo $*" >>"$STUB_CALLS"
exit "${STUB_SUDO_RC:-0}"
EOF
# `open` the App Store page "installs" Xcode when STUB_OPEN_INSTALLS is set.
cat >"$STUBS/open" <<'EOF'
#!/bin/bash
echo "open $*" >>"$STUB_CALLS"
case "$*" in macappstore:*) [ -z "${STUB_OPEN_INSTALLS:-}" ] || mkdir -p "$XCODE_APP" ;; esac
EOF
# The nth `defaults export` comes from $STUB_TEAMS.n if that file exists.
cat >"$STUBS/defaults" <<'EOF'
#!/bin/bash
echo "defaults $*" >>"$STUB_CALLS"
n=$(( $(cat "$STUB_CALLS.teams" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$STUB_CALLS.teams"
src="$STUB_TEAMS"; [ -f "$STUB_TEAMS.$n" ] && src="$STUB_TEAMS.$n"
cat "$src"
EOF
cat >"$STUBS/tailscale" <<'EOF'
#!/bin/bash
echo "tailscale $*" >>"$STUB_CALLS"
case "$*" in
  "status --json")
    printf '{"BackendState":"%s","Self":{"DNSName":"test-mac.example.ts.net."}}' "${STUB_TS_STATE:-Running}" ;;
  "serve status --json")
    if [ -n "${STUB_TS_NO_SERVE:-}" ]; then echo '{}'
    else echo '{"Web":{"test-mac.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}'; fi ;;
esac
EOF
# A request for the token writes the token file when STUB_CURL_WRITES_TOKEN
# is set (the server creates it on first read).
cat >"$STUBS/curl" <<'EOF'
#!/bin/bash
echo "curl $*" >>"$STUB_CALLS"
case "$*" in
  *"/api/access/token"*) [ -z "${STUB_CURL_WRITES_TOKEN:-}" ] || echo "$STUB_CURL_WRITES_TOKEN" >"$TOKEN_FILE" ;;
esac
exit "${STUB_CURL_RC:-0}"
EOF
```

Replace `phone_json` with (two new optional args; existing calls unchanged):

```bash
# One device entry shaped like `devicectl list devices --json-output`.
# Args: name, CoreDevice id, UDID, [deviceType], [pairingState],
# [transportType], [developerModeStatus].
phone_json() {
  printf '{"identifier":"%s","deviceProperties":{"name":"%s","developerModeStatus":"%s"},"hardwareProperties":{"platform":"iOS","deviceType":"%s","udid":"%s"},"connectionProperties":{"pairingState":"%s","transportType":"%s"}}' \
    "$2" "$1" "${7:-enabled}" "${4:-iPhone}" "$3" "${5:-paired}" "${6:-localNetwork}"
}
```

Change `devices()` to take an optional target file:

```bash
# Replaces this case's device list with the given entries. DEVICES_FILE
# picks another file, e.g. "$CASE/devices.json.1" for the first list only.
devices() {
  local IFS=,
  printf '{"result":{"devices":[%s]}}' "$*" >"${DEVICES_FILE:-$CASE/devices.json}"
}
```

In `new_case`, add `STUB_BUILD_FAILS STUB_LAUNCH_FAILS STUB_LAUNCH_OUT` to the `unset` line.

After `phone()`, add:

```bash
# Xcode's saved teams, as `defaults export com.apple.dt.Xcode -` prints them.
# Each arg is "TEAMID|Name|Team type|1 for free". No args: signed out.
teams_plist() {
  printf '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>IDEProvisioningTeamByIdentifier</key><dict><key>ACCOUNT-1</key><array>'
  local t id name type free
  for t in "$@"; do
    IFS='|' read -r id name type free <<<"$t"
    printf '<dict><key>teamID</key><string>%s</string><key>teamName</key><string>%s</string><key>teamType</key><string>%s</string><key>isFreeProvisioningTeam</key><%s/></dict>' \
      "$id" "$name" "$type" "$([ "$free" = 1 ] && echo true || echo false)"
  done
  printf '</array></dict></dict></plist>'
}
# The friend's answers, one per line (an empty line is pressing Return).
answers() { printf '%s\n' "$@" >"$CASE/answers"; }
# A case where every setup step is already done: Xcode installed and set
# up, signed in with one team that is already in Local.xcconfig, one paired
# phone on Wi-Fi with Developer Mode on, Tailscale serving Budget, a token.
new_setup_case() {
  new_case
  mkdir -p "$CASE/Xcode.app"
  echo "DEVELOPMENT_TEAM = A1B2C3D4E5" >"$CASE/Local.xcconfig"
  teams_plist "A1B2C3D4E5|Test Person|Personal Team|1" >"$CASE/teams.plist"
  echo "tok-123" >"$CASE/access-token"
  : >"$CASE/answers"
  export XCODE_APP="$CASE/Xcode.app" XCODE_SELECT="$STUBS/xcode-select" SUDO="$STUBS/sudo" \
         OPEN="$STUBS/open" DEFAULTS="$STUBS/defaults" TAILSCALE="$STUBS/tailscale" CURL="$STUBS/curl" \
         STUB_TEAMS="$CASE/teams.plist" TOKEN_FILE="$CASE/access-token" SETUP_INPUT="$CASE/answers" \
         EXAMPLE_XCCONFIG="$ROOT/ios/Config/Local.example.xcconfig" \
         PHONE_POLL_SECONDS=0 PHONE_POLL_TRIES=2
  unset STUB_LICENSE_RC STUB_FIRSTLAUNCH_RC STUB_SDKS STUB_SELECT_PATH STUB_SUDO_RC STUB_OPEN_INSTALLS \
        STUB_TS_STATE STUB_TS_NO_SERVE STUB_CURL_WRITES_TOKEN STUB_CURL_RC DEVICES_FILE
}
```

- [ ] **Step 2: Write the failing tests**

Insert before the final `echo` / `echo "$PASS passed, $FAIL failed"` lines:

```bash
echo "phone.sh setup: Budget, Tailscale, Xcode"

new_setup_case
phone setup
assert_has "$OUT" "Step 1 of 7: Xcode" "prints numbered steps"
assert_has "$OUT" "✓ Xcode is ready." "a ready Xcode is a tick"
assert_lacks "$CALLS" "sudo " "nothing to fix needs no password"
assert_lacks "$CALLS" "open " "opens nothing"

new_setup_case
export STUB_CURL_RC=7
phone setup
assert_fails "stops when Budget isn't running"
assert_has "$OUT" "Start Budget first" "says to start Budget"
assert_lacks "$OUT" "Step 1 of 7" "before any step"

new_setup_case
export STUB_TS_STATE=Stopped
phone setup
assert_fails "stops when Tailscale is off"
assert_has "$OUT" "Tailscale isn't on" "says to turn Tailscale on"

new_setup_case
export STUB_TS_NO_SERVE=1
phone setup
assert_fails "stops when Tailscale doesn't give Budget an address"
assert_has "$OUT" "Step 8" "points to the main guide's Step 8"

new_setup_case
rm -rf "$CASE/Xcode.app"
export STUB_OPEN_INSTALLS=1
answers ""
phone setup
assert_has "$CALLS" "open macappstore://apps.apple.com/app/id497799835" "opens Xcode's App Store page"
assert_has "$OUT" "Click Get, then Install" "says what to click"
assert_has "$OUT" "✓ Xcode is ready." "continues once Xcode is there"

new_setup_case
rm -rf "$CASE/Xcode.app"
phone setup
assert_eq "$RC" 3 "running out of answers stops setup"
assert_has "$OUT" "Stopped." "says it stopped"

new_setup_case
export STUB_SELECT_PATH=/Library/Developer/CommandLineTools STUB_LICENSE_RC=1
phone setup
assert_has "$OUT" "password is needed once" "warns before asking for the password"
assert_eq "$(grep -c '^sudo ' "$CASE/calls")" 1 "one sudo call"
assert_has "$CALLS" "xcode-select -s '$CASE/Xcode.app'" "points the tools at Xcode"
assert_has "$CALLS" "xcodebuild -license accept" "accepts the license"
assert_lacks "$CALLS" "runFirstLaunch" "skips what isn't needed"

new_setup_case
export STUB_SUDO_RC=1 STUB_FIRSTLAUNCH_RC=1
phone setup
assert_fails "a failed sudo stops setup"
assert_has "$OUT" "Xcode isn't finished setting up" "says so"

new_setup_case
export STUB_SDKS="macOS SDKs: -sdk macosx26.0"
phone setup
assert_has "$CALLS" "xcodebuild -downloadPlatform iOS" "downloads the iPhone parts"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: the old tests still pass; the new ones FAIL (setup prints `usage: …`).

- [ ] **Step 4: Write the implementation**

In `ios/scripts/phone.sh`, extend the header comment's command list:

```bash
#   bash scripts/phone.sh setup          first-time setup, step by step
#   bash scripts/phone.sh install        build and install now
```

and after `DAY=86400` add:

```bash
# Used by setup only.
XCODE_APP="${XCODE_APP:-/Applications/Xcode.app}"
XCODE_SELECT="${XCODE_SELECT:-xcode-select}"
SUDO="${SUDO:-sudo}"
DEFAULTS="${DEFAULTS:-defaults}"
OPEN="${OPEN:-open}"
TAILSCALE="${TAILSCALE:-/Applications/Tailscale.app/Contents/MacOS/Tailscale}"
CURL="${CURL:-curl}"
BUDGET_URL="${BUDGET_URL:-http://127.0.0.1:3000}"
TOKEN_FILE="${TOKEN_FILE:-$IOS/../data/access-token}"
EXAMPLE_XCCONFIG="${EXAMPLE_XCCONFIG:-$IOS/Config/Local.example.xcconfig}"
SETUP_INPUT="${SETUP_INPUT:-/dev/tty}"
POLL_SECONDS="${PHONE_POLL_SECONDS:-5}"
POLL_TRIES="${PHONE_POLL_TRIES:-12}"
APP_STORE_XCODE="macappstore://apps.apple.com/app/id497799835"
REPLY_LINE=""
CHOICE=""
```

Before `usage()`, add:

```bash
# ---- setup: first-time setup, one step at a time ----------------------------
# Every step checks first and moves on when it's already done. A step that
# needs the person says exactly what to do, waits for Return and checks again.
# Design: docs/superpowers/specs/2026-10-10-ios-phone-setup-design.md.

# One line from the person, read from fd 3 (the terminal, or a test's answers
# file). Running out of input stops setup instead of waiting forever.
ask() {
  if ! IFS= read -r REPLY_LINE <&3; then
    echo
    say "Stopped."
    exit 3
  fi
}

press_return() {
  printf '%s' "Press Return when done. "
  ask
  echo
}

# Asks for a number from 1 to $1 until it gets one; sets CHOICE.
choose() {
  while :; do
    printf '%s' "Type a number and press Return: "
    ask
    case "$REPLY_LINE" in
      "" | *[!0-9]*) ;;
      *) if [ "$REPLY_LINE" -ge 1 ] && [ "$REPLY_LINE" -le "$1" ]; then CHOICE=$REPLY_LINE; return 0; fi ;;
    esac
  done
}

heading() {
  echo
  say "Step $1 of 7: $2"
}

# Budget has to be here and running, and Tailscale serving it, before
# anything else makes sense. These stop setup instead of waiting: each is a
# step in the main guide.
setup_budget() {
  if [ ! -f "$IOS/../package.json" ]; then
    say "Budget isn't in the folder above this one. Do Step 4 of the main guide (README.md) first."
    return 1
  fi
  if ! "$CURL" -s -o /dev/null --max-time 5 "$BUDGET_URL" 2>>"$LOG"; then
    say "Budget isn't running on this Mac. Start Budget first (double-click Budget.command), then run setup again."
    return 1
  fi
  if [ ! -x "$TAILSCALE" ]; then
    say "Tailscale isn't installed on this Mac. Do Step 8 of the main guide (README.md) first."
    return 1
  fi
  local state
  state=$("$TAILSCALE" status --json 2>>"$LOG" | plutil -extract BackendState raw -o - - 2>/dev/null)
  if [ "$state" != Running ]; then
    say "Tailscale isn't on. Click its icon in the menu bar, sign in or turn it on, then run setup again."
    return 1
  fi
  if ! "$TAILSCALE" serve status --json 2>>"$LOG" | grep -q ':3000"'; then
    say "Tailscale isn't giving Budget an address yet. Do Step 8 of the main guide (README.md), sub-steps 3 and 4, then run setup again."
    return 1
  fi
}

setup_xcode() {
  if [ ! -d "$XCODE_APP" ]; then
    "$OPEN" "$APP_STORE_XCODE"
    say "The App Store is open on Xcode. Click Get, then Install."
    say "It's a very big download (often an hour). Leave this window open."
    press_return
    while [ ! -d "$XCODE_APP" ]; do
      say "Xcode isn't in Applications yet. Wait for the App Store to finish."
      press_return
    done
  fi
  # Fixes that need the Mac's password, run together so it's asked once.
  local fixes=""
  [ "$("$XCODE_SELECT" -p 2>/dev/null)" = "$XCODE_APP/Contents/Developer" ] ||
    fixes="xcode-select -s '$XCODE_APP'"
  "$XCODEBUILD" -license check >>"$LOG" 2>&1 ||
    fixes="${fixes:+$fixes && }xcodebuild -license accept"
  "$XCODEBUILD" -checkFirstLaunchStatus >>"$LOG" 2>&1 ||
    fixes="${fixes:+$fixes && }xcodebuild -runFirstLaunch"
  if [ -n "$fixes" ]; then
    say "Your Mac's password is needed once to finish setting up Xcode. Nothing shows while you type; press Return after it."
    log "setup: sudo $fixes"
    if ! "$SUDO" /bin/sh -c "$fixes"; then
      say "Xcode isn't finished setting up (the password step didn't work). Run setup again to retry."
      return 1
    fi
  fi
  if ! "$XCODEBUILD" -showsdks 2>>"$LOG" | grep -q iphoneos; then
    say "Downloading the iPhone parts of Xcode… (this can take a while)"
    if ! "$XCODEBUILD" -downloadPlatform iOS >>"$LOG" 2>&1; then
      say "Couldn't download the iPhone parts of Xcode. Details: $LOG"
      return 1
    fi
  fi
  say "✓ Xcode is ready."
}

cmd_setup() {
  # Checked in a subshell first: a failed `exec` redirection can end the script.
  if ! (exec 3<"$SETUP_INPUT") 2>/dev/null; then
    say "Setup asks questions, so run it in a Terminal window."
    return 1
  fi
  exec 3<"$SETUP_INPUT"
  log "setup: start"
  setup_budget || return 1
  heading 1 "Xcode"; setup_xcode || return 1
}
```

Change `usage` and the `case`:

```bash
usage() {
  echo "usage: bash scripts/phone.sh setup | install | schedule on | schedule off" >&2
  return 2
}

case "${1:-} ${2:-}" in
  "setup ") cmd_setup ;;
  "install ") cmd_install ;;
```

(keep the remaining `case` lines as they are).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
bash scripts/test-scrub.sh
git add ios/scripts/phone.sh scripts/test-phone-reinstall.sh
test "$(git branch --show-current)" = ios-phone-setup && git commit -m "phone.sh setup: Budget and Tailscale checks, Xcode step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Apple ID and Team ID steps

**Files:**
- Modify: `ios/scripts/phone.sh`
- Modify: `scripts/test-phone-reinstall.sh`

**Interfaces:**
- Consumes: `ask`, `press_return`, `choose`, `heading`, `cmd_setup`, `$DEFAULTS`, `$OPEN`, `$XCODE_APP`, `$EXAMPLE_XCCONFIG` (Task 2); `xcconfig_value`.
- Produces (used by Tasks 4–5):
  - `set_xcconfig KEY VALUE` — sets KEY in `$LOCAL_XCCONFIG` (replacing every line for KEY, or appending), with VALUE written exactly as given.
  - `SIGN_IN_STEPS` — the Xcode Accounts instructions string.
  - `list_teams` — prints `TEAMID<TAB>Name (Type)` per team, Personal Teams first; nothing when signed out.

- [ ] **Step 1: Write the failing tests**

Append to the setup tests section:

```bash
echo "phone.sh setup: Apple ID and Team ID"

new_setup_case
phone setup
assert_has "$OUT" "✓ Xcode is signed in to your Apple ID." "signed in is a tick"
assert_has "$OUT" "✓ Team ID A1B2C3D4E5 is set." "an existing team is kept"

new_setup_case
teams_plist >"$CASE/teams.plist.1"
answers ""
phone setup
assert_has "$CALLS" "open -a $CASE/Xcode.app" "opens Xcode"
assert_has "$OUT" "click Xcode in the menu bar" "says where to click"
assert_has "$OUT" "✓ Xcode is signed in to your Apple ID." "continues once signed in"

new_setup_case
rm -f "$CASE/Local.xcconfig"
phone setup
assert_has "$(cat "$CASE/Local.xcconfig")" "DEVELOPMENT_TEAM = A1B2C3D4E5" "writes the only team"
assert_has "$(cat "$CASE/Local.xcconfig")" "BUNDLE_ID_PREFIX = local.budget" "starts from the example file"
assert_eq "$(grep -c '^DEVELOPMENT_TEAM' "$CASE/Local.xcconfig")" 1 "one DEVELOPMENT_TEAM line"

new_setup_case
echo "DEVELOPMENT_TEAM =" >"$CASE/Local.xcconfig"
teams_plist "Z9Z9Z9Z9Z9|Example Org|Company|0" "A1B2C3D4E5|Test Person|Personal Team|1" >"$CASE/teams.plist"
answers "5" "1"
phone setup
assert_has "$OUT" "1) Test Person (Personal Team)  A1B2C3D4E5" "lists the personal team first"
assert_has "$OUT" "2) Example Org (Company)  Z9Z9Z9Z9Z9" "lists the other team"
assert_eq "$(sed -n 's/^DEVELOPMENT_TEAM = //p' "$CASE/Local.xcconfig")" "A1B2C3D4E5" "writes the picked team after a bad answer"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: the new Apple ID / Team ID assertions FAIL; everything else passes.

- [ ] **Step 3: Write the implementation**

In `ios/scripts/phone.sh`, after `setup_xcode`, add:

```bash
SIGN_IN_STEPS='In Xcode, click Xcode in the menu bar at the very top of the screen, then Settings…
Click Accounts. Click + at the bottom left, choose Apple ID, click Continue, and sign in.
You should see your name with "(Personal Team)".'

# Prints "TEAMID<TAB>Name (Type)" per team Xcode is signed in to, Personal
# Teams first. argv: a JSON file of Xcode's IDEProvisioningTeamByIdentifier.
# No single quotes in here: it lives in a '…' string.
TEAMS_JS='function run(argv) {
  var text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], 4, null);
  if (!text) return "";
  var byAccount = JSON.parse(text.js), seen = {}, teams = [];
  Object.keys(byAccount).forEach(function (k) {
    (byAccount[k] || []).forEach(function (t) {
      if (!t.teamID || seen[t.teamID]) return;
      seen[t.teamID] = true;
      teams.push(t);
    });
  });
  var personal = teams.filter(function (t) { return t.isFreeProvisioningTeam; });
  var others = teams.filter(function (t) { return !t.isFreeProvisioningTeam; });
  return personal.concat(others).map(function (t) {
    return t.teamID + "\t" + (t.teamName || "") + (t.teamType ? " (" + t.teamType + ")" : "");
  }).join("\n");
}'

list_teams() {
  local json="$STATE_DIR/teams.json"
  rm -f "$json"
  "$DEFAULTS" export com.apple.dt.Xcode - 2>>"$LOG" |
    plutil -extract IDEProvisioningTeamByIdentifier json -o "$json" - 2>/dev/null
  [ -s "$json" ] || return 0
  /usr/bin/osascript -l JavaScript -e "$TEAMS_JS" "$json" 2>>"$LOG"
}

# Sets KEY = VALUE in Local.xcconfig: every existing KEY line gets VALUE (so
# the last-line-wins reading sees it), or a new line goes at the end. VALUE
# is escaped for sed, so names like "Ann & Bo's iPhone" go in as typed.
set_xcconfig() {
  local value=$2 tmp="$LOCAL_XCCONFIG.tmp"
  value=${value//\\/\\\\}
  value=${value//&/\\&}
  value=${value//|/\\|}
  if grep -q "^[[:space:]]*$1[[:space:]]*=" "$LOCAL_XCCONFIG" 2>/dev/null; then
    sed "s|^[[:space:]]*$1[[:space:]]*=.*|$1 = $value|" "$LOCAL_XCCONFIG" >"$tmp"
  else
    { cat "$LOCAL_XCCONFIG" 2>/dev/null; echo "$1 = $2"; } >"$tmp"
  fi
  mv "$tmp" "$LOCAL_XCCONFIG"
}

setup_apple_id() {
  if [ -z "$(list_teams)" ]; then
    "$OPEN" -a "$XCODE_APP"
    while [ -z "$(list_teams)" ]; do
      say "$SIGN_IN_STEPS"
      press_return
    done
  fi
  say "✓ Xcode is signed in to your Apple ID."
}

setup_team() {
  [ -f "$LOCAL_XCCONFIG" ] || cp "$EXAMPLE_XCCONFIG" "$LOCAL_XCCONFIG"
  local have teams count line
  have=$(xcconfig_value DEVELOPMENT_TEAM)
  if [ -n "$have" ]; then
    say "✓ Team ID $have is set."
    return 0
  fi
  teams=$(list_teams)
  count=$(printf '%s\n' "$teams" | grep -c .)
  CHOICE=1
  if [ "$count" -gt 1 ]; then
    say "Xcode knows more than one team. Which one should sign the app?"
    printf '%s\n' "$teams" | awk -F'\t' '{ printf "  %d) %s  %s\n", NR, $2, $1 }'
    choose "$count"
  fi
  line=$(printf '%s\n' "$teams" | sed -n "${CHOICE}p")
  set_xcconfig DEVELOPMENT_TEAM "${line%%	*}"
  say "✓ Team ID ${line%%	*} is set."
}
```

(The `%%	*` patterns contain a literal TAB character between `%%` and `*`.)

In `cmd_setup`, after the Xcode line, add:

```bash
  heading 2 "Apple ID"; setup_apple_id || return 1
  heading 3 "Team ID"; setup_team || return 1
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
bash scripts/test-scrub.sh
git add ios/scripts/phone.sh scripts/test-phone-reinstall.sh
test "$(git branch --show-current)" = ios-phone-setup && git commit -m "phone.sh setup: Apple ID and Team ID steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: iPhone and install steps

**Files:**
- Modify: `ios/scripts/phone.sh` (new `phone_state`, `setup_phone`, `setup_install`; `cmd_install` and `resolve_phone` set `FAILURE`)
- Modify: `scripts/test-phone-reinstall.sh`

**Interfaces:**
- Consumes: `press_return`, `choose`, `heading`, `set_xcconfig`, `SIGN_IN_STEPS` (Tasks 2–3); `cmd_install`, `resolve_phone`, `devicectl`, `xcconfig_value`.
- Produces (used by Task 5):
  - `phone_state` — prints one of `none`, `unpaired`, `many` + newline-separated names, `devmode <name>`, `ready <core-id> <udid> <transport> <name>`, `ERR list`.
  - `setup_phone` — loops until `phone_state` is `ready`; sets `PHONE_NAME`.
  - `FAILURE` values set by `cmd_install`: `signed-out` (existing), `bundle-id`, `no-phone`.

- [ ] **Step 1: Write the failing tests**

Append:

```bash
echo "phone.sh setup: iPhone and install"

new_setup_case
phone setup
assert_has "$OUT" "✓ Found Test Phone." "a ready phone is a tick"
assert_has "$OUT" "Installed." "installs"

new_setup_case
DEVICES_FILE="$CASE/devices.json.1" devices
DEVICES_FILE="$CASE/devices.json.2" devices "$(phone_json "Test Phone" CORE-1 UDID-1 iPhone unpaired)"
DEVICES_FILE="$CASE/devices.json.3" devices "$(phone_json "Test Phone" CORE-1 UDID-1 iPhone paired wired disabled)"
answers "" "" ""
phone setup
assert_has "$OUT" "Plug your iPhone into this Mac" "no phone: plug it in"
assert_has "$OUT" "tap Trust" "unpaired: tap Trust"
assert_has "$OUT" "Privacy & Security → scroll to the bottom → Developer Mode" "Developer Mode off: where to turn it on"
assert_has "$OUT" "✓ Found Test Phone." "continues once ready"

new_setup_case
devices "$(phone_json "Old Phone" CORE-0 UDID-0)" "$(phone_json "Ann & Bo's iPhone" CORE-1 UDID-1)"
answers "2"
phone setup
assert_has "$OUT" "1) Old Phone" "lists every paired phone"
assert_has "$(cat "$CASE/Local.xcconfig")" "PHONE_DEVICE = Ann & Bo's iPhone" "writes the picked name exactly"
assert_has "$OUT" "✓ Found Ann & Bo's iPhone." "then uses it"
assert_has "$CALLS" "-destination id=UDID-1 " "builds for the picked phone"

new_setup_case
export STUB_BUILD_FAILS=1 STUB_BUILD_OUT="error: Failed Registering Bundle Identifier: The app identifier cannot be registered to your development team"
phone setup
assert_eq "$(grep -c '^xcodebuild build' "$CASE/calls")" 2 "builds again after the bundle ID is taken"
prefix=$(sed -n 's/^BUNDLE_ID_PREFIX = //p' "$CASE/Local.xcconfig")
case "$prefix" in local.budget.??????) pass "picks a prefix of its own";; *) fail "picks a prefix of its own" "got [$prefix]";; esac
assert_has "$OUT" "Installed." "then installs"

new_setup_case
export STUB_BUILD_FAILS=1 STUB_BUILD_OUT="error: No Accounts: Add a new account in Accounts settings."
answers ""
phone setup
assert_has "$OUT" "click Xcode in the menu bar" "signed out at build time: the sign-in steps"
assert_has "$OUT" "Installed." "then installs"

new_setup_case
export STUB_BUILD_RC=65 STUB_BUILD_OUT="error: something else"
phone setup
assert_fails "an unknown build failure stops setup"
assert_has "$OUT" "Build failed" "with the install's message"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: the new assertions FAIL; the rest pass.

- [ ] **Step 3: Write the implementation**

In `cmd_install`, add a case before `*)` in the build-failure `case "$output" in`:

```bash
      *"Failed Registering Bundle Identifier"*|*"cannot be registered to your development team"*)
        FAILURE=bundle-id
        say "The app's ID is already taken by someone else's app."
        log "install: build failed (bundle ID taken)" ;;
```

and in the `*"Unable to find a destination"*)` branch add `FAILURE=no-phone` as its first line. In `cmd_install`, change the first `resolve_phone` line to:

```bash
  resolve_phone || { FAILURE=no-phone; log "install: no phone"; return 1; }
```

After `setup_team`, add:

```bash
# What the Mac sees of the iPhone, for setup's waits. argv: the device-list
# JSON, then PHONE_DEVICE (may be empty). Prints none, unpaired, "many" then
# one name per line, "devmode <name>", or "ready <core> <udid> <transport>
# <name>". No single quotes in here: it lives in a '…' string.
STATE_JS='function run(argv) {
  var text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], 4, null);
  if (!text) return "ERR list";
  var want = argv[1];
  var all = JSON.parse(text.js).result.devices.filter(function (d) {
    return (d.hardwareProperties || {}).deviceType === "iPhone";
  });
  if (want) {
    all = all.filter(function (d) {
      var ids = [(d.deviceProperties || {}).name, d.identifier, d.hardwareProperties.udid];
      return ids.indexOf(want) >= 0;
    });
  }
  var paired = all.filter(function (d) {
    return (d.connectionProperties || {}).pairingState === "paired";
  });
  if (paired.length === 0) return all.length ? "unpaired" : "none";
  if (paired.length > 1) {
    return "many\n" + paired.map(function (d) { return d.deviceProperties.name; }).join("\n");
  }
  var p = paired[0], props = p.deviceProperties || {};
  if (props.developerModeStatus && props.developerModeStatus !== "enabled") return "devmode " + props.name;
  var transport = (p.connectionProperties || {}).transportType || "unknown";
  return "ready " + p.identifier + " " + p.hardwareProperties.udid + " " + transport + " " + props.name;
}'

phone_state() {
  local json="$STATE_DIR/devices.json"
  if ! devicectl list devices --json-output "$json" >>"$LOG" 2>&1; then
    echo "ERR list"
    return 0
  fi
  /usr/bin/osascript -l JavaScript -e "$STATE_JS" "$json" "$(xcconfig_value PHONE_DEVICE)" 2>>"$LOG"
}

DEVMODE_STEPS='On the iPhone: Settings → Privacy & Security → scroll to the bottom → Developer Mode → turn it on → Restart.
After it restarts, unlock it and tap Turn On.
(No Developer Mode there? Keep the phone plugged in and unlocked for a minute, then look again.)'

setup_phone() {
  local state names count want
  while :; do
    state=$(phone_state)
    case "$state" in
      ready*)
        PHONE_NAME=${state#ready * * * }
        say "✓ Found $PHONE_NAME."
        return 0 ;;
      none)
        want=$(xcconfig_value PHONE_DEVICE)
        say "Plug your iPhone into this Mac with a cable and unlock it."
        [ -z "$want" ] || say "(Looking for \"$want\", from PHONE_DEVICE in Config/Local.xcconfig.)" ;;
      unpaired)
        say "On the iPhone, tap Trust and enter your passcode. (No question on the phone? Unplug it and plug it in again.)" ;;
      many*)
        names=$(printf '%s\n' "$state" | sed 1d)
        count=$(printf '%s\n' "$names" | grep -c .)
        say "More than one iPhone has been paired with this Mac. Which one is yours?"
        printf '%s\n' "$names" | awk '{ printf "  %d) %s\n", NR, $0 }'
        choose "$count"
        set_xcconfig PHONE_DEVICE "$(printf '%s\n' "$names" | sed -n "${CHOICE}p")"
        continue ;;
      devmode*)
        say "$DEVMODE_STEPS" ;;
      *)
        say "Couldn't list devices. Details: $LOG"
        return 1 ;;
    esac
    press_return
  done
}

# cmd_install, but known failures are explained and retried. A taken bundle
# ID gets a prefix of its own, once.
setup_install() {
  local renamed=""
  while :; do
    FAILURE=""
    cmd_install && return 0
    case "$FAILURE" in
      signed-out)
        say "$SIGN_IN_STEPS"
        press_return ;;
      no-phone)
        say "Unlock the iPhone and keep it plugged in."
        press_return
        setup_phone || return 1 ;;
      bundle-id)
        [ -z "$renamed" ] || return 1
        renamed=1
        set_xcconfig BUNDLE_ID_PREFIX "local.budget.$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)"
        say "Trying again with an app ID of your own…" ;;
      *) return 1 ;;
    esac
  done
}
```

In `cmd_setup`, add:

```bash
  heading 4 "iPhone"; setup_phone || return 1
  heading 5 "Put the app on the iPhone"; setup_install || return 1
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: `N passed, 0 failed` (the existing install tests included: the `FAILURE` additions don't change their output).

- [ ] **Step 5: Commit**

```bash
bash scripts/test-scrub.sh
git add ios/scripts/phone.sh scripts/test-phone-reinstall.sh
test "$(git branch --show-current)" = ios-phone-setup && git commit -m "phone.sh setup: iPhone and install steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Connect, Wi-Fi and schedule steps

**Files:**
- Modify: `ios/scripts/phone.sh`
- Modify: `scripts/test-phone-reinstall.sh`

**Interfaces:**
- Consumes: `press_return`, `heading`, `phone_state`, `resolve_phone` (sets `PHONE_CORE`), `bundle_id`, `schedule_on`, `$TAILSCALE`, `$CURL`, `$TOKEN_FILE`, `$BUDGET_URL`, `$POLL_SECONDS`, `$POLL_TRIES`; Task 1's env keys `BUDGET_SETUP_SERVER` / `BUDGET_SETUP_TOKEN`.
- Produces: the finished `cmd_setup`.

- [ ] **Step 1: Write the failing tests**

Append:

```bash
echo "phone.sh setup: connect, Wi-Fi, schedule"

new_setup_case
phone setup
assert_eq "$RC" 0 "a fully set-up Mac and phone finish cleanly"
assert_has "$(cat "$CASE/calls.env")" "server=https://test-mac.example.ts.net token=tok-123" "the app gets the address and token"
assert_has "$CALLS" "device process launch --terminate-existing --device CORE-1 local.budget.BudgetPhone" "opens the app on the phone"
assert_lacks "$CALLS" "tok-123" "the token is never an argument"
assert_lacks "$(cat "$CASE/state/log")" "tok-123" "nor in the log"
assert_lacks "$OUT" "tok-123" "nor on screen"
assert_has "$OUT" "✓ The Mac sees your iPhone over Wi-Fi." "Wi-Fi is a tick"
[ -f "$CASE/agents/local.budget.phone-reinstall.plist" ] && pass "turns the schedule on" || fail "turns the schedule on" "no plist"
assert_has "$OUT" "All set. Budget is on your iPhone and opens until $(date -r $((NOW + 7 * DAY)) '+%A, %B %-d')." "ends with the last day"
assert_lacks "$CALLS" "sudo " "a re-run asks for no password"
assert_lacks "$CALLS" "open " "a re-run opens nothing"

new_setup_case
rm -f "$CASE/access-token"
export STUB_CURL_WRITES_TOKEN=tok-456
phone setup
assert_has "$CALLS" "curl -fsS -o /dev/null --max-time 10 http://127.0.0.1:3000/api/access/token" "asks Budget to make the token"
assert_has "$(cat "$CASE/calls.env")" "token=tok-456" "then hands it over"

new_setup_case
export STUB_LAUNCH_FAILS=1 STUB_LAUNCH_OUT="Unable to launch local.budget.BudgetPhone because it has an invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user."
answers ""
phone setup
assert_has "$OUT" "VPN & Device Management" "untrusted: where to trust it"
assert_eq "$(grep -c 'device process launch' "$CASE/calls")" 2 "launches again after Return"
assert_eq "$RC" 0 "then finishes"

new_setup_case
devices "$(phone_json "Test Phone" CORE-1 UDID-1 iPhone paired wired)"
DEVICES_FILE="$CASE/devices.json.6" devices "$(phone_json "Test Phone" CORE-1 UDID-1)"
answers ""
phone setup
assert_has "$OUT" "Unplug the cable." "asks to unplug"
assert_has "$OUT" "can't see the iPhone over Wi-Fi yet" "says when it isn't seen over Wi-Fi"
assert_has "$OUT" "✓ The Mac sees your iPhone over Wi-Fi." "continues once it is"
```

The Wi-Fi case relies on the list-call order in an otherwise done case:
call 1 is Step 4, call 2 is `resolve_phone` in the install, call 3 is
`resolve_phone` in Connect, then Step 7 polls (calls 4–5 with
`PHONE_POLL_TRIES=2`, then after Return call 6 is `devices.json.6`). If the implementation
order differs, renumber `devices.json.N` so the first `localNetwork` list
comes after the first "can't see" message, and note the order in a comment.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: the new assertions FAIL; the rest pass.

- [ ] **Step 3: Write the implementation**

After `setup_install`, add:

```bash
TRUST_STEPS='On the iPhone: Settings → General → VPN & Device Management.
Under Developer App, tap your Apple ID, then Trust, then Trust again.'

# Opens the app with this Mac's address and token in its environment
# (BUDGET_SETUP_SERVER / BUDGET_SETUP_TOKEN, read by SetupHandoff.swift).
# Through DEVICECTL_CHILD_ variables, not arguments, so the token never
# shows in the Mac's process list or the log.
setup_connect() {
  local name server token out
  name=$("$TAILSCALE" status --json 2>>"$LOG" | plutil -extract Self.DNSName raw -o - - 2>/dev/null)
  name=${name%.}
  if [ -z "$name" ]; then
    say "Couldn't read this Mac's Tailscale address. Is Tailscale signed in?"
    return 1
  fi
  server="https://$name"
  [ -s "$TOKEN_FILE" ] ||
    "$CURL" -fsS -o /dev/null --max-time 10 "$BUDGET_URL/api/access/token" >>"$LOG" 2>&1
  token=$(tr -d '[:space:]' <"$TOKEN_FILE" 2>/dev/null)
  if [ -z "$token" ]; then
    say "Couldn't read Budget's access token. Open Budget on this Mac, go to Settings → Remote Access, then run setup again."
    return 1
  fi
  while :; do
    resolve_phone || return 1
    if out=$(DEVICECTL_CHILD_BUDGET_SETUP_SERVER="$server" DEVICECTL_CHILD_BUDGET_SETUP_TOKEN="$token" \
        devicectl device process launch --terminate-existing --device "$PHONE_CORE" "$(bundle_id)" 2>&1); then
      echo "$out" >>"$LOG"
      say "✓ Budget opened on your iPhone with your Mac's address filled in."
      return 0
    fi
    echo "$out" >>"$LOG"
    case "$out" in
      *"explicitly trusted"*|*"invalid code signature"*) say "$TRUST_STEPS" ;;
      *[Ll]ocked*) say "Unlock the iPhone." ;;
      *)
        say "Couldn't open Budget on the iPhone. Details: $LOG"
        return 1 ;;
    esac
    press_return
  done
}

# Current Xcode reaches a paired phone over Wi-Fi by itself; this checks it
# does before the schedule depends on it.
setup_wifi() {
  local tries state
  say "Unplug the cable. Keep the iPhone unlocked and on the same Wi-Fi as this Mac."
  while :; do
    tries=0
    while [ "$tries" -lt "$POLL_TRIES" ]; do
      state=$(phone_state)
      case "$state" in
        "ready "*" localNetwork "*)
          say "✓ The Mac sees your iPhone over Wi-Fi."
          return 0 ;;
      esac
      tries=$((tries + 1))
      sleep "$POLL_SECONDS"
    done
    say "The Mac can't see the iPhone over Wi-Fi yet. Make sure both are on the same Wi-Fi and the phone is unlocked."
    press_return
  done
}

setup_finish() {
  schedule_on || return 1
  local expires
  expires=$(cat "$STATE_DIR/expires" 2>/dev/null)
  echo
  if [ -n "$expires" ]; then
    say "All set. Budget is on your iPhone and opens until $(date -r "$expires" '+%A, %B %-d')."
  else
    say "All set. Budget is on your iPhone."
  fi
  say "Your Mac puts it on again every few days by itself while it's awake and the phone is on the same Wi-Fi."
  log "setup: done"
}
```

In `cmd_setup`, add:

```bash
  heading 6 "Connect the app to this Mac"; setup_connect || return 1
  heading 7 "Wi-Fi and automatic updates"; setup_wifi || return 1
  setup_finish
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
bash scripts/test-scrub.sh
git add ios/scripts/phone.sh scripts/test-phone-reinstall.sh
test "$(git branch --show-current)" = ios-phone-setup && git commit -m "phone.sh setup: connect, Wi-Fi and schedule steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `ios/README.md`
- Modify: `README.md` (Step 9 section)
- Modify: `CHANGELOG.md` (`## Unreleased`)
- Modify: `ios/CLAUDE.md` (agent rule line)

**Interfaces:**
- Consumes: the finished `phone.sh setup` wording from Tasks 2–5 (quote its messages exactly where the guide shows them).

- [ ] **Step 1: Rewrite the top of `ios/README.md`**

Replace the Contents list with:

```markdown
## Contents

1. [What you need](#what-you-need)
2. [Set it up](#set-it-up)
3. [Keeping it working](#keeping-it-working)
4. [If something goes wrong](#if-something-goes-wrong)
5. [Doing it by hand](#doing-it-by-hand)
```

Keep **What you need** and the "7-day catch" note. Then, before the
current `## Step 1: Install Xcode`, add:

````markdown
## Set it up

Paste these two lines into Terminal, one at a time:

```bash
cd ~/Documents/budget/ios
```

```bash
bash scripts/phone.sh setup
```

It goes through seven steps. When a step is already done it shows a ✓ and
moves on. When it needs you, it says exactly what to do, then waits: do it,
come back to Terminal and press **Return**. You can stop at any time with
**Control-C** and paste the second line again later; it picks up where it
stopped.

What it will ask you to do:

1. **Xcode.** If it isn't installed, the App Store opens on it: click
   **Get**, then **Install**. It's a very big download (often an hour). Your
   Mac's password may be needed once afterwards; nothing shows while you
   type.
2. **Apple ID.** If Xcode isn't signed in, Xcode opens and setup tells you
   where to click to sign in with your Apple ID.
3. **Team ID.** Nothing to do: setup finds it. If your Apple ID has more
   than one team, it asks which one, by number.
4. **iPhone.** Plug it in with a cable and unlock it. Tap **Trust** if the
   phone asks. Then turn on **Developer Mode** (setup says where); the phone
   restarts.
5. **Putting the app on.** Takes a few minutes the first time. Nothing to do.
6. **Connecting.** The first time, the phone says the developer isn't
   trusted. Setup tells you where to tap **Trust**. Then Budget opens on the
   phone with your Mac's address and access token already filled in.
7. **Wi-Fi.** Unplug the cable, keep the phone unlocked on the same Wi-Fi as
   the Mac. Setup checks the Mac can still see it, and turns on automatic
   reinstalls.

✅ **You should see**, at the end:

```
All set. Budget is on your iPhone and opens until Saturday, October 17.
```

(Your date will be 7 days from today.)

❌ **If setup stops with** `Budget isn't running` or `Tailscale isn't …`:
do what it says (it names the step of the [main guide](../README.md)), then
paste the second line again.

## Keeping it working

Every 3 hours your Mac checks, and once the app has fewer than 5 of its 7
days left, it puts a freshly signed copy on the phone. On the phone,
**Settings → About** shows when it was installed and when it stops opening.
For this to work:

- the Mac has to be **awake and logged in**, and
- the iPhone has to be on the **same Wi-Fi** as the Mac.

If it keeps failing and the app is close to its 7 days, the Mac shows a
notification. Then paste `bash scripts/phone.sh install` (in
`~/Documents/budget/ios`).

| To… | Paste into Terminal (after `cd ~/Documents/budget/ios`) |
| --- | --- |
| Set up from the start, or check everything | `bash scripts/phone.sh setup` |
| Put the app on the phone right now | `bash scripts/phone.sh install` |
| Turn automatic reinstalls off | `bash scripts/phone.sh schedule off` |
| Turn them back on (also after moving the `budget` folder) | `bash scripts/phone.sh schedule on` |
| See what happened on each try | `open -e build/phone/log` |

- The schedule is one small file in `~/Library/LaunchAgents`, the only thing
  Budget keeps outside its folder. `schedule off` deletes it. It installs the
  code that's in your `budget` folder and never downloads anything itself.

## Doing it by hand

Setup does all of this for you. These are the same steps by hand, in case
you'd rather, or setup can't finish.
````

- [ ] **Step 2: Demote and fix the by-hand steps**

Under **Doing it by hand**, keep the current Steps 1–7 but change their
headings from `## Step N: …` to `### Step N: …` and fix every in-file link
to them (`#step-7-keep-it-working-past-7-days` etc. keep working because the
heading text is unchanged; check with `grep -n '](#' ios/README.md`).

In Step 7, replace sub-step 1 (the **Connect via network** checkbox) with:

```markdown
1. **Once, with the cable plugged in**, put the app on with ▶ in Xcode
   (Step 5). That pairs the phone. Then unplug the cable: current Xcode
   reaches a paired phone over Wi-Fi by itself.
```

and in its `No paired iPhone` ❌ line replace "do sub-step 1 again with the
cable plugged in" with "plug the phone in, unlock it, and press ▶ in Xcode
once". Remove the duplicated "That's it. Every 3 hours…" paragraph, the
bullet list and the command table that follow Step 7's sub-step 3 (they
moved to **Keeping it working**), keeping the line "Without the schedule,
put the app on again yourself at least once a week."

In **If something goes wrong**, change "(Step 5)" and "(Step 4)" to
"(setup's step 6)" and "(setup's step 4)".

- [ ] **Step 3: Main README, changelog, agent rules**

In `README.md`, under `## Step 9: The iPhone app (optional)`, replace
`**Follow the steps in [ios/README.md](ios/README.md).**` with:

```markdown
Install Xcode from the [Mac App Store](https://apps.apple.com/app/xcode/id497799835)
(a big download), then paste into Terminal:

```bash
cd ~/Documents/budget/ios && bash scripts/phone.sh setup
```

and follow what it says. The details are in [ios/README.md](ios/README.md).
```

In `CHANGELOG.md`, under `## Unreleased`, add:

```markdown
- iPhone app: `bash scripts/phone.sh setup` puts the app on a new iPhone step
  by step. It finds your Team ID, fills in your Mac's address and access
  token, and turns on automatic reinstalls; when it needs you it says
  exactly where to click and waits.
```

In `ios/CLAUDE.md`, change "Agents never run `install`, `auto` or
`schedule on` for real" to "Agents never run `setup`, `install`, `auto` or
`schedule on` for real".

- [ ] **Step 4: Check**

Run: `grep -n '](#' ios/README.md` and confirm every anchor matches a heading
(`grep -n '^#' ios/README.md`). Run `bash scripts/test-scrub.sh` and
`bash scripts/test-phone-reinstall.sh`. Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add ios/README.md README.md CHANGELOG.md ios/CLAUDE.md
test "$(git branch --show-current)" = ios-phone-setup && git commit -m "Docs: iPhone setup is one command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
