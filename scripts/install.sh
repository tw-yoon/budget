#!/bin/bash
# Budget one-paste installer for a Mac. Paste this into Terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/tw-yoon/budget/main/scripts/install.sh | bash
#
# It installs what Budget needs (the command line tools, Node.js), downloads
# Budget into ~/Documents/budget, asks for your Plaid keys, and starts it.
# Every step checks first and skips itself if it's already done, so pasting
# the line again is always safe.
#
# Everything lives in functions, and the only top-level statement is the
# `main "$@"; exit $?` call on the last line. Under `curl | bash`, bash runs
# the script as it arrives; if the download is cut off part-way, a script with
# top-level commands would run whatever half of it made it through. Here a cut
# anywhere before the last line leaves main() defined but never called, so
# nothing runs at all.
#
# Settings, for tests (a real install never needs them):
#   BUDGET_DIR        where Budget goes (default ~/Documents/budget)
#   BUDGET_REPO       what to clone
#   BUDGET_TTY        where answers are read from (default /dev/tty)
#   BUDGET_NODE_MAJOR, BUDGET_NODE_DIST, BUDGET_NODE_BIN   which Node.js, from where
#   BUDGET_CLT_WAIT_SECS, BUDGET_POLL_SECS   how long to wait for the tools
#   BUDGET_INSTALL_SKIP_LAUNCH=1   print the launch command instead of running it

# Only stopping messages get the ❌, so the one line that matters stands out
# in a Terminal full of download output.
stop() {
  echo
  echo "❌ $*"
  exit 1
}

node_major() {
  local v
  v=$(node --version 2>/dev/null) || return 1
  v=${v#v}
  v=${v%%.*}
  case "$v" in ''|*[!0-9]*) return 1 ;; esac
  echo "$v"
}

node_ok() {
  local major
  major=$(node_major) || return 1
  [ "$major" -ge 20 ]
}

check_mac() {
  [ "$(uname -s 2>/dev/null)" = "Darwin" ] || stop "This installer only works on a Mac."
}

# Questions are read from the keyboard, not from stdin: under `curl | bash`,
# stdin is the script itself, and a `read` from it would swallow the next
# lines of code instead of the person's answer. Opened up front so a run that
# can't ask anything stops before it installs anything.
open_keyboard() {
  if ! { exec 3<"$BUDGET_TTY"; } 2>/dev/null; then
    stop "This installer needs to ask you a couple of questions. Open the Terminal app, paste this line into Terminal, and press Return."
  fi
}

# The command line tools bring git. `xcode-select --install` only opens
# Apple's install window and returns at once, so poll for the result. Its own
# exit status is ignored: it fails when an install is already in progress,
# which is just as good a reason to wait.
ensure_tools() {
  if xcode-select -p >/dev/null 2>&1; then
    echo "✅ Command line tools are installed."
  else
    xcode-select --install >/dev/null 2>&1
    echo
    echo "A window will ask to install the command line developer tools. Click Install"
    echo "(not Get Xcode), then Agree. This can take 5 to 15 minutes; this window waits for it."
    local waited=0 step="$BUDGET_POLL_SECS"
    # A zero poll interval would never add up to the deadline.
    [ "$step" -ge 1 ] 2>/dev/null || step=1
    until xcode-select -p >/dev/null 2>&1; do
      if [ "$waited" -ge "$BUDGET_CLT_WAIT_SECS" ]; then
        stop "The command line tools aren't installed yet. Finish that install (or run 'xcode-select --install' to open the window again), then paste this line again."
      fi
      sleep "$BUDGET_POLL_SECS"
      waited=$((waited + step))
    done
    echo "✅ Command line tools are installed."
  fi
  git --version >/dev/null 2>&1 || stop "Git isn't working even though the command line tools are installed. Restart your Mac, then paste this line again."
}

cleanup_download() {
  [ -n "${NODE_TMP:-}" ] && rm -rf "$NODE_TMP"
  NODE_TMP=""
}

# The official .pkg, checked against the SHASUMS256.txt published next to it,
# then installed with `sudo installer` (the Mac asks for its password in
# Terminal). Every failure ends in the same instruction: the manual route
# works no matter which part of this went wrong.
ensure_node() {
  if node_ok; then
    echo "✅ Node.js $(node --version 2>/dev/null) is installed."
    return 0
  fi

  echo
  echo "Downloading Node.js $BUDGET_NODE_MAJOR…"
  local sums line sha name got
  sums=$(curl -fsSL "$BUDGET_NODE_DIST/SHASUMS256.txt") || stop "$NODE_HELP"
  line=$(printf '%s\n' "$sums" | grep -E "[[:space:]]node-v$BUDGET_NODE_MAJOR\.[0-9.]+\.pkg\$" | head -1)
  sha=${line%%[[:space:]]*}
  name=${line##*[[:space:]]}
  [ -n "$line" ] && [ -n "$sha" ] && [ -n "$name" ] || stop "$NODE_HELP"

  # An explicit template: macOS's bare `mktemp -d` ignores TMPDIR.
  NODE_TMP=$(mktemp -d "${TMPDIR:-/tmp}/budget-node.XXXXXX") || stop "$NODE_HELP"
  trap cleanup_download EXIT
  curl -fsSL -o "$NODE_TMP/$name" "$BUDGET_NODE_DIST/$name" || stop "$NODE_HELP"
  got=$(shasum -a 256 "$NODE_TMP/$name" 2>/dev/null) || stop "$NODE_HELP"
  [ "${got%%[[:space:]]*}" = "$sha" ] || stop "$NODE_HELP"

  echo
  echo "Your Mac will ask for its password to install Node.js. Nothing shows while you type; that's normal."
  sudo installer -pkg "$NODE_TMP/$name" -target / || stop "$NODE_HELP"
  cleanup_download

  # The .pkg installs into /usr/local/bin, which may come after an older node
  # on PATH (or not be on it at all). `hash -r` drops bash's remembered
  # location of the old one.
  export PATH="$BUDGET_NODE_BIN:$PATH"
  hash -r
  node_ok || stop "$NODE_HELP"
  echo "✅ Node.js $(node --version 2>/dev/null) is installed."
}

# A folder that is already Budget is kept (and updated on launch); anything
# else by that name belongs to the person, so it is left exactly as found.
is_budget_clone() {
  [ -f "$BUDGET_DIR/Budget.command" ] || return 1
  local top here
  top=$(git -C "$BUDGET_DIR" rev-parse --show-toplevel 2>/dev/null) || return 1
  here=$(cd "$BUDGET_DIR" && pwd -P) || return 1
  [ "$(cd "$top" && pwd -P)" = "$here" ]
}

ensure_clone() {
  if [ -e "$BUDGET_DIR" ]; then
    is_budget_clone || stop "There's already a folder at $BUDGET_DIR that isn't Budget. Rename or move it, then paste this line again."
    EXISTING=true
    echo "✅ Budget is already in $BUDGET_DIR."
    return 0
  fi
  echo
  echo "Downloading Budget into $BUDGET_DIR…"
  mkdir -p "$(dirname "$BUDGET_DIR")" || stop "Couldn't create $(dirname "$BUDGET_DIR"). Paste this line again."
  GIT_TERMINAL_PROMPT=0 git clone -q "$BUDGET_REPO" "$BUDGET_DIR" </dev/null \
    || stop "Couldn't download Budget. Check your internet connection, then paste this line again."
  EXISTING=false
  echo "✅ Budget is downloaded."
}

env_value() {
  local v
  v=$(grep -E "^$1=" "$ENV_FILE" | head -1)
  v=${v#*=}
  v=$(printf '%s' "$v" | tr -d " \t\r\"'")
  printf '%s' "$v"
}

# Reads one key from the keyboard. Paste-friendly: `read` without IFS= trims
# the spaces a copy from a web page tends to bring along at either end.
# Plaid's keys are letters and digits only, so anything else (a space in the
# middle, half of the next field) is a bad paste, caught here rather than as
# a confusing error inside Budget later.
ask_key() {
  local prompt="$1" hidden="$2" tries=0 value=""
  while [ "$tries" -lt 3 ]; do
    tries=$((tries + 1))
    printf '%s' "$prompt"
    value=""
    if [ "$hidden" = hidden ]; then
      read -r -s -u 3 value
      echo
    else
      read -r -u 3 value
    fi
    case "$value" in
      ''|*[!A-Za-z0-9]*) echo "That doesn't look right. Plaid keys are only letters and numbers. Copy it again and paste it." ;;
      *) ANSWER="$value"; return 0 ;;
    esac
  done
  stop "Couldn't read your Plaid keys. Copy them again from dashboard.plaid.com, then paste this line again."
}

# Same temp-file-then-mv as Budget.command's bootstrap_env, so an interrupted
# write can't leave a half-written .env.local. Values travel through the
# environment, not awk's arguments, so the secret never shows up in `ps`.
write_keys() {
  local tmp="$ENV_FILE.tmp.$$"
  if ! PLAID_ID_VALUE="$1" PLAID_SECRET_VALUE="$2" LC_ALL=C awk '
      BEGIN { id = ENVIRON["PLAID_ID_VALUE"]; secret = ENVIRON["PLAID_SECRET_VALUE"] }
      /^PLAID_CLIENT_ID=/ { print "PLAID_CLIENT_ID=" id; seen_id = 1; next }
      /^PLAID_SECRET=/    { print "PLAID_SECRET=" secret; seen_secret = 1; next }
      { print }
      END {
        if (!seen_id) print "PLAID_CLIENT_ID=" id
        if (!seen_secret) print "PLAID_SECRET=" secret
      }' "$ENV_FILE" > "$tmp"; then
    rm -f "$tmp"
    stop "Couldn't save your Plaid keys into $ENV_FILE. Paste this line again."
  fi
  mv "$tmp" "$ENV_FILE" || { rm -f "$tmp"; stop "Couldn't save your Plaid keys into $ENV_FILE. Paste this line again."; }
}

ensure_keys() {
  ENV_FILE="$BUDGET_DIR/.env.local"
  if [ ! -f "$ENV_FILE" ]; then
    # Budget.command writes .env, .env.local and the encryption key the way it
    # always does, then exits 2 to ask for the keys -- which is this
    # function's job, so its instructions are silenced.
    local rc
    ( cd "$BUDGET_DIR" && ./Budget.command --check-only </dev/null >/dev/null 2>&1 )
    rc=$?
    if { [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; } || [ ! -f "$ENV_FILE" ]; then
      stop "Couldn't set up Budget's settings file. Paste this line again."
    fi
  fi

  if [ -n "$(env_value PLAID_CLIENT_ID)" ] && [ -n "$(env_value PLAID_SECRET)" ]; then
    echo "✅ Your Plaid keys are already saved; keeping them."
    return 0
  fi

  echo
  echo "Budget needs your Plaid keys. To find them:"
  echo "  1. Go to https://dashboard.plaid.com and sign in."
  echo "  2. Click Developers, then Keys."
  echo "  3. Copy the client_id, and the Sandbox secret (not Production)."
  echo
  local id secret
  ask_key "Paste your client_id and press Return: " shown
  id="$ANSWER"
  ask_key "Paste your Sandbox secret and press Return (it stays hidden): " hidden
  secret="$ANSWER"
  ANSWER=""
  write_keys "$id" "$secret"
  echo "✅ Your Plaid keys are saved."
}

launch() {
  local args=""
  $EXISTING && args=" --update"
  echo
  echo "Starting Budget. The first start takes 3 to 5 minutes; your browser opens on its own when it's ready."
  echo "Next: Step 7 in the README (add a pretend bank)."
  echo
  if [ "${BUDGET_INSTALL_SKIP_LAUNCH:-}" = 1 ]; then
    echo "Would run: ./Budget.command$args"
    return 0
  fi
  cd "$BUDGET_DIR" || stop "Couldn't open $BUDGET_DIR."
  # stdin from the keyboard, not the pipe the script came in on.
  if $EXISTING; then
    ./Budget.command --update <&3
  else
    ./Budget.command <&3
  fi
}

main() {
  BUDGET_DIR="${BUDGET_DIR:-$HOME/Documents/budget}"
  BUDGET_REPO="${BUDGET_REPO:-https://github.com/tw-yoon/budget.git}"
  BUDGET_TTY="${BUDGET_TTY:-/dev/tty}"
  BUDGET_NODE_MAJOR="${BUDGET_NODE_MAJOR:-24}"
  BUDGET_NODE_DIST="${BUDGET_NODE_DIST:-https://nodejs.org/dist/latest-v$BUDGET_NODE_MAJOR.x}"
  BUDGET_NODE_BIN="${BUDGET_NODE_BIN:-/usr/local/bin}"
  BUDGET_CLT_WAIT_SECS="${BUDGET_CLT_WAIT_SECS:-1800}"
  BUDGET_POLL_SECS="${BUDGET_POLL_SECS:-5}"
  NODE_HELP="Download the LTS installer from https://nodejs.org, open it, click through it, then paste this line again."
  NODE_TMP=""
  EXISTING=false
  ANSWER=""

  check_mac
  open_keyboard
  echo "Setting up Budget. This window will tell you if it needs anything from you."
  echo
  ensure_tools
  ensure_node
  ensure_clone
  ensure_keys
  launch
}

main "$@"; exit $?
