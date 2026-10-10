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
# The build stub also leaves a built app whose embedded profile was signed at
# $STUB_SIGNED (default: now) for 7 days, unless STUB_NO_PROFILE is set.
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
if [ "${1:-} ${2:-}" = "manage pair" ]; then exit 0; fi
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
case "$*" in macappstore:*) [ -z "${STUB_OPEN_INSTALLS:-}" ] || { mkdir -p "$XCODE_APP/Contents/Developer/usr/bin"; touch "$XCODE_APP/Contents/Developer/usr/bin/xcodebuild"; } ;; esac
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
chmod +x "$STUBS"/*
export XCODEBUILD="$STUBS/xcodebuild" DEVICECTL="$STUBS/devicectl" \
       OSASCRIPT="$STUBS/osascript" LAUNCHCTL="$STUBS/launchctl"

DAY=86400
NOW=1000000000
export PHONE_NOW=$NOW

# One device entry shaped like `devicectl list devices --json-output`.
# Args: name, CoreDevice id, UDID, [deviceType], [pairingState],
# [transportType], [developerModeStatus].
phone_json() {
  printf '{"identifier":"%s","deviceProperties":{"name":"%s","developerModeStatus":"%s"},"hardwareProperties":{"platform":"iOS","deviceType":"%s","udid":"%s"},"connectionProperties":{"pairingState":"%s","transportType":"%s"}}' \
    "$2" "$1" "${7:-enabled}" "${4:-iPhone}" "$3" "${5:-paired}" "${6:-localNetwork}"
}
# Replaces this case's device list with the given entries. DEVICES_FILE
# picks another file, e.g. "$CASE/devices.json.1" for the first list only.
devices() {
  local IFS=,
  printf '{"result":{"devices":[%s]}}' "$*" >"${DEVICES_FILE:-$CASE/devices.json}"
}
# A fresh state dir, LaunchAgents dir and empty Local.xcconfig, with one
# paired iPhone. Tests change any of it before calling `phone`.
new_case() {
  CASE=$(mktemp -d "$SUITE_TMP/case.XXXXXX")
  mkdir -p "$CASE/state" "$CASE/agents" "$CASE/profiles"
  : >"$CASE/calls"
  : >"$CASE/Local.xcconfig"
  echo "MARKETING_VERSION = 4.5.6" >"$CASE/Shared.xcconfig"
  devices "$(phone_json "Test Phone" CORE-1 UDID-1)"
  export PHONE_STATE_DIR="$CASE/state" LAUNCH_AGENTS_DIR="$CASE/agents" \
         LOCAL_XCCONFIG="$CASE/Local.xcconfig" SHARED_XCCONFIG="$CASE/Shared.xcconfig" STUB_CALLS="$CASE/calls" \
         STUB_DEVICES="$CASE/devices.json" \
         PHONE_DERIVED_DATA="$CASE/dd" PHONE_PROFILES_DIR="$CASE/profiles"
  unset STUB_BUILD_RC STUB_BUILD_OUT STUB_INSTALL_RC STUB_SIGNED STUB_NO_PROFILE STUB_BUILD_FAILS STUB_LAUNCH_FAILS STUB_LAUNCH_OUT
}
# A saved Xcode profile for the given app ID, as a bare plist.
saved_profile() {
  printf '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Entitlements</key><dict><key>application-identifier</key><string>%s</string></dict></dict></plist>' \
    "$2" >"$CASE/profiles/$1.mobileprovision"
}
phone() {
  OUT=$(bash "$PHONE" "$@" 2>&1); RC=$?
  CALLS=$(cat "$CASE/calls")
}

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
  mkdir -p "$CASE/Xcode.app/Contents/Developer/usr/bin"
  touch "$CASE/Xcode.app/Contents/Developer/usr/bin/xcodebuild"
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

echo "phone.sh install"

new_case
phone install
assert_eq "$RC" 0 "install succeeds"
assert_eq "$(cat "$CASE/state/last-success" 2>/dev/null)" "$NOW" "records the time of the install"
assert_has "$CALLS" "-destination id=UDID-1 " "xcodebuild gets the hardware UDID"
assert_has "$CALLS" "-allowProvisioningUpdates" "xcodebuild may renew the free profile"
assert_has "$CALLS" "-derivedDataPath $CASE/dd " "builds into the derived-data folder"
assert_eq "$(cat "$CASE/state/version" 2>/dev/null)" "4.5.6" "records the installed version"
assert_eq "$(cat "$CASE/state/expires" 2>/dev/null)" "$((NOW + 7 * DAY))" "records when the new signature runs out"
assert_has "$OUT" "The app opens until $(date -r $((NOW + 7 * DAY)) '+%A, %B %-d')." "names the real last day"

echo "a fresh signature each install"

new_case
saved_profile old-budget "ABCDE12345.local.budget.BudgetPhone"
saved_profile other-app "ABCDE12345.com.example.Other"
phone install
assert_no_file "$CASE/profiles/old-budget.mobileprovision" "this app's saved profile is set aside"
[ -f "$CASE/profiles/other-app.mobileprovision" ] && pass "other apps' profiles stay" || fail "other apps' profiles stay" "removed"
assert_no_file "$CASE/state/old-profiles" "the set-aside copy goes once the install worked"

new_case
saved_profile old-budget "ABCDE12345.local.budget.BudgetPhone"
export STUB_BUILD_RC=1
phone install
[ -f "$CASE/profiles/old-budget.mobileprovision" ] && pass "a failed build puts the profile back" \
  || fail "a failed build puts the profile back" "missing"

new_case
echo "BUNDLE_ID_PREFIX = com.example" >"$CASE/Local.xcconfig"
saved_profile mine "ABCDE12345.com.example.BudgetPhone"
saved_profile default "ABCDE12345.local.budget.BudgetPhone"
phone install
assert_no_file "$CASE/profiles/mine.mobileprovision" "matches the app ID from BUNDLE_ID_PREFIX"
[ -f "$CASE/profiles/default.mobileprovision" ] && pass "leaves the default ID's profile alone" || fail "leaves the default ID's profile alone" "removed"

new_case
export STUB_SIGNED=$((NOW - 5 * DAY))
phone install
assert_has "$OUT" "Xcode reused an old signature" "says when the signature wasn't renewed"
assert_eq "$(cat "$CASE/state/expires")" "$((NOW + 2 * DAY))" "and records the old expiry"

new_case
export STUB_NO_PROFILE=1
phone install
assert_eq "$RC" 0 "no profile in the app still installs"
assert_no_file "$CASE/state/expires" "and records no expiry"
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
assert_no_file "$CASE/state/version" "build failure records no version"
assert_has "$OUT" "Build failed" "build failure says so"

new_case
export STUB_BUILD_RC=65 STUB_BUILD_OUT="error: No Accounts: Add a new account in Accounts settings."
phone install
assert_fails "signed-out Xcode fails"
assert_has "$OUT" "Xcode isn't signed in to your Apple ID. Open Xcode → Settings → Accounts, add your Apple ID, then try again." "signed-out Xcode says how to fix it"
assert_lacks "$OUT" "Build failed" "and not the generic message"
assert_has "$(cat "$CASE/state/log")" "install: build failed (Xcode signed out)" "the log names the cause"

new_case
export STUB_BUILD_RC=70 STUB_BUILD_OUT="xcodebuild: error: Unable to find a destination matching the provided destination specifier:"
phone install
assert_has "$OUT" "The Mac can't see your iPhone. Unlock it and put it on the same Wi-Fi as the Mac, then try again." "an unseen phone says so"

new_case
echo "earlier run: error: No Accounts" >"$CASE/state/log"
export STUB_BUILD_RC=1
phone install
assert_has "$OUT" "Build failed" "only this run's output decides the message"

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
assert_has "$OUT" "Plug it in with a cable and run: bash scripts/phone.sh setup" "no phones says how to pair"

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

echo "phone.sh auto"

new_case
echo $((NOW + 6 * DAY)) >"$CASE/state/expires"
phone auto
assert_eq "$RC" 0 "more than 5 days left exits cleanly"
assert_lacks "$CALLS" "xcodebuild" "more than 5 days left doesn't rebuild"

new_case
echo $((NOW + 5 * DAY)) >"$CASE/state/expires"
phone auto
assert_eq "$RC" 0 "5 days left reinstalls"
assert_has "$CALLS" "xcodebuild" "5 days left rebuilds"
assert_eq "$(cat "$CASE/state/expires")" "$((NOW + 7 * DAY))" "5 days left records the new expiry"

new_case
echo $((NOW - DAY)) >"$CASE/state/last-success"
phone auto
assert_has "$CALLS" "xcodebuild" "an install with no recorded expiry rebuilds, however recent"

echo "expiry alert"

new_case
echo $((NOW + 2 * DAY)) >"$CASE/state/expires"
export STUB_INSTALL_RC=1
phone auto
assert_fails "failed run fails"
assert_has "$CALLS" "osascript -e display notification" "failure with 2 days left notifies"
assert_has "$CALLS" "with title \"Budget: couldn't update the iPhone app\"" "notification title"
assert_has "$CALLS" "It stops opening in about 2 days." "2 days left: about 2 days"
assert_eq "$(cat "$CASE/state/expires")" "$((NOW + 2 * DAY))" "failure keeps the old expiry"

new_case
echo $((NOW + 2 * DAY)) >"$CASE/state/expires"
export STUB_BUILD_RC=65 STUB_BUILD_OUT="error: No Accounts: Add a new account in Accounts settings."
phone auto
assert_has "$CALLS" "Sign in to Xcode: Settings → Accounts. It stops opening in about 2 days." "a signed-out Xcode notification says to sign in"

new_case
echo $((NOW + DAY)) >"$CASE/state/expires"
export STUB_INSTALL_RC=1
phone auto
assert_has "$CALLS" "It stops opening in about 1 day." "1 day left: about 1 day"

new_case
echo $((NOW + DAY / 2)) >"$CASE/state/expires"
export STUB_INSTALL_RC=1
phone auto
assert_has "$CALLS" "It stops opening soon." "under a day left: soon"

new_case
export STUB_INSTALL_RC=1
phone auto
assert_has "$CALLS" "It stops opening soon." "expiry unknown and failing: soon"

new_case
echo $((NOW + 4 * DAY)) >"$CASE/state/expires"
export STUB_INSTALL_RC=1
phone auto
assert_lacks "$CALLS" "osascript" "failure with more than 2 days left stays quiet"

new_case
echo $((NOW + DAY)) >"$CASE/state/expires"
phone auto
assert_lacks "$CALLS" "osascript" "success never notifies"

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
rm -rf "$CASE/Xcode.app/Contents"
answers ""
phone setup
assert_has "$OUT" "Click Get, then Install" "a half-installed Xcode.app counts as not installed"
assert_eq "$RC" 3 "and waits until the real tools are there"

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
assert_has "$CALLS" "devicectl manage pair --device CORE-1" "unpaired: asks the phone to pair"
assert_has "$CALLS" "open -a $CASE/Xcode.app" "Developer Mode off: opens Xcode"
assert_has "$OUT" "Keep Xcode open while you do this." "and says to keep it open"

new_setup_case
devices "$(phone_json "Old Phone" CORE-0 UDID-0)" "$(phone_json "Ann & Bo's iPhone" CORE-1 UDID-1)"
answers "2"
phone setup
assert_has "$OUT" "1) Old Phone" "lists every paired phone"
assert_has "$(cat "$CASE/Local.xcconfig")" "PHONE_DEVICE = Ann & Bo's iPhone" "writes the picked name exactly"
assert_has "$OUT" "✓ Found Ann & Bo's iPhone." "then uses it"
assert_has "$CALLS" "-destination id=UDID-1 " "builds for the picked phone"

new_setup_case
devices "$(phone_json "Test Phone" CORE-1 UDID-1)" "$(phone_json "Test Phone" CORE-2 UDID-2)"
answers "2"
phone setup
assert_eq "$(sed -n 's/^PHONE_DEVICE = //p' "$CASE/Local.xcconfig")" "CORE-2" "same-name phones: writes the identifier"
assert_has "$OUT" "✓ Found Test Phone." "and setup goes on"
assert_has "$CALLS" "-destination id=UDID-2 " "builds for the picked one"

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
assert_has "$CALLS" "open -a $CASE/Xcode.app" "signed out at build time: opens Xcode"
assert_has "$OUT" "Installed." "then installs"

new_setup_case
export STUB_BUILD_FAILS=1 STUB_BUILD_OUT="error: iOS 26.0 is not installed. To use with Xcode, first download and install the platform"
phone setup
assert_has "$CALLS" "xcodebuild -downloadPlatform iOS" "missing iOS platform: downloads it"
assert_eq "$(grep -c '^xcodebuild build' "$CASE/calls")" 2 "and builds again"
assert_has "$OUT" "Installed." "then installs"

new_setup_case
export STUB_BUILD_RC=65 STUB_BUILD_OUT="error: something else"
phone setup
assert_fails "an unknown build failure stops setup"
assert_has "$OUT" "Build failed" "with the install's message"

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

# Device-list call order in an otherwise done case: 1 is Step 4, 2 is the
# install's resolve_phone, 3 is Connect's, 4-5 are Step 7's polls
# (PHONE_POLL_TRIES=2), 6 is the poll after Return.
new_setup_case
devices "$(phone_json "Test Phone" CORE-1 UDID-1 iPhone paired wired)"
DEVICES_FILE="$CASE/devices.json.6" devices "$(phone_json "Test Phone" CORE-1 UDID-1)"
answers ""
phone setup
assert_has "$OUT" "Unplug the cable." "asks to unplug"
assert_has "$OUT" "can't see the iPhone over Wi-Fi yet" "says when it isn't seen over Wi-Fi"
assert_has "$OUT" "✓ The Mac sees your iPhone over Wi-Fi." "continues once it is"

# Summary
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
