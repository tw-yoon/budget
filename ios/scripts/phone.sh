#!/bin/bash
# Builds the iPhone app and installs it on the paired iPhone, and can schedule
# that to repeat. A free Apple ID signs the app for only 7 days, after which it
# stops opening; installing again from the Mac renews it and keeps its data.
# Renewing needs a new signature: Xcode reuses its saved provisioning profile
# until that runs out, so each install first sets the saved one aside.
# Design: docs/superpowers/specs/2026-10-03-ios-auto-reinstall-design.md.
#
#   bash scripts/phone.sh setup          first-time setup, step by step
#   bash scripts/phone.sh install        build and install now
#   bash scripts/phone.sh install --main the same, but only from a clean main
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
GIT="${GIT:-git}"
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
        say "No paired iPhone. Plug it in with a cable and run: bash scripts/phone.sh setup"
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
  resolve_phone || { FAILURE=no-phone; log "install: no phone"; return 1; }
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
      *"Failed Registering Bundle Identifier"*|*"cannot be registered to your development team"*)
        FAILURE=bundle-id
        say "The app's ID is already taken by someone else's app."
        log "install: build failed (bundle ID taken)" ;;
      *"is not installed"*|*"download and install the platform"*)
        FAILURE=no-platform
        say "Xcode is missing its iPhone parts."
        log "install: build failed (iOS platform missing)" ;;
      *"Unable to find a destination"*)
        FAILURE=no-phone
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

# True when this checkout is main with nothing uncommitted under ios/;
# otherwise sets NOT_MAIN to why.
on_clean_main() {
  local branch
  branch=$("$GIT" -C "$IOS" branch --show-current 2>/dev/null)
  if [ "$branch" != main ]; then
    NOT_MAIN="checkout is ${branch:-not a branch}, not main"
    return 1
  fi
  if [ -n "$("$GIT" -C "$IOS" status --porcelain -- . 2>/dev/null)" ]; then
    NOT_MAIN="main has uncommitted changes"
    return 1
  fi
}

# `install --main` (the Hub's Update iPhone button): install only a clean main.
cmd_install_main() {
  if ! on_clean_main; then
    say "Not installed: the Budget folder's $NOT_MAIN. Put it back on main with no uncommitted changes, then try again."
    log "install --main: refused ($NOT_MAIN)"
    return 1
  fi
  cmd_install
}

# What the schedule runs. Goes by the installed signature's expiry, not the
# last install: reinstalls once fewer than 5 days are left, which leaves
# about 5 days to retry. No recorded expiry (an older install) reinstalls now.
# Builds only a clean main: other work can be checked out here for a while,
# and it must not reach the phone unasked. A skip counts as a failed run, so
# the expiry alert still comes; the next run tries again.
cmd_auto() {
  local expires=""
  [ -f "$STATE_DIR/expires" ] && expires=$(cat "$STATE_DIR/expires")
  if [ -n "$expires" ] && [ $((expires - NOW)) -gt $((5 * DAY)) ]; then
    return 0
  fi
  if ! on_clean_main; then
    FAILURE=not-main
    log "auto: skipped ($NOT_MAIN)"
  else
    log "auto: reinstalling"
    cmd_install && return 0
  fi
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
  [ "${FAILURE:-}" = not-main ] && fix="Put the Budget folder back on main with no uncommitted changes."
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
  local xcode_tools="$XCODE_APP/Contents/Developer/usr/bin/xcodebuild"
  if [ ! -e "$xcode_tools" ]; then
    "$OPEN" "$APP_STORE_XCODE"
    say "The App Store is open on Xcode. Click Get, then Install."
    say "It's a very big download (often an hour). Leave this window open."
    press_return
    while [ ! -e "$xcode_tools" ]; do
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

SIGN_IN_STEPS='In Xcode, click Xcode in the menu bar at the very top of the screen, then Settings…
Click Accounts. Click + at the bottom left, choose Apple ID, click Continue, and sign in.
You should see your name with "(Personal Team)".'

# Prints "TEAMID<	>Name (Type)" per team Xcode is signed in to, Personal
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
    while :; do
      say "$SIGN_IN_STEPS"
      press_return
      [ -n "$(list_teams)" ] && break
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

# What the Mac sees of the iPhone, for setup's waits. argv: the device-list
# JSON, then PHONE_DEVICE (may be empty). Prints none, unpaired, "many" then
# "<identifier><tab><name>" per line, "unpaired <identifier>", "devmode <name>", or "ready <core> <udid> <transport>
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
  if (paired.length === 0) return all.length ? "unpaired " + all[0].identifier : "none";
  if (paired.length > 1) {
    return "many\n" + paired.map(function (d) { return d.identifier + "\t" + d.deviceProperties.name; }).join("\n");
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
  local state names count want line pick
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
      unpaired*)
        devicectl manage pair --device "${state#unpaired }" >>"$LOG" 2>&1
        say "On the iPhone, tap Trust and enter your passcode. (No question on the phone? Unplug it and plug it in again.)" ;;
      many*)
        names=$(printf '%s\n' "$state" | sed 1d)
        count=$(printf '%s\n' "$names" | grep -c .)
        say "More than one iPhone has been paired with this Mac. Which one is yours?"
        printf '%s\n' "$names" | awk -F'\t' '{ printf "  %d) %s\n", NR, $2 }'
        choose "$count"
        line=$(printf '%s\n' "$names" | sed -n "${CHOICE}p")
        pick=${line#*	}
        # A name shared by two phones can't tell them apart: use the identifier.
        if [ "$(printf '%s\n' "$names" | awk -F'\t' -v n="$pick" '$2 == n' | grep -c .)" -gt 1 ]; then
          pick=${line%%	*}
        fi
        set_xcconfig PHONE_DEVICE "$pick"
        continue ;;
      devmode*)
        "$OPEN" -a "$XCODE_APP"
        say "$DEVMODE_STEPS"
        say "Keep Xcode open while you do this." ;;
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
  local renamed="" fetched=""
  while :; do
    FAILURE=""
    cmd_install && return 0
    case "$FAILURE" in
      signed-out)
        "$OPEN" -a "$XCODE_APP"
        say "$SIGN_IN_STEPS"
        press_return ;;
      no-phone)
        say "Unlock the iPhone and keep it plugged in."
        press_return
        setup_phone || return 1 ;;
      no-platform)
        [ -z "$fetched" ] || return 1
        fetched=1
        say "Downloading the iPhone parts of Xcode… (this can take a while)"
        "$XCODEBUILD" -downloadPlatform iOS >>"$LOG" 2>&1 || return 1 ;;
      bundle-id)
        [ -z "$renamed" ] || return 1
        renamed=1
        set_xcconfig BUNDLE_ID_PREFIX "local.budget.$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)"
        say "Trying again with an app ID of your own…" ;;
      *) return 1 ;;
    esac
  done
}

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
  heading 2 "Apple ID"; setup_apple_id || return 1
  heading 3 "Team ID"; setup_team || return 1
  heading 4 "iPhone"; setup_phone || return 1
  heading 5 "Put the app on the iPhone"; setup_install || return 1
  heading 6 "Connect the app to this Mac"; setup_connect || return 1
  heading 7 "Wi-Fi and automatic updates"; setup_wifi || return 1
  setup_finish
}

usage() {
  echo "usage: bash scripts/phone.sh setup | install [--main] | schedule on | schedule off" >&2
  return 2
}

case "${1:-} ${2:-}" in
  "setup ") cmd_setup ;;
  "install ") cmd_install ;;
  "install --main") cmd_install_main ;;
  "auto ") cmd_auto ;;
  "schedule on") schedule_on ;;
  "schedule off") schedule_off ;;
  *) usage ;;
esac
