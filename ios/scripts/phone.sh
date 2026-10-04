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
