#!/bin/bash
# Budget launcher — double-click to open the app.
# Streamlined launcher: if the app is already running and up to date it just
# opens your browser; if the code changed since the last build it rebuilds
# automatically first. The server runs in the background, so you can close the
# Terminal window once it opens.
# Usage: Budget.command [--no-open] [--rebuild] [--check-only] [--update]
#   --no-open      start/refresh the server without opening the browser
#   --rebuild      force a rebuild even if no change was detected
#   --check-only   report setup and update status without building or starting
#   --update       pull the latest version and apply any new migrations
#                  (contradicts --check-only; combining them is rejected)
#   BUDGET_PORT    (env var) testing override for the port; defaults to 3000
#
# Everything this script actually *does* lives in main() at the bottom, and the
# only top-level statement is the `main "$@"` call on the last line. That is
# not a style choice. `--update` replaces this file while bash is part-way
# through reading it, and bash reads a script incrementally: it parses one
# command, runs it, then goes back to a saved byte offset for the next one.
# Replace the bytes under that offset and the rest of the launch silently never
# happens, or a fragment of a line runs instead -- exit 0 either way. A
# function body is parsed in full before a single line of it executes, so
# whatever happens to the file mid-run, main() still does all of its work.
#
# As it happens, `git pull` does not write in place: it unlinks the old file
# and creates a new one, so a running script keeps reading the original inode
# and survives regardless. That is git's implementation detail, not a promise,
# and it is not true of an in-place rewrite (`cp`, `sed -i ''`, a redirect),
# which is what any non-git update path would most likely use.

server_running() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

# A fresh clone has no configuration at all. Write what we can derive, then
# stop and ask for the one thing only the user can supply. Stopping is the
# right outcome here: the app cannot do anything useful without Plaid keys,
# and a server that boots into an error page is worse than a clear message.
bootstrap_env() {
  # Prisma's CLI reads .env; Next reads .env.local. Both are needed.
  [ -f "$SCRIPT_DIR/.env" ] || echo 'DATABASE_URL="file:./dev.db"' > "$SCRIPT_DIR/.env"

  [ -f "$SCRIPT_DIR/.env.local" ] && return 0

  if [ ! -f "$SCRIPT_DIR/.env.example" ]; then
    echo "Missing .env.example — this clone looks incomplete."
    exit 1
  fi

  local key
  key=$(openssl rand -hex 32) || { echo "Could not generate an encryption key."; exit 1; }
  # Write to a temp file in the same directory and mv into place, rather than
  # redirecting straight to .env.local: mv is atomic only within a filesystem,
  # so an interrupted write can't leave a truncated .env.local that the check
  # above would then mistake for an already-bootstrapped one on the next run.
  local tmp_env="$SCRIPT_DIR/.env.local.tmp.$$"
  # LC_ALL=C keeps sed from choking on non-ASCII bytes elsewhere in the file.
  if ! LC_ALL=C sed "s|^TOKEN_STORE_KEY=.*|TOKEN_STORE_KEY=$key|" \
       "$SCRIPT_DIR/.env.example" > "$tmp_env"; then
    rm -f "$tmp_env"
    echo "Could not write .env.local."
    exit 1
  fi
  mv "$tmp_env" "$SCRIPT_DIR/.env.local"

  echo
  echo "Created .env.local and generated your encryption key."
  echo
  echo "One thing left — Budget needs Plaid credentials to fetch bank data:"
  echo "  1. Sign up at https://dashboard.plaid.com (sandbox keys are free and instant)"
  echo "  2. Copy your client_id and sandbox secret"
  echo "  3. Paste them into .env.local as PLAID_CLIENT_ID and PLAID_SECRET"
  echo
  echo "Then run ./Budget.command again."
  echo
  echo "Note: sandbox connects to Plaid's fake test banks. Real banks require"
  echo "applying to Plaid separately for production access."
  exit 2
}

# Updating only makes sense when this folder is the whole clone. In the
# maintainer's monorepo, budget-claude is a subfolder of a larger private
# repo -- pulling there would update the wrong project entirely -- so the
# guard is false and every update path below turns itself off.
#
# Echoes *why* not, rather than only returning false, because the ways this
# can happen are different situations with different answers. One shared
# message told someone whose clone simply had no `origin` remote that their
# folder was "part of a larger repository", which is both wrong and no help.
update_blocker() {
  local root
  root=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null) || { echo "not-a-clone"; return 0; }
  [ "$(cd "$root" && pwd -P)" = "$SCRIPT_DIR" ] || { echo "subfolder"; return 0; }
  git -C "$SCRIPT_DIR" remote get-url origin >/dev/null 2>&1 || { echo "no-origin"; return 0; }

  # A linked worktree (`git worktree add`) shares the main repo's config, so
  # it passes both checks above too: --show-toplevel returns the worktree's
  # own directory, and the origin remote resolves fine since remotes live in
  # the shared config. But a linked worktree is still somebody else's
  # checkout, and `git pull --ff-only` is gated on this exact result --
  # pulling into it would be the same disaster this guard exists to prevent,
  # just one directory later. --git-dir and --git-common-dir coincide only in
  # a main checkout; in a linked worktree --git-dir points at
  # .git/worktrees/<name> while --git-common-dir points at the shared main
  # .git. Resolve both to absolute paths first since either can come back
  # relative.
  local git_dir common_dir
  git_dir=$(cd "$SCRIPT_DIR" && git rev-parse --git-dir 2>/dev/null) || { echo "not-a-clone"; return 0; }
  common_dir=$(cd "$SCRIPT_DIR" && git rev-parse --git-common-dir 2>/dev/null) || { echo "not-a-clone"; return 0; }
  git_dir=$(cd "$SCRIPT_DIR" && cd "$git_dir" 2>/dev/null && pwd -P) || { echo "not-a-clone"; return 0; }
  common_dir=$(cd "$SCRIPT_DIR" && cd "$common_dir" 2>/dev/null && pwd -P) || { echo "not-a-clone"; return 0; }
  [ "$git_dir" = "$common_dir" ] || { echo "worktree"; return 0; }

  echo ""
}

updatable() {
  [ -z "$(update_blocker)" ]
}

# Users are expected to edit things like card presets locally, so a dirty tree
# is a normal state to be in, not a failure -- say what to do about it rather
# than surfacing a raw git error. Returns 2 (not 0) when this folder simply
# isn't a place `--update` applies to at all, so the caller can tell "nothing
# to do" apart from "a real update happened" and skip the server-kill/force-
# migrate step below, which only makes sense after an actual pull.
do_update() {
  local blocker
  blocker=$(update_blocker)
  case "$blocker" in
    "") ;;
    subfolder)
      echo "This folder is part of a larger repository, so there is nothing to update here."
      echo "Update it from that repository instead."
      return 2 ;;
    worktree)
      echo "This folder is a linked git worktree, not the main checkout, so there is"
      echo "nothing to update here. Run --update from the main checkout instead."
      return 2 ;;
    no-origin)
      echo "This clone has no 'origin' remote, so there is nowhere to update from."
      echo "Point it at one with:  git remote add origin <url>"
      return 2 ;;
    *)
      echo "This folder isn't a git clone, so there is nothing to update."
      echo "Get one with:  git clone <url>"
      return 2 ;;
  esac

  # `git diff` alone misses untracked files -- and an untracked file in the
  # way is exactly what makes `pull --ff-only` fail below with its own
  # confusing "would be overwritten by merge" error. Catch it here instead,
  # with the same actionable message a modified tracked file gets.
  if [ -n "$(git -C "$SCRIPT_DIR" status --porcelain)" ]; then
    echo "You have uncommitted changes, so the update stopped before touching them."
    echo
    echo "  Set them aside:  git stash"
    echo "  Update:          ./Budget.command --update"
    echo "  Bring them back: git stash pop"
    exit 1
  fi

  echo "Fetching the latest version…"
  # Same hang-prevention as check_updates: GIT_TERMINAL_PROMPT=0 and
  # BatchMode=yes rule out a stuck credential/host-key prompt with no TTY to
  # answer it. No polling watchdog is needed here the way check_updates has
  # one -- this path is user-invoked, not run silently on every launch, so a
  # slow pull blocking the terminal is an acceptable, visible wait rather
  # than something that must be bounded.
  #
  # This is the line that rewrites the script bash is executing. See the note
  # at the top of the file for why everything after it is safe from that.
  if ! ( set -o pipefail
         GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -oBatchMode=yes -oConnectTimeout=5" \
         GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=30 \
         git -C "$SCRIPT_DIR" pull --ff-only 2>&1 | tee -a "$LOG" ); then
    # Only blame diverged history when that's actually what happened.
    # `pull --ff-only` fails the same way for a missing upstream branch or a
    # mid-pull network drop, and neither of those is "your own commits".
    local branch ahead=0
    branch=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ -n "$branch" ] && git -C "$SCRIPT_DIR" rev-parse --verify --quiet "origin/$branch" >/dev/null; then
      ahead=$(git -C "$SCRIPT_DIR" rev-list --count "origin/$branch..HEAD" 2>/dev/null)
    fi
    echo
    if [ "${ahead:-0}" -gt 0 ]; then
      echo "Could not update. You have your own commits that aren't in the"
      echo "published version, so the two histories have diverged."
      # The branch this clone is actually on, not an assumed `main`: the count
      # just above is against origin/$branch, so naming a different comparison
      # here would send someone to look at the wrong pair of commits.
      echo "Check with:  git log --oneline origin/$branch..HEAD"
    else
      echo "Could not update — see $LOG for details."
    fi
    exit 1
  fi
}

# Best-effort and always silent on failure: an offline launch is a normal
# launch. GIT_HTTP_LOW_SPEED_LIMIT/TIME only govern git's HTTP transport --
# an SSH origin ignores them entirely, and a black-holed connection or a
# host-key/passphrase prompt with no TTY to answer it can then hang
# indefinitely, which would block every launch. GIT_TERMINAL_PROMPT=0 and
# BatchMode=yes rule out prompting, and ConnectTimeout bounds the initial
# handshake, but none of that bounds a connection that opens and then goes
# silent -- so the fetch is backgrounded and polled against a 10s wall-clock
# cap as the real backstop, standing in for `timeout`, which macOS lacks.
# The "version" field of a package.json fed in on stdin. Read from a file for
# this clone and from `git show` for the published one, so the two can be
# compared without checking anything out.
read_version() {
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

app_version() {
  read_version < "$SCRIPT_DIR/package.json" 2>/dev/null
}

check_updates() {
  updatable || return 0

  GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -oBatchMode=yes -oConnectTimeout=5" \
  GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=5 \
    git -C "$SCRIPT_DIR" fetch --quiet origin 2>/dev/null &
  local fetch_pid=$! tries=0
  # Tenth-second polling keeps the common case (a fetch that finishes almost
  # instantly) from paying a full second of latency just to notice that --
  # 100 tries is still a 10s cap.
  while kill -0 "$fetch_pid" 2>/dev/null; do
    if [ "$tries" -ge 100 ]; then
      kill "$fetch_pid" 2>/dev/null
      wait "$fetch_pid" 2>/dev/null
      return 0
    fi
    sleep 0.1
    tries=$((tries + 1))
  done
  wait "$fetch_pid" 2>/dev/null || return 0

  local branch behind
  branch=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null) || return 0
  git -C "$SCRIPT_DIR" rev-parse --verify --quiet "origin/$branch" >/dev/null || return 0
  behind=$(git -C "$SCRIPT_DIR" rev-list --count "HEAD..origin/$branch" 2>/dev/null) || return 0
  [ "${behind:-0}" -gt 0 ] || return 0

  # A version bump is the useful thing to report: a commit count says nothing
  # about what changed, and CHANGELOG.md is written per version. Releases that
  # ship without a bump (or a clone whose package.json won't parse) still get
  # the count, which is better than silence.
  local here there
  here=$(app_version)
  there=$(git -C "$SCRIPT_DIR" show "origin/$branch:package.json" 2>/dev/null | read_version)
  if [ -n "$here" ] && [ -n "$there" ] && [ "$here" != "$there" ]; then
    echo "v$there available (you have v$here) — run ./Budget.command --update"
  else
    echo "$behind update(s) available — run ./Budget.command --update"
  fi
}

# A rebuild is needed when there's no build yet, --rebuild was passed, or any
# source input changed after the last build. Runtime data (prisma/dev.db,
# data/, logs) is deliberately not watched.
needs_build() {
  $FORCE && return 0
  [ -f .next/BUILD_ID ] || return 0
  find src public prisma/schema.prisma prisma/migrations \
       package.json package-lock.json next.config.ts tsconfig.json \
       -type f -newer .next/BUILD_ID -print -quit 2>/dev/null | grep -q .
}

# npm install only when dependencies actually changed (npm keeps its own
# stamp file inside node_modules).
needs_install() {
  [ -d node_modules ] || return 0
  [ package-lock.json -nt node_modules/.package-lock.json ]
}

# The schema lives in migrations, not in the repo as a file, so a fresh clone
# has no database at all. migrate deploy is idempotent, but running it on every
# launch costs a second or two -- so only reach for it when there is nothing
# there, or when a pull may have brought new migrations.
ensure_db() {
  local force="${1:-}"
  if [ -z "$force" ] && [ -s "$DB" ] && sqlite3 "$DB" ".tables" 2>/dev/null | grep -q .; then
    return 0
  fi
  # node_modules is what --check-only reaches ensure_db without: a user who
  # added Plaid keys but never launched should see a clear next step, not a
  # raw npx failure trying to resolve prisma from a package that isn't there.
  # Return 2 (distinct from the 0 fast-path above) so callers -- --check-only
  # in particular -- can tell "guard fired" from "already set up".
  if [ ! -d node_modules ]; then
    echo "Dependencies aren't installed yet — run ./Budget.command to set them up."
    return 2
  fi
  echo "Setting up the database…"
  # Run in a subshell with pipefail local to it: without this, the `if !`
  # below tests tee's exit status (via the pipeline), not npx's, so a failed
  # migration would print its error and still be treated as success. A plain
  # `set -o pipefail` here would also leak into the rest of the script, which
  # only wants it scoped around the npm build step below.
  if ! ( set -o pipefail; npx --prefix "$SCRIPT_DIR" prisma migrate deploy 2>&1 | tee -a "$LOG" ); then
    echo "Database setup failed — see $LOG."
    exit 1
  fi
  npx --prefix "$SCRIPT_DIR" prisma generate >>"$LOG" 2>&1 || true
}

# prisma/dev.db holds every account, transaction and balance, and is
# deliberately kept out of git — so this is its only safety net. Archive the
# last state of each previous day before this session can change it.
snapshot_db() {
  [ -s "$DB" ] || return 0
  local day dst
  day=$(date -r "$(stat -f %m "$DB")" +%F)
  # Already wrote today, so the last completed day is already archived.
  [ "$day" = "$(date +%F)" ] && return 0
  mkdir -p "$BACKUP_DIR"
  dst="$BACKUP_DIR/dev-$day.db"
  [ -e "$dst" ] && return 0
  # .backup is consistent even if the server is mid-write; plain cp of a live
  # SQLite file can tear. Fall back to cp only if sqlite3 is missing.
  if ! sqlite3 "$DB" ".backup '$dst'" 2>/dev/null && ! cp "$DB" "$dst"; then
    echo "Warning: could not back up $DB — continuing anyway."
    return 0
  fi
  echo "Archived $day's database to $dst"
  find "$BACKUP_DIR" -name 'dev-*.db' -type f -mtime +$KEEP_DAYS -delete 2>/dev/null
}

# snapshot_db archives the last state of each *previous* day, so it returns
# early whenever dev.db was written today -- which it has been after any normal
# launch, which is nearly always. Fine for a launch. Not fine here: --update is
# about to run migrations over every account, transaction and balance you have,
# and a migration is the one operation that can change the shape of that data.
# Going into it with a backup that could be a day old is the wrong trade for
# the second it costs, so take a copy unconditionally, whatever the daily
# archive already holds.
snapshot_db_before_migrate() {
  [ -s "$DB" ] || return 0
  mkdir -p "$BACKUP_DIR"
  local dst
  dst="$BACKUP_DIR/pre-update-$(date +%Y%m%dT%H%M%S).db"
  [ -e "$dst" ] && return 0
  if ! sqlite3 "$DB" ".backup '$dst'" 2>/dev/null && ! cp "$DB" "$dst"; then
    echo "Warning: could not back up $DB before migrating — continuing anyway."
    return 0
  fi
  echo "Backed up the database to $dst before migrating."
  find "$BACKUP_DIR" -name 'pre-update-*.db' -type f -mtime +$KEEP_DAYS -delete 2>/dev/null
}

main() {
  cd "$(dirname "$0")" || exit 1

  # Absolute and symlink-resolved: every git and npx call above is anchored to
  # this path rather than to whatever directory the caller happened to be in.
  SCRIPT_DIR="$(pwd -P)"

  # Launched from the Finder (a double-clicked .command, or any GUI wrapper),
  # this script gets a minimal PATH without node/npm — add the usual install
  # locations so it works no matter how it was started.
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

  PORT="${BUDGET_PORT:-3000}"
  URL="http://localhost:$PORT"
  LOG=".server.log"

  DB="prisma/dev.db"
  BACKUP_DIR="prisma/backups"
  KEEP_DAYS=30

  # Point every reader at this checkout's database, absolutely. A relative
  # `file:./dev.db` means different files to different readers: the Prisma CLI
  # resolves it against prisma/schema.prisma, while the generated client
  # resolves it against whatever schema path was recorded when it was last
  # generated -- and the launcher tests regenerate that client from a throwaway
  # copy under $TMPDIR that symlinks this node_modules. Once that copy is gone,
  # the app silently opens an empty node_modules/.prisma/client/dev.db and every
  # route answers 500. A path built from SCRIPT_DIR cannot drift that way: a
  # test fixture computes its own, this checkout computes its own.
  export DATABASE_URL="file:$SCRIPT_DIR/prisma/dev.db"

  NO_OPEN=false
  FORCE=false
  CHECK_ONLY=false
  UPDATE=false
  for arg in "$@"; do
    case "$arg" in
      --no-open) NO_OPEN=true ;;
      --rebuild) FORCE=true ;;
      --check-only) CHECK_ONLY=true ;;
      --update) UPDATE=true ;;
    esac
  done

  # check-only promises to only report; update promises to change things.
  # Combining them would mean a caller who asked only for a report gets a real
  # git pull and a real migration with no chance to back out -- reject before
  # either flag's code below ever runs, so nothing is written.
  if $CHECK_ONLY && $UPDATE; then
    echo "--check-only and --update are contradictory: one only reports status,"
    echo "the other changes things. Use one or the other."
    exit 1
  fi

  bootstrap_env

  snapshot_db

  if $UPDATE; then
    do_update
    update_status=$?
    # Only a real pull (status 0) warrants stopping the running server and
    # forcing a migration pass -- "nothing to do here" (status 2) should fall
    # through to a completely normal launch instead.
    if [ "$update_status" -eq 0 ]; then
      # Stop the old server *before* migrating, not after: the build/restart
      # block below already kills-and-restarts for a changed build, but that
      # happens after ensure_db -- leaving a stale server answering requests
      # against a freshly migrated schema in between if it ran first here too.
      lsof -ti:"$PORT" | xargs kill 2>/dev/null
      snapshot_db_before_migrate
      ensure_db force
    fi
  else
    check_updates
  fi

  if $CHECK_ONLY; then
    ensure_db
    db_status=$?
    needs_build && echo "A rebuild is pending — the next launch will take ~30–60s."
    # Skip the "Ready" line if ensure_db's node_modules guard fired (status 2)
    # -- telling someone to launch right after telling them deps aren't
    # installed undercuts the warning.
    local version; version=$(app_version)
    [ "$db_status" -eq 2 ] || echo "Ready${version:+ (v$version)}. Launch with ./Budget.command"
    exit 0
  fi

  if server_running && ! needs_build; then
    echo "Budget is already running and up to date."
    $NO_OPEN || open "$URL"
    exit 0
  fi

  if needs_build; then
    echo "Code changed since the last build — updating Budget (~30–60s)…"
    # Stop the old server (if any) so the new build takes over.
    lsof -ti:"$PORT" | xargs kill 2>/dev/null

    if needs_install; then
      echo "Installing dependencies…"
      npm install 2>&1 | tee -a "$LOG" || true
    fi

    ensure_db

    set -o pipefail
    if ! npm run build 2>&1 | tee -a "$LOG"; then
      echo
      echo "Build failed — see the errors above (also in $LOG)."
      echo "The previous version was stopped; fix the code and relaunch."
      exit 1
    fi
    set +o pipefail
  fi

  if ! server_running; then
    echo "Starting Budget…"
    : > "$LOG"
    # Hand the server the same port this script watches. `next start` binds
    # 3000 unless told otherwise -- its --port default, env `PORT`, per next's
    # CLI reference -- while $PORT above only drove the lsof check, the kill
    # and the URL. Without this, BUDGET_PORT split the two: the server bound
    # 3000 (or failed, if something already held it) while the wait below
    # watched a port nothing was listening on and reported that the server
    # never started.
    PORT="$PORT" nohup npm run start >>"$LOG" 2>&1 &

    for i in $(seq 1 240); do
      server_running && break
      sleep 0.5
    done
    if ! server_running; then
      echo "Server didn't start — check $LOG for errors."
      exit 1
    fi
  fi

  local version; version=$(app_version)
  echo "Budget${version:+ v$version} is ready at $URL"
  $NO_OPEN || open "$URL"
}

# The last line, and deliberately a one-liner: bash has already read this whole
# line before main runs, so once main returns there is nothing left to read out
# of a file that main may have just replaced.
main "$@"; exit $?
