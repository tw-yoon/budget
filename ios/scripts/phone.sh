#!/bin/bash
# Builds the iPhone app and installs it on the paired iPhone, and can schedule
# that to repeat. A free Apple ID signs the app for only 7 days, after which it
# stops opening; installing again from the Mac renews it and keeps its data.
# Renewing needs a new signature: Xcode reuses its saved provisioning profile
# until that runs out, so each install first sets the saved one aside.
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
SHARED_XCCONFIG="${SHARED_XCCONFIG:-$IOS/Config/Shared.xcconfig}"
STATE_DIR="${PHONE_STATE_DIR:-$IOS/build/phone}"
PROFILES_DIR="${PHONE_PROFILES_DIR:-$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles}"
DERIVED="${PHONE_DERIVED_DATA:-$IOS/build/DerivedData-phone}"
APP="$DERIVED/Build/Products/Debug-iphoneos/BudgetPhone.app"
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

# The value of KEY in Local.xcconfig (or in the file given as $2), or nothing.
# The last line wins, as in Xcode.
xcconfig_value() {
  local file="${2:-$LOCAL_XCCONFIG}"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$file" |
    tail -n 1 | sed 's/[[:space:]]*$//'
}

# The app's bundle ID, as Shared.xcconfig builds it.
bundle_id() {
  local prefix
  prefix=$(xcconfig_value BUNDLE_ID_PREFIX)
  echo "${prefix:-local.budget}.BudgetPhone"
}

# One value from a provisioning profile. Real profiles are signed (CMS) with
# the plist inside; the tests' fixtures are the bare plist.
profile_value() {
  { security cms -D -i "$1" 2>/dev/null || cat "$1"; } | plutil -extract "$2" raw - 2>/dev/null
}

# "2026-10-09T07:59:27Z" → seconds since 1970.
iso_epoch() {
  date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null
}

# Moves Xcode's saved profiles for this app into $STATE_DIR/old-profiles, so
# the build has to ask Apple for a fresh 7-day one. Moved, not deleted: a
# build that fails (offline, signed out of Xcode) puts them back.
set_aside_profiles() {
  local f id want
  want=".$(bundle_id)"
  rm -rf "$STATE_DIR/old-profiles"
  mkdir -p "$STATE_DIR/old-profiles"
  for f in "$PROFILES_DIR"/*.mobileprovision; do
    [ -f "$f" ] || continue
    id=$(profile_value "$f" Entitlements.application-identifier)
    case "$id" in *"$want") mv "$f" "$STATE_DIR/old-profiles/" ;; esac
  done
}

restore_profiles() {
  local f
  for f in "$STATE_DIR/old-profiles"/*.mobileprovision; do
    [ -f "$f" ] && mv "$f" "$PROFILES_DIR/"
  done
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
  set_aside_profiles
  local logged
  logged=$(wc -c <"$LOG" 2>/dev/null || echo 0)
  if ! "$XCODEBUILD" build -project "$IOS/BudgetPhone.xcodeproj" -scheme BudgetPhone \
      -configuration Debug -destination "id=$PHONE_UDID" \
      -derivedDataPath "$DERIVED" -allowProvisioningUpdates -quiet \
      >>"$LOG" 2>&1; then
    restore_profiles
    # Only this build's output, not earlier runs in the same log.
    local output
    output=$(tail -c +$((logged + 1)) "$LOG")
    case "$output" in
      *"No Accounts"*|*"Failed to load credentials"*)
        FAILURE=signed-out
        say "Xcode isn't signed in to your Apple ID. Open Xcode → Settings → Accounts, add your Apple ID, then try again."
        log "install: build failed (Xcode signed out)" ;;
      *"Unable to find a destination"*)
        say "The Mac can't see your iPhone. Unlock it and put it on the same Wi-Fi as the Mac, then try again."
        log "install: build failed (phone not seen)" ;;
      *)
        say "Build failed; the app on the phone is unchanged. Details: $LOG"
        log "install: build failed" ;;
    esac
    return 1
  fi
  say "Installing…"
  if ! devicectl device install app --device "$PHONE_CORE" "$APP" \
      >>"$LOG" 2>&1; then
    say "Install failed. Is the iPhone unlocked and on the same Wi-Fi as the Mac? Details: $LOG"
    log "install: install failed"
    return 1
  fi
  echo "$NOW" >"$STATE_DIR/last-success"
  xcconfig_value MARKETING_VERSION "$SHARED_XCCONFIG" >"$STATE_DIR/version"
  rm -rf "$STATE_DIR/old-profiles"
  # The date the phone goes by: the signature inside what was just installed.
  local expires created
  expires=$(iso_epoch "$(profile_value "$APP/embedded.mobileprovision" ExpirationDate)")
  created=$(iso_epoch "$(profile_value "$APP/embedded.mobileprovision" CreationDate)")
  if [ -z "$expires" ]; then
    rm -f "$STATE_DIR/expires"
    say "Installed."
    log "install: ok (expiry unknown)"
    return 0
  fi
  echo "$expires" >"$STATE_DIR/expires"
  if [ -n "$created" ] && [ $((NOW - created)) -gt "$DAY" ]; then
    say "Installed, but Xcode reused an old signature: the app still stops opening $(date -r "$expires" '+%A, %B %-d')."
    log "install: ok (old signature)"
  else
    say "Installed. The app opens until $(date -r "$expires" '+%A, %B %-d')."
    log "install: ok"
  fi
}

# What the schedule runs. Goes by the installed signature's expiry, not the
# last install: reinstalls once fewer than 5 days are left, which leaves
# about 5 days to retry. No recorded expiry (an older install) reinstalls now.
cmd_auto() {
  local expires=""
  [ -f "$STATE_DIR/expires" ] && expires=$(cat "$STATE_DIR/expires")
  if [ -n "$expires" ] && [ $((expires - NOW)) -gt $((5 * DAY)) ]; then
    return 0
  fi
  log "auto: reinstalling"
  cmd_install && return 0
  if [ -z "$expires" ] || [ $((expires - NOW)) -le $((2 * DAY)) ]; then
    notify_failed "$expires"
  fi
  return 1
}

# A macOS notification that the app is close to expiring. $1 is when the
# installed signature runs out, or empty if that isn't known.
notify_failed() {
  local when="soon" left
  if [ -n "$1" ]; then
    left=$(( ($1 - NOW) / DAY ))
    if [ "$left" -eq 1 ]; then when="in about 1 day"
    elif [ "$left" -gt 1 ]; then when="in about $left days"
    fi
  fi
  local fix="Unlock your iPhone on home Wi-Fi with the Mac awake."
  [ "${FAILURE:-}" = signed-out ] && fix="Sign in to Xcode: Settings → Accounts."
  log "auto: notified ($when)"
  "$OSASCRIPT" -e "display notification \"$fix It stops opening $when.\" with title \"Budget: couldn't update the iPhone app\"" >>"$LOG" 2>&1
}

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
  say "Scheduled. Every 3 hours the Mac reinstalls the app once fewer than 5 days of its 7 are left."
}

schedule_off() {
  local label
  label=$(agent_label)
  "$LAUNCHCTL" bootout "gui/$(id -u)/$label" >/dev/null 2>&1
  rm -f "$LAUNCH_AGENTS_DIR/$label.plist"
  say "Schedule removed."
}

usage() {
  echo "usage: bash scripts/phone.sh install | schedule on | schedule off" >&2
  return 2
}

case "${1:-} ${2:-}" in
  "install ") cmd_install ;;
  "auto ") cmd_auto ;;
  "schedule on") schedule_on ;;
  "schedule off") schedule_off ;;
  *) usage ;;
esac
