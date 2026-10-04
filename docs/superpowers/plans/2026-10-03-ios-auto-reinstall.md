# iPhone App Automatic Reinstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ios/scripts/phone.sh` builds the iPhone app and installs it on the paired phone over Wi-Fi, and a LaunchAgent repeats that so a free Apple ID's 7-day signature never runs out.

**Architecture:** One bash script with subcommands (`install`, `schedule on`, `schedule off`, plus the undocumented `auto` the schedule runs). It reads optional settings from `ios/Config/Local.xcconfig`, keeps its state in `ios/build/phone/`, and calls `xcodebuild`, `xcrun devicectl`, `osascript` and `launchctl`. Each of those (and every path it writes) can be swapped through an environment variable, so a shell test drives it with recording stubs.

**Tech Stack:** bash 3.2 (macOS `/bin/bash`), `xcodebuild`, `xcrun devicectl`, `osascript -l JavaScript` (JSON parsing), `launchctl`, `plutil` (test only).

**Spec:** `docs/superpowers/specs/2026-10-03-ios-auto-reinstall-design.md`

## Global Constraints

- Work in the `ios-auto-reinstall` worktree, branch `ios-auto-reinstall`. Every commit command first checks `test "$(git branch --show-current)" = ios-auto-reinstall`. Never commit or merge in the shared main checkout.
- All commands below run from the worktree's `budget-claude/` folder unless a step says otherwise.
- bash 3.2 only: no associative arrays, no `${var,,}`, no `mapfile`, no `|&`.
- No new dependencies. No `jq`, no Node in `phone.sh` (launchd's `PATH` is `/usr/bin:/bin:/usr/sbin:/sbin`).
- Writes stay inside `ios/build/phone/` and `ios/build/DerivedData-phone/` (both gitignored via `ios/.gitignore`'s `/build/`). The one exception is the LaunchAgent plist in `~/Library/LaunchAgents`, written only by `schedule on` and deleted by `schedule off`.
- The test never touches a real phone, real `launchctl`, or `~/Library/LaunchAgents`.
- Agents must not run `phone.sh install`, `phone.sh auto` or `phone.sh schedule on` for real. Those act on the owner's phone and login items. The owner does the real check (end of this plan).
- Public repo: no real device names, identifiers, Team IDs or `/Users/` paths in committed files. Fixtures use `Test Phone`, `CORE-1`, `UDID-1`. `bash scripts/test-scrub.sh` must pass before each commit.
- Never edit `ios/BudgetPhone.xcodeproj/project.pbxproj`.
- Fixed values from the spec: schedule every **10800** seconds; skip if the last success is under **2 days** old; notify if a run fails and the last success is **5 or more days** old or missing; build into `build/DerivedData-phone` with `-configuration Debug`; LaunchAgent file `<BUNDLE_ID_PREFIX>.phone-reinstall.plist`, prefix default `local.budget`.
- Notification title, verbatim: `Budget: couldn't update the iPhone app`. Body: `Unlock your iPhone on home Wi-Fi with the Mac awake. It stops opening <when>.` where `<when>` is `in about N days`, `in about 1 day`, or `soon`.

## File Structure

| File | Responsibility |
|---|---|
| `ios/scripts/phone.sh` (create) | The whole feature: settings, phone lookup, build + install, auto/notify, schedule |
| `scripts/test-phone-reinstall.sh` (create) | Stubbed test of every subcommand |
| `package.json` (modify) | Run the new test in `npm test` |
| `ios/Config/Local.example.xcconfig` (modify) | Document `PHONE_DEVICE` |
| `ios/README.md`, `README.md`, `ios/CLAUDE.md` (modify) | How to use it; agent rule |

### Environment overrides `phone.sh` honours

| Variable | Default | Test sets it to |
|---|---|---|
| `XCODEBUILD` | `xcodebuild` | stub |
| `DEVICECTL` | empty → runs `xcrun devicectl` | stub |
| `OSASCRIPT` | `osascript` (notifications only; JSON parsing always uses `/usr/bin/osascript`) | stub |
| `LAUNCHCTL` | `launchctl` | stub |
| `LAUNCH_AGENTS_DIR` | `$HOME/Library/LaunchAgents` | temp dir |
| `LOCAL_XCCONFIG` | `ios/Config/Local.xcconfig` | temp file |
| `PHONE_STATE_DIR` | `ios/build/phone` | temp dir |
| `PHONE_NOW` | `date +%s` | `1000000000` |

---

### Task 1: `phone.sh install` — find the phone, build, install

**Files:**
- Create: `ios/scripts/phone.sh`
- Create: `scripts/test-phone-reinstall.sh`
- Modify: `package.json` (the `"test"` script)
- Modify: `ios/Config/Local.example.xcconfig`

**Interfaces:**
- Produces (used by Tasks 2 and 3): in `phone.sh`, the globals `IOS`, `SELF`, `STATE_DIR`, `LOG`, `NOW`, `DAY`, `XCODEBUILD`, `OSASCRIPT`, `LAUNCHCTL`, `LAUNCH_AGENTS_DIR`; functions `say MSG`, `log MSG`, `devicectl ARGS…`, `xcconfig_value KEY` (prints the value or nothing), `resolve_phone` (sets `PHONE_CORE`, `PHONE_UDID`; returns 1 with a printed reason), `cmd_install` (returns 0 and writes `$STATE_DIR/last-success` = `$NOW` on success, 1 otherwise), `usage` (returns 2); a final `case "${1:-} ${2:-}" in … esac` dispatch.
- Produces (used by Tasks 2 and 3): in the test, `new_case`, `devices OBJ…`, `phone_json NAME CORE UDID [TYPE] [PAIRING]`, `phone ARGS…` (sets `OUT`, `RC`, `CALLS`), `assert_eq`, `assert_has`, `assert_lacks`, `assert_fails`, `assert_no_file`, constants `NOW`, `DAY`, `PHONE`, and a line `# Summary` that later tasks insert above.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-phone-reinstall.sh`:

```bash
#!/bin/bash
# Drives ios/scripts/phone.sh with stub xcodebuild, devicectl, osascript and
# launchctl, each of which records its arguments. No phone, no real build and
# no real LaunchAgent: every path the script writes is under a temp dir.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PHONE="$ROOT/ios/scripts/phone.sh"
PASS=0; FAIL=0
pass() { echo "  ok: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; echo "    $2"; FAIL=$((FAIL+1)); }
assert_has() { case "$1" in *"$2"*) pass "$3";; *) fail "$3" "expected to find: $2";; esac; }
assert_lacks() { case "$1" in *"$2"*) fail "$3" "should not contain: $2";; *) pass "$3";; esac; }
assert_eq() { if [ "$1" = "$2" ]; then pass "$3"; else fail "$3" "expected [$2], got [$1]"; fi; }
assert_fails() { if [ "$RC" -ne 0 ]; then pass "$1"; else fail "$1" "exit code was 0"; fi; }
assert_no_file() { if [ ! -e "$1" ]; then pass "$2"; else fail "$2" "$1 exists"; fi; }

SUITE_TMP=$(mktemp -d)
[ -n "$SUITE_TMP" ] || { echo "mktemp failed" >&2; exit 1; }
trap 'rm -rf "$SUITE_TMP"' EXIT

# Stubs. Each appends "<tool> <args>" to $STUB_CALLS.
STUBS="$SUITE_TMP/stubs"
mkdir -p "$STUBS"
cat >"$STUBS/xcodebuild" <<'EOF'
#!/bin/bash
echo "xcodebuild $*" >>"$STUB_CALLS"
exit "${STUB_BUILD_RC:-0}"
EOF
cat >"$STUBS/devicectl" <<'EOF'
#!/bin/bash
echo "devicectl $*" >>"$STUB_CALLS"
if [ "${1:-} ${2:-}" = "list devices" ]; then
  while [ $# -gt 0 ]; do
    [ "$1" = --json-output ] && cp "$STUB_DEVICES" "$2"
    shift
  done
  exit 0
fi
exit "${STUB_INSTALL_RC:-0}"
EOF
cat >"$STUBS/osascript" <<'EOF'
#!/bin/bash
echo "osascript $*" >>"$STUB_CALLS"
EOF
cat >"$STUBS/launchctl" <<'EOF'
#!/bin/bash
echo "launchctl $*" >>"$STUB_CALLS"
EOF
chmod +x "$STUBS"/*
export XCODEBUILD="$STUBS/xcodebuild" DEVICECTL="$STUBS/devicectl" \
       OSASCRIPT="$STUBS/osascript" LAUNCHCTL="$STUBS/launchctl"

DAY=86400
NOW=1000000000
export PHONE_NOW=$NOW

# One device entry shaped like `devicectl list devices --json-output`.
phone_json() {
  printf '{"identifier":"%s","deviceProperties":{"name":"%s"},"hardwareProperties":{"platform":"iOS","deviceType":"%s","udid":"%s"},"connectionProperties":{"pairingState":"%s"}}' \
    "$2" "$1" "${4:-iPhone}" "$3" "${5:-paired}"
}
# Replaces this case's device list with the given entries.
devices() {
  local IFS=,
  printf '{"result":{"devices":[%s]}}' "$*" >"$CASE/devices.json"
}
# A fresh state dir, LaunchAgents dir and empty Local.xcconfig, with one
# paired iPhone. Tests change any of it before calling `phone`.
new_case() {
  CASE=$(mktemp -d "$SUITE_TMP/case.XXXXXX")
  mkdir -p "$CASE/state" "$CASE/agents"
  : >"$CASE/calls"
  : >"$CASE/Local.xcconfig"
  devices "$(phone_json "Test Phone" CORE-1 UDID-1)"
  export PHONE_STATE_DIR="$CASE/state" LAUNCH_AGENTS_DIR="$CASE/agents" \
         LOCAL_XCCONFIG="$CASE/Local.xcconfig" STUB_CALLS="$CASE/calls" \
         STUB_DEVICES="$CASE/devices.json"
  unset STUB_BUILD_RC STUB_INSTALL_RC
}
phone() {
  OUT=$(bash "$PHONE" "$@" 2>&1); RC=$?
  CALLS=$(cat "$CASE/calls")
}

echo "phone.sh install"

new_case
phone install
assert_eq "$RC" 0 "install succeeds"
assert_eq "$(cat "$CASE/state/last-success" 2>/dev/null)" "$NOW" "records the time of the install"
assert_has "$CALLS" "-destination id=UDID-1 " "xcodebuild gets the hardware UDID"
assert_has "$CALLS" "-allowProvisioningUpdates" "xcodebuild may renew the free profile"
assert_has "$CALLS" "-derivedDataPath $ROOT/ios/build/DerivedData-phone " "builds into build/DerivedData-phone"
assert_has "$CALLS" "device install app --device CORE-1 " "devicectl installs to the CoreDevice identifier"
assert_has "$CALLS" "Debug-iphoneos/BudgetPhone.app" "installs the built app"
assert_eq "$(grep -oE '^(xcodebuild|devicectl device)' "$CASE/calls" | tr '\n' ' ')" \
  "xcodebuild devicectl device " "builds before installing"

new_case
export STUB_BUILD_RC=1
phone install
assert_fails "build failure fails"
assert_lacks "$CALLS" "device install" "build failure doesn't install"
assert_no_file "$CASE/state/last-success" "build failure records nothing"
assert_has "$OUT" "Build failed" "build failure says so"

new_case
export STUB_INSTALL_RC=1
phone install
assert_fails "install failure fails"
assert_no_file "$CASE/state/last-success" "install failure records nothing"
assert_has "$OUT" "Install failed" "install failure says so"

echo "picking the phone"

new_case
devices "$(phone_json "Test Phone" CORE-1 UDID-1)" "$(phone_json "Second Phone" CORE-2 UDID-2)"
phone install
assert_fails "two phones and no setting fails"
assert_has "$OUT" "PHONE_DEVICE" "two phones names the setting"
assert_lacks "$CALLS" "xcodebuild" "two phones doesn't build"

new_case
devices "$(phone_json "Test Phone" CORE-1 UDID-1)" "$(phone_json "Second Phone" CORE-2 UDID-2)"
echo "PHONE_DEVICE = Second Phone" >"$CASE/Local.xcconfig"
phone install
assert_eq "$RC" 0 "setting by name succeeds"
assert_has "$CALLS" "-destination id=UDID-2 " "setting by name builds for that phone"
assert_has "$CALLS" "--device CORE-2 " "setting by name installs on that phone"

new_case
devices "$(phone_json "Test Phone" CORE-1 UDID-1)" "$(phone_json "Second Phone" CORE-2 UDID-2)"
echo "PHONE_DEVICE = UDID-2" >"$CASE/Local.xcconfig"
phone install
assert_has "$CALLS" "--device CORE-2 " "setting by UDID picks that phone"

new_case
echo "PHONE_DEVICE = Nope" >"$CASE/Local.xcconfig"
phone install
assert_fails "setting that matches nothing fails"
assert_has "$OUT" "No paired iPhone matches PHONE_DEVICE" "says the setting matched nothing"

new_case
devices
phone install
assert_fails "no phones fails"
assert_has "$OUT" "No paired iPhone" "no phones says so"

new_case
devices "$(phone_json "Old Phone" CORE-3 UDID-3 iPhone unpaired)" \
        "$(phone_json "Tablet" CORE-4 UDID-4 iPad)" \
        "$(phone_json "Test Phone" CORE-1 UDID-1)"
phone install
assert_eq "$RC" 0 "unpaired phones and iPads are ignored"
assert_has "$CALLS" "--device CORE-1 " "uses the one paired iPhone"

echo "usage"

new_case
phone bogus
assert_eq "$RC" 2 "unknown command exits 2"
assert_has "$OUT" "usage" "unknown command prints usage"

# Summary
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: many `FAIL` lines (`phone.sh` doesn't exist yet; bash prints "No such file or directory"), ending in `0 passed` or close to it, exit code 1.

- [ ] **Step 3: Write `ios/scripts/phone.sh`**

```bash
#!/bin/bash
# Builds the iPhone app and installs it on the paired iPhone, and can schedule
# that to repeat. A free Apple ID signs the app for only 7 days, after which it
# stops opening; installing again from the Mac renews it and keeps its data.
# Design: docs/superpowers/specs/2026-10-03-ios-auto-reinstall-design.md.
#
#   bash scripts/phone.sh install        build and install now
#   bash scripts/phone.sh schedule on    reinstall automatically (a LaunchAgent)
#   bash scripts/phone.sh schedule off   stop that
#
# Every tool and path below can be swapped through the environment, so
# scripts/test-phone-reinstall.sh drives this without a phone or launchd.
set -uo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd -P)"
SELF="$IOS/scripts/phone.sh"
XCODEBUILD="${XCODEBUILD:-xcodebuild}"
DEVICECTL="${DEVICECTL:-}"
OSASCRIPT="${OSASCRIPT:-osascript}"
LAUNCHCTL="${LAUNCHCTL:-launchctl}"
LAUNCH_AGENTS_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
LOCAL_XCCONFIG="${LOCAL_XCCONFIG:-$IOS/Config/Local.xcconfig}"
STATE_DIR="${PHONE_STATE_DIR:-$IOS/build/phone}"
NOW="${PHONE_NOW:-$(date +%s)}"
LOG="$STATE_DIR/log"
DAY=86400

mkdir -p "$STATE_DIR"

say() { echo "$*"; }
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG"; }

# xcrun's devicectl, unless the test swaps in a stub.
devicectl() {
  if [ -n "$DEVICECTL" ]; then "$DEVICECTL" "$@"; else xcrun devicectl "$@"; fi
}

# The value of KEY in Local.xcconfig, or nothing. The last line wins, as in Xcode.
xcconfig_value() {
  [ -f "$LOCAL_XCCONFIG" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$LOCAL_XCCONFIG" |
    tail -n 1 | sed 's/[[:space:]]*$//'
}

# Picks the phone from devicectl's JSON device list. argv: the JSON file, then
# PHONE_DEVICE (may be empty). Prints "<coredevice-id> <udid>", or "ERR <n>"
# with how many phones matched, or "ERR list" if the file can't be read.
# The two identifiers differ: devicectl takes the CoreDevice one, xcodebuild
# the hardware UDID. No single quotes in here: it lives in a '…' string.
PICK_JS='function run(argv) {
  var text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], 4, null);
  if (!text) return "ERR list";
  var want = argv[1];
  var phones = JSON.parse(text.js).result.devices.filter(function (d) {
    var hw = d.hardwareProperties || {};
    var conn = d.connectionProperties || {};
    return hw.deviceType === "iPhone" && conn.pairingState === "paired";
  });
  if (want) {
    phones = phones.filter(function (d) {
      var ids = [(d.deviceProperties || {}).name, d.identifier, d.hardwareProperties.udid];
      return ids.indexOf(want) >= 0;
    });
  }
  if (phones.length !== 1) return "ERR " + phones.length;
  return phones[0].identifier + " " + phones[0].hardwareProperties.udid;
}'

# Sets PHONE_CORE and PHONE_UDID, or prints why it can't and returns 1.
resolve_phone() {
  local want json picked
  want=$(xcconfig_value PHONE_DEVICE)
  json="$STATE_DIR/devices.json"
  if ! devicectl list devices --json-output "$json" >>"$LOG" 2>&1; then
    say "Couldn't list devices: xcrun devicectl failed. Details: $LOG"
    return 1
  fi
  picked=$(/usr/bin/osascript -l JavaScript -e "$PICK_JS" "$json" "$want" 2>>"$LOG")
  case "$picked" in
    "" | "ERR list")
      say "Couldn't read the device list. Details: $LOG"
      return 1 ;;
    "ERR 0")
      if [ -n "$want" ]; then
        say "No paired iPhone matches PHONE_DEVICE = $want in Config/Local.xcconfig."
      else
        say "No paired iPhone. Pair it once with a cable in Xcode (Window → Devices and Simulators)."
      fi
      return 1 ;;
    ERR*)
      say "More than one paired iPhone. Set PHONE_DEVICE in Config/Local.xcconfig to the one to use."
      return 1 ;;
  esac
  PHONE_CORE=${picked%% *}
  PHONE_UDID=${picked#* }
}

# Builds whatever is checked out and installs it. A failed build leaves the
# installed app alone. Tool output goes to the log, not the terminal.
cmd_install() {
  log "install: start"
  resolve_phone || { log "install: no phone"; return 1; }
  say "Building for the iPhone…"
  if ! "$XCODEBUILD" build -project "$IOS/BudgetPhone.xcodeproj" -scheme BudgetPhone \
      -configuration Debug -destination "id=$PHONE_UDID" \
      -derivedDataPath "$IOS/build/DerivedData-phone" -allowProvisioningUpdates -quiet \
      >>"$LOG" 2>&1; then
    say "Build failed; the app on the phone is unchanged. Details: $LOG"
    log "install: build failed"
    return 1
  fi
  say "Installing…"
  if ! devicectl device install app --device "$PHONE_CORE" \
      "$IOS/build/DerivedData-phone/Build/Products/Debug-iphoneos/BudgetPhone.app" \
      >>"$LOG" 2>&1; then
    say "Install failed. Is the iPhone unlocked and on the same Wi-Fi as the Mac? Details: $LOG"
    log "install: install failed"
    return 1
  fi
  echo "$NOW" >"$STATE_DIR/last-success"
  say "Installed. The app opens for another 7 days."
  log "install: ok"
}

usage() {
  echo "usage: bash scripts/phone.sh install | schedule on | schedule off" >&2
  return 2
}

case "${1:-} ${2:-}" in
  "install ") cmd_install ;;
  *) usage ;;
esac
```

Then: `chmod +x ios/scripts/phone.sh`

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: every line `ok:`, final line `N passed, 0 failed`, exit code 0.

- [ ] **Step 5: Document `PHONE_DEVICE` and register the test**

Append to `ios/Config/Local.example.xcconfig`:

```
// Name or identifier of the iPhone that scripts/phone.sh installs on. Leave
// empty to use the only paired iPhone.
PHONE_DEVICE =
```

In `package.json`, in the `"test"` script, change `bash scripts/test-launcher.sh && ` to `bash scripts/test-launcher.sh && bash scripts/test-phone-reinstall.sh && `.

Run: `node -e 'JSON.parse(require("fs").readFileSync("package.json"))' && bash scripts/test-phone-reinstall.sh | tail -1 && bash scripts/test-scrub.sh | tail -1`
Expected: `… 0 failed` twice, no JSON error.

- [ ] **Step 6: Commit**

```bash
test "$(git branch --show-current)" = ios-auto-reinstall && \
git add ios/scripts/phone.sh scripts/test-phone-reinstall.sh package.json ios/Config/Local.example.xcconfig && \
git commit -m "phone.sh install: build and install the iPhone app without Xcode open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `phone.sh auto` — freshness check and expiry alert

**Files:**
- Modify: `ios/scripts/phone.sh` (add two functions above `usage`; add one dispatch line)
- Modify: `scripts/test-phone-reinstall.sh` (insert above the `# Summary` line)

**Interfaces:**
- Consumes: `cmd_install`, `log`, `STATE_DIR`, `NOW`, `DAY`, `OSASCRIPT`, `LOG` from Task 1; test helpers from Task 1.
- Produces: `cmd_auto` (returns 0 when skipped or installed, 1 on failure), dispatched as `phone.sh auto`. Task 3's LaunchAgent runs `phone.sh auto`.

- [ ] **Step 1: Write the failing tests**

Insert above `# Summary` in `scripts/test-phone-reinstall.sh`:

```bash
echo "phone.sh auto"

new_case
echo $((NOW - DAY)) >"$CASE/state/last-success"
phone auto
assert_eq "$RC" 0 "under 2 days exits cleanly"
assert_lacks "$CALLS" "xcodebuild" "under 2 days doesn't rebuild"

new_case
echo $((NOW - 2 * DAY)) >"$CASE/state/last-success"
phone auto
assert_eq "$RC" 0 "at 2 days reinstalls"
assert_has "$CALLS" "xcodebuild" "at 2 days rebuilds"
assert_eq "$(cat "$CASE/state/last-success")" "$NOW" "at 2 days records the new install"

new_case
phone auto
assert_has "$CALLS" "xcodebuild" "never installed: rebuilds"

echo "expiry alert"

new_case
echo $((NOW - 5 * DAY)) >"$CASE/state/last-success"
export STUB_INSTALL_RC=1
phone auto
assert_fails "failed run fails"
assert_has "$CALLS" "osascript -e display notification" "failure at 5 days notifies"
assert_has "$CALLS" "with title \"Budget: couldn't update the iPhone app\"" "notification title"
assert_has "$CALLS" "It stops opening in about 2 days." "5 days old: about 2 days left"
assert_eq "$(cat "$CASE/state/last-success")" "$((NOW - 5 * DAY))" "failure keeps the old time"

new_case
echo $((NOW - 6 * DAY)) >"$CASE/state/last-success"
export STUB_INSTALL_RC=1
phone auto
assert_has "$CALLS" "It stops opening in about 1 day." "6 days old: about 1 day left"

new_case
echo $((NOW - 6 * DAY - DAY / 2)) >"$CASE/state/last-success"
export STUB_INSTALL_RC=1
phone auto
assert_has "$CALLS" "It stops opening soon." "under a day left: soon"

new_case
export STUB_INSTALL_RC=1
phone auto
assert_has "$CALLS" "It stops opening soon." "never installed and failing: soon"

new_case
echo $((NOW - 3 * DAY)) >"$CASE/state/last-success"
export STUB_INSTALL_RC=1
phone auto
assert_lacks "$CALLS" "osascript" "failure under 5 days stays quiet"

new_case
echo $((NOW - 6 * DAY)) >"$CASE/state/last-success"
phone auto
assert_lacks "$CALLS" "osascript" "success never notifies"
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: the Task 1 cases still `ok`; the auto/alert cases `FAIL` (`auto` hits `usage`, exits 2, calls nothing). Exit code 1.

- [ ] **Step 3: Implement**

In `ios/scripts/phone.sh`, insert above `usage() {`:

```bash
# What the schedule runs. Reinstalls once the last install is 2 or more days
# old, which leaves about 5 days to retry before the 7-day signature runs out.
cmd_auto() {
  local last=""
  [ -f "$STATE_DIR/last-success" ] && last=$(cat "$STATE_DIR/last-success")
  if [ -n "$last" ] && [ $((NOW - last)) -lt $((2 * DAY)) ]; then
    return 0
  fi
  log "auto: reinstalling"
  cmd_install && return 0
  if [ -z "$last" ] || [ $((NOW - last)) -ge $((5 * DAY)) ]; then
    notify_failed "$last"
  fi
  return 1
}

# A macOS notification that the app is close to expiring. $1 is the time of
# the last good install, or empty if there never was one.
notify_failed() {
  local when="soon" left
  if [ -n "$1" ]; then
    left=$(( ($1 + 7 * DAY - NOW) / DAY ))
    if [ "$left" -eq 1 ]; then when="in about 1 day"
    elif [ "$left" -gt 1 ]; then when="in about $left days"
    fi
  fi
  log "auto: notified ($when)"
  "$OSASCRIPT" -e "display notification \"Unlock your iPhone on home Wi-Fi with the Mac awake. It stops opening $when.\" with title \"Budget: couldn't update the iPhone app\"" >>"$LOG" 2>&1
}
```

In the dispatch `case`, add below the `"install ")` line:

```bash
  "auto ") cmd_auto ;;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: all `ok`, `N passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
bash scripts/test-scrub.sh | tail -1 && \
test "$(git branch --show-current)" = ios-auto-reinstall && \
git add ios/scripts/phone.sh scripts/test-phone-reinstall.sh && \
git commit -m "phone.sh auto: reinstall when 2+ days old, warn when close to expiring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `phone.sh schedule on|off` — the LaunchAgent

**Files:**
- Modify: `ios/scripts/phone.sh` (add three functions above `usage`; add two dispatch lines)
- Modify: `scripts/test-phone-reinstall.sh` (insert above `# Summary`)

**Interfaces:**
- Consumes: `xcconfig_value`, `say`, `SELF`, `LOG`, `LAUNCHCTL`, `LAUNCH_AGENTS_DIR` from Task 1; `phone.sh auto` from Task 2.
- Produces: `phone.sh schedule on` / `phone.sh schedule off`, used in Task 4's docs.

- [ ] **Step 1: Write the failing tests**

Insert above `# Summary`:

```bash
echo "phone.sh schedule"

new_case
PLIST="$CASE/agents/local.budget.phone-reinstall.plist"
phone schedule on
assert_eq "$RC" 0 "schedule on succeeds"
if plutil -lint "$PLIST" >/dev/null 2>&1; then pass "writes a valid plist"; else fail "writes a valid plist" "$PLIST"; fi
assert_eq "$(plutil -extract Label raw "$PLIST" 2>/dev/null)" "local.budget.phone-reinstall" "default label"
assert_eq "$(plutil -extract ProgramArguments.0 raw "$PLIST" 2>/dev/null)" "/bin/bash" "runs bash"
assert_eq "$(plutil -extract ProgramArguments.1 raw "$PLIST" 2>/dev/null)" "$PHONE" "runs this phone.sh"
assert_eq "$(plutil -extract ProgramArguments.2 raw "$PLIST" 2>/dev/null)" "auto" "runs auto"
assert_eq "$(plutil -extract StartInterval raw "$PLIST" 2>/dev/null)" "10800" "every 3 hours"
assert_eq "$(plutil -extract RunAtLoad raw "$PLIST" 2>/dev/null)" "true" "runs at load"
assert_eq "$(plutil -extract StandardOutPath raw "$PLIST" 2>/dev/null)" "$CASE/state/log" "output to the log"
assert_eq "$(plutil -extract StandardErrorPath raw "$PLIST" 2>/dev/null)" "$CASE/state/log" "errors to the log"
assert_has "$CALLS" "launchctl bootstrap gui/$(id -u) $PLIST" "loads it"

phone schedule on
assert_eq "$RC" 0 "schedule on again succeeds"
assert_eq "$(ls "$CASE/agents" | wc -l | tr -d ' ')" "1" "schedule on again leaves one file"

phone schedule off
assert_eq "$RC" 0 "schedule off succeeds"
assert_no_file "$PLIST" "schedule off deletes the plist"
assert_has "$CALLS" "launchctl bootout gui/$(id -u)/local.budget.phone-reinstall" "unloads it"

phone schedule off
assert_eq "$RC" 0 "schedule off again succeeds"

new_case
echo "BUNDLE_ID_PREFIX = com.example" >"$CASE/Local.xcconfig"
phone schedule on
assert_eq "$(plutil -extract Label raw "$CASE/agents/com.example.phone-reinstall.plist" 2>/dev/null)" \
  "com.example.phone-reinstall" "label follows BUNDLE_ID_PREFIX"

new_case
phone schedule
assert_eq "$RC" 2 "schedule without on/off prints usage"
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: earlier cases `ok`; schedule cases `FAIL` (usage, no plist). Exit 1.

- [ ] **Step 3: Implement**

In `ios/scripts/phone.sh`, insert above `usage() {`:

```bash
# The LaunchAgent's name, unique per Apple ID the same way the bundle ID is.
agent_label() {
  local prefix
  prefix=$(xcconfig_value BUNDLE_ID_PREFIX)
  echo "${prefix:-local.budget}.phone-reinstall"
}

# The one file this app keeps outside its folder. It holds this checkout's
# path, so it is written here rather than committed; moving the folder means
# running this again. Safe to repeat.
schedule_on() {
  local label plist
  label=$(agent_label)
  plist="$LAUNCH_AGENTS_DIR/$label.plist"
  mkdir -p "$LAUNCH_AGENTS_DIR"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SELF</string><string>auto</string></array>
  <key>StartInterval</key><integer>10800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  "$LAUNCHCTL" bootout "gui/$(id -u)/$label" >/dev/null 2>&1
  if ! "$LAUNCHCTL" bootstrap "gui/$(id -u)" "$plist" >>"$LOG" 2>&1; then
    say "launchctl couldn't load $plist. Details: $LOG"
    return 1
  fi
  say "Scheduled. Every 3 hours the Mac reinstalls the app if it's 2 or more days old."
}

schedule_off() {
  local label
  label=$(agent_label)
  "$LAUNCHCTL" bootout "gui/$(id -u)/$label" >/dev/null 2>&1
  rm -f "$LAUNCH_AGENTS_DIR/$label.plist"
  say "Schedule removed."
}
```

In the dispatch `case`, add below the `"auto ")` line:

```bash
  "schedule on") schedule_on ;;
  "schedule off") schedule_off ;;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-phone-reinstall.sh`
Expected: all `ok`, `N passed, 0 failed`, exit 0. Also confirm nothing was written to the real agents dir: `ls ~/Library/LaunchAgents | grep phone-reinstall` prints nothing.

- [ ] **Step 5: Commit**

```bash
bash scripts/test-scrub.sh | tail -1 && \
test "$(git branch --show-current)" = ios-auto-reinstall && \
git add ios/scripts/phone.sh scripts/test-phone-reinstall.sh && \
git commit -m "phone.sh schedule on/off: a LaunchAgent that runs auto every 3 hours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs and the agent rule

**Files:**
- Modify: `ios/README.md` (the "**Every 7 days**" paragraph at the end of "Run on your iPhone (free Apple ID)")
- Modify: `README.md` (step 4 of "**iPhone app**")
- Modify: `ios/CLAUDE.md` ("Build and test" section)

**Interfaces:**
- Consumes: the commands from Tasks 1–3.

- [ ] **Step 1: `ios/README.md`**

Replace exactly:

```
**Every 7 days** a free signature expires and the app stops opening. Connect
the phone and press Run again; nothing on the phone is lost.
```

with:

````
### Reinstall automatically

A free Apple ID signs the app for 7 days; after that it stops opening until
it's installed again. Nothing on the phone is lost either way. The Mac can do
it on its own whenever the phone is on the same Wi-Fi:

1. Once, with the cable: Xcode → Window → Devices and Simulators, select the
   iPhone and tick **Connect via network**.
2. Check it works without Xcode:

   ```bash
   bash scripts/phone.sh install
   ```

3. Turn on the schedule:

   ```bash
   bash scripts/phone.sh schedule on
   ```

Every 3 hours the Mac checks, and if the app was installed 2 or more days ago
it builds and installs it again. That needs the Mac awake and logged in and
the iPhone on the same Wi-Fi. If it keeps failing and the app is close to
expiring, the Mac shows a notification. Each run is logged in
`build/phone/log`.

- More than one paired iPhone: set `PHONE_DEVICE` in `Config/Local.xcconfig`
  to the phone's name.
- Moved this folder: run `schedule on` again.
- To stop: `bash scripts/phone.sh schedule off`.

The schedule is one small file in `~/Library/LaunchAgents`, the only thing
this app keeps outside its folder; `schedule off` deletes it. It builds
whatever code is checked out and never pulls from GitHub.

Without the schedule, run `bash scripts/phone.sh install` (or connect the
phone and press Run in Xcode) at least once a week.
````

- [ ] **Step 2: `README.md`**

Replace exactly:

```
4. With a free Apple ID the app stops opening every 7 days. Connect the phone
   and press Run again; nothing on it is lost.
```

with:

```
4. With a free Apple ID the app stops opening every 7 days. Run
   `bash ios/scripts/phone.sh schedule on` once and the Mac reinstalls it over
   Wi-Fi on its own ([details](ios/README.md#reinstall-automatically)).
```

- [ ] **Step 3: `ios/CLAUDE.md`**

In "## Build and test", after the line `- Also run \`bash ../scripts/test-scrub.sh\` before committing. It scans this folder too.` add:

```
- `scripts/phone.sh` installs on the owner's real phone and adds a
  LaunchAgent. Agents never run `install`, `auto` or `schedule on` for real;
  its test is `bash ../scripts/test-phone-reinstall.sh` (stubs only).
```

- [ ] **Step 4: Verify**

Run: `bash scripts/test-phone-reinstall.sh | tail -1 && bash scripts/test-scrub.sh | tail -1 && grep -n "reinstall-automatically\|Reinstall automatically" README.md ios/README.md`
Expected: both `0 failed`; one hit in each README.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = ios-auto-reinstall && \
git add ios/README.md README.md ios/CLAUDE.md && \
git commit -m "Docs: reinstall the iPhone app automatically with phone.sh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Owner check (not for agents)

After merging, from the checkout that has `ios/Config/Local.xcconfig`:

1. Xcode → Window → Devices and Simulators → the iPhone → **Connect via network** is ticked. Unplug the cable.
2. `bash ios/scripts/phone.sh install` with the phone unlocked: it says "Installed." and the app still has its server and token.
3. Same again with the phone **locked**. Whether it installs or refuses decides if the README needs "unlocked" wording; either way the 3-hourly retry covers it.
4. `bash ios/scripts/phone.sh schedule on`, then `launchctl print gui/$(id -u)/local.budget.phone-reinstall | grep -E 'state|last exit'` shows it loaded. `build/phone/log` shows the `RunAtLoad` run skipped (just installed).
5. To test the alert: `echo $(( $(date +%s) - 6*86400 )) > ios/build/phone/last-success`, turn the phone's Wi-Fi off, run `bash ios/scripts/phone.sh auto`. A notification appears saying about 1 day. Then turn Wi-Fi back on and run `bash ios/scripts/phone.sh install`.
