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

# Summary
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
