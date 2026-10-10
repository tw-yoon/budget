#!/bin/bash
# Drives Budget.command against a throwaway clone that looks the way a
# stranger's does: tracked files only, no env, no database. Everything here
# asserts on behavior that happens *before* any build, so the suite stays fast.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PASS=0; FAIL=0
pass() { echo "  ok: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; echo "    $2"; FAIL=$((FAIL+1)); }
assert_has() { case "$1" in *"$2"*) pass "$3";; *) fail "$3" "expected to find: $2";; esac; }
assert_lacks() { case "$1" in *"$2"*) fail "$3" "should not contain: $2";; *) pass "$3";; esac; }

# One parent dir for every fixture this run creates. Anchored here, in the
# parent shell, rather than inside make_fixture: every caller uses
# tmp=$(make_fixture), and command substitution always forks a subshell, so
# anything make_fixture assigns to a variable never makes it back out --
# tracking fixtures in an array from inside the function can't work. Deleting
# one parent dir at exit covers every fixture regardless.
SUITE_TMP=$(mktemp -d)
[ -n "$SUITE_TMP" ] || { echo "mktemp failed" >&2; exit 1; }
# Fixtures reach the real node_modules through that symlink, and a fixture that
# runs the full launch path runs `prisma generate` -- which rewrites the shared
# node_modules/.prisma/client with the schema path of a fixture that is about to
# be deleted. The real app then resolves its relative `file:./dev.db` against a
# directory that no longer exists, opens an empty database next to the client,
# and answers every request with a 500. Regenerating from this checkout on the
# way out puts the client back the way the suite found it.
restore_prisma_client() {
  npx --prefix "$ROOT" prisma generate >/dev/null 2>&1 || true
  rm -f "$ROOT/node_modules/.prisma/client/dev.db"
}
trap 'rm -rf "$SUITE_TMP"; restore_prisma_client' EXIT

# npm's own stamp file. Fixtures symlink node_modules to this checkout's, so a
# real `npm install` inside a fixture would mutate the real dependencies. The
# launcher skips install only when package-lock.json is no newer than this
# file, and run_update relies on copying its timestamp -- so if it is missing,
# stop here rather than let a fixture reach the real thing.
LOCK_STAMP="$ROOT/node_modules/.package-lock.json"
if [ ! -f "$LOCK_STAMP" ]; then
  echo "missing $LOCK_STAMP — run npm install in $ROOT first." >&2
  echo "Without it these fixtures would run a real npm install against the real" >&2
  echo "node_modules they symlink to." >&2
  exit 1
fi

# A bare origin plus a clone of it. Seeded from tracked files only, which is
# exactly what a stranger receives -- so anything gitignored is absent by
# construction rather than by us remembering to delete it.
make_fixture() {
  local tmp; tmp=$(mktemp -d "$SUITE_TMP/XXXXXX")
  git init -q --bare "$tmp/origin.git"
  mkdir -p "$tmp/seed"
  ( cd "$ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -xf - -C "$tmp/seed"
  git -C "$tmp/seed" init -q -b main
  git -C "$tmp/seed" add -A
  git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -qm "seed"
  git -C "$tmp/seed" push -q "$tmp/origin.git" main
  git -C "$tmp" clone -q "$tmp/origin.git" app
  # Building is not what these tests exercise; borrow the real dependencies
  # so prisma and next are on hand without a multi-minute npm install.
  ln -s "$ROOT/node_modules" "$tmp/app/node_modules"
  echo "$tmp"
}

run_app() {
  local dir="$1"; shift
  # Fixed unused high port, never the real 3000: a test must never be able to
  # reach the kill-and-rebuild path against the user's actual running server.
  ( cd "$dir" && BUDGET_PORT=39173 ./Budget.command --no-open --check-only "$@" 2>&1 )
}

# Runs Budget.command through the REAL (non --check-only) launch path --
# needed for --update, since --check-only combined with --update is now
# rejected (see the "launcher: update" section below). A real launch that
# actually needs a rebuild goes on to a real `npm run build`, which takes
# tens of seconds, so this bounds the wait to a fixed window rather than
# waiting for that to finish: everything this suite asserts on (the pull,
# the server-kill, the forced migration, the "rebuild needed" message) has
# already happened within the first second or two, well before the window
# closes. `set -m` puts the background job in its own process group so a
# still-running `npm run build`/`next build` tree can be killed as a whole
# via the negative PID, rather than leaving orphaned children behind.
#
# npm install is skipped for real by keeping the fixture's package-lock.json
# no newer than node_modules/.package-lock.json's timestamp: node_modules is
# a symlink into this actual checkout (see make_fixture), not fixture-local,
# so letting a real `npm install` run here would mutate the real thing.
#
# Set WATCH_PORT_PID to a process holding port 39173 and run_update records,
# at the moment the launcher announces it is migrating, whether that process
# still held the port -- into $SUITE_TMP/watch_state, since run_update always
# runs inside a command substitution and cannot hand a variable back. The
# observation has to happen here, mid-run: run_update's own port cleanup at
# the bottom kills anything still listening, so an assertion made after
# run_update returns is true whether or not the launcher ever killed anything.
WATCH_PORT_PID=""
run_update() {
  local dir="$1"; shift
  # No `|| true`: without this stamp the launcher decides dependencies changed
  # and runs a real `npm install` against node_modules, which make_fixture
  # symlinks to this actual checkout's. Silently falling back to that is worse
  # than stopping, so stop.
  if ! touch -r "$LOCK_STAMP" "$dir/package-lock.json"; then
    echo "run_update: could not stamp $dir/package-lock.json from $LOCK_STAMP" >&2
    echo "  refusing to continue: the launcher would run a real npm install" >&2
    echo "  against the real node_modules this fixture symlinks to." >&2
    exit 1
  fi

  local outfile; outfile=$(mktemp "$SUITE_TMP/XXXXXX")
  rm -f "$SUITE_TMP/watch_state"
  set -m
  ( cd "$dir" && BUDGET_PORT=39173 ./Budget.command --no-open "$@" >"$outfile" 2>&1 ) &
  local pid=$!
  set +m
  local tries=0 watched=""
  while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 75 ]; do
    # "Setting up the database…" is printed by ensure_db the instant it starts
    # migrating, so the first sample after it appears is the ordering question
    # this suite actually cares about: was the old server already gone by the
    # time the migration began? Sampled by port rather than by `kill -0`,
    # which a not-yet-reaped zombie would still answer to.
    if [ -n "$WATCH_PORT_PID" ] && [ -z "$watched" ] \
       && grep -q "Setting up the database" "$outfile" 2>/dev/null; then
      if lsof -ti:39173 2>/dev/null | grep -qx "$WATCH_PORT_PID"; then
        watched=alive
      else
        watched=dead
      fi
      echo "$watched" > "$SUITE_TMP/watch_state"
    fi
    sleep 0.2
    tries=$((tries + 1))
  done
  [ -n "$WATCH_PORT_PID" ] && [ -z "$watched" ] && echo "never-migrated" > "$SUITE_TMP/watch_state"
  if kill -0 "$pid" 2>/dev/null; then
    kill -- -"$pid" 2>/dev/null
    sleep 0.2
    kill -9 -- -"$pid" 2>/dev/null
  fi
  wait "$pid" 2>/dev/null
  # A real `npm run start` that got far enough to bind the fixed test port
  # before being killed above must not leak into whichever test runs next.
  lsof -ti:39173 | xargs kill 2>/dev/null
  cat "$outfile"
}

echo "launcher: check-only"
tmp=$(make_fixture)
# check-only reports build/rebuild status for an app that's already set up,
# not first-run bootstrapping -- seed just enough (.env, and .env.example
# copied in as .env.local) so this fixture isn't stopped by the Plaid check.
# TOKEN_STORE_KEY is left blank here, unlike a real bootstrap run; harmless
# since --check-only never reads it.
echo 'DATABASE_URL="file:./dev.db"' > "$tmp/app/.env"
cp "$tmp/app/.env.example" "$tmp/app/.env.local"
out=$(run_app "$tmp/app")
assert_lacks "$out" "Starting Budget" "--check-only never starts a server"
[ ! -d "$tmp/app/.next" ] && pass "--check-only never builds" \
                          || fail "--check-only never builds" ".next was created"
assert_has "$out" "Launch with ./Budget.command" "--check-only reports ready"
# --check-only is the "what have I got?" command, so it names the version.
assert_has "$out" "Ready (v$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1))" \
           "--check-only names the installed version"

echo "launcher: env bootstrap"
tmp=$(make_fixture)
out=$(run_app "$tmp/app")
status=$?
assert_has "$out" "Plaid" "explains that Plaid keys are needed"
[ "$status" -eq 2 ] && pass "exits 2 to stop for missing Plaid keys" \
                     || fail "exits 2 to stop for missing Plaid keys" "got exit $status"
[ -f "$tmp/app/.env.local" ] && pass "creates .env.local" || fail "creates .env.local" "not created"
[ -f "$tmp/app/.env" ] && pass "creates .env for the Prisma CLI" || fail "creates .env" "not created"

key=$(grep -E '^TOKEN_STORE_KEY=' "$tmp/app/.env.local" 2>/dev/null | cut -d= -f2)
[ "${#key}" -eq 64 ] && pass "generates a 64-char TOKEN_STORE_KEY" \
                     || fail "generates a 64-char TOKEN_STORE_KEY" "got length ${#key}"

# Second run must not clobber what the user has already filled in.
printf 'PLAID_CLIENT_ID=mine\n' >> "$tmp/app/.env.local"
run_app "$tmp/app" >/dev/null
grep -q 'PLAID_CLIENT_ID=mine' "$tmp/app/.env.local" \
  && pass "leaves an existing .env.local alone" \
  || fail "leaves an existing .env.local alone" "file was overwritten"
key2=$(grep -E '^TOKEN_STORE_KEY=' "$tmp/app/.env.local" | head -1 | cut -d= -f2)
[ "$key2" = "$key" ] && pass "does not rotate an existing key" \
                     || fail "does not rotate an existing key" "key changed between runs"

echo "launcher: database bootstrap"
tmp=$(make_fixture)
run_app "$tmp/app" >/dev/null            # first run writes .env.local, exits 2
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$tmp/app/.env.local"
out=$(run_app "$tmp/app")

[ -f "$tmp/app/prisma/dev.db" ] && pass "creates prisma/dev.db" \
                                || fail "creates prisma/dev.db" "not created"
tables=$(sqlite3 "$tmp/app/prisma/dev.db" ".tables" 2>/dev/null)
case "$tables" in *Account*) pass "applies migrations";;
  *) fail "applies migrations" "tables found: ${tables:-none}";; esac

# Re-running must be a no-op, not a second migration pass. mtime comparison
# can't distinguish "correctly skipped" from "the freshness check is gone
# entirely": migrate deploy is itself idempotent and wouldn't touch dev.db
# either way. Assert on the invocation-specific message instead -- it is only
# printed when ensure_db actually calls migrate.
out2=$(run_app "$tmp/app")
assert_lacks "$out2" "Setting up the database" "does not re-run migrate on an already-set-up database"

# Structural guard on source order, not a test of behavior: run_app is always
# --check-only, so nothing here ever exercises the normal-launch call site
# (after npm install, before npm run build) behaviorally. Without this, a
# future edit could move that ensure_db call and this suite would stay green.
install_line=$(grep -n 'npm install 2>&1' "$ROOT/Budget.command" | head -1 | cut -d: -f1)
ensure_db_line=$(grep -n '^[[:space:]]*ensure_db$' "$ROOT/Budget.command" | tail -1 | cut -d: -f1)
build_line=$(grep -n 'npm run build' "$ROOT/Budget.command" | head -1 | cut -d: -f1)
if [ -n "$install_line" ] && [ -n "$ensure_db_line" ] && [ -n "$build_line" ] \
   && [ "$install_line" -lt "$ensure_db_line" ] && [ "$ensure_db_line" -lt "$build_line" ]; then
  pass "ensure_db (normal path) stays after npm install and before npm run build"
else
  fail "ensure_db (normal path) stays after npm install and before npm run build" \
       "install=$install_line ensure_db=$ensure_db_line build=$build_line"
fi

echo "launcher: the server starts on the port the launcher watches"
# $PORT drove the lsof check, the kill and the printed URL -- but the server
# was launched with a bare `npm run start`, and `next start` binds 3000 unless
# told otherwise (its --port default; "env: PORT" per next's own CLI
# reference). With BUDGET_PORT set, the server listened on 3000 while the
# launcher waited on the override and then announced "Server didn't start".
# Worse: every fixture here aims at 39173 precisely so a test can never touch
# the real 3000, and this defect pointed all of them straight at it. They
# stayed harmless only because a real server already held that port. Nothing
# in this suite asserted a server ever came up, so 51 tests passed over it.
#
# Stubbing `npm` on PATH cannot test this -- Budget.command exports its own
# PATH after whatever the harness sets, so the real npm always wins (recorded
# under the plan's Task 7 corrections). The fixture's own package.json is
# stubbed instead: `build` writes a BUILD_ID so needs_build is satisfied
# without a multi-minute next build, and `start` records the port it was
# handed, then listens on it. That is the contract under test -- does the
# launcher tell the server which port to use -- with none of next in the way.
# Rewriting package.json is safe for the shared node_modules: needs_install
# compares package-lock.json only, which run_update backdates.
#
# The stub deliberately does NOT fall back to 3000 when PORT is unset, the way
# next does. Reproducing the bug faithfully would mean a failing test binds
# the user's real port. It records "unset" and takes an ephemeral port
# instead, so the launcher fails its wait and .port-seen says why.
port_fx=$(make_fixture)
echo 'DATABASE_URL="file:./dev.db"' > "$port_fx/app/.env"
cp "$port_fx/app/.env.example" "$port_fx/app/.env.local"
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$port_fx/app/.env.local"
cat > "$port_fx/app/stub-server.js" <<'STUB'
const fs = require('fs');
const http = require('http');
const port = process.env.PORT;
fs.writeFileSync('.port-seen', port ? String(port) : 'unset');
http.createServer((_req, res) => res.end('ok')).listen(port ? Number(port) : 0);
STUB
node -e '
  const fs = require("fs");
  const f = process.argv[1] + "/package.json";
  const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
  pkg.scripts.build = "mkdir -p .next && date +%s > .next/BUILD_ID";
  pkg.scripts.start = "node stub-server.js";
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
' "$port_fx/app"
# run_update is the only helper that drives the real launch path; with no extra
# arguments it is an ordinary launch, not an update.
out=$(run_update "$port_fx/app")
seen=$(cat "$port_fx/app/.port-seen" 2>/dev/null)
[ "$seen" = "39173" ] && pass "hands the server the port the launcher watches" \
                      || fail "hands the server the port the launcher watches" \
                              "server saw: ${seen:-<never started>}"
assert_has "$out" "ready at http://localhost:39173" "reports ready on the override port"

echo "launcher: update detection"
tmp=$(make_fixture)
run_app "$tmp/app" >/dev/null
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$tmp/app/.env.local"

# Up to date: say nothing.
out=$(run_app "$tmp/app")
assert_lacks "$out" "update(s) available" "silent when current"

# Publish two commits to origin, then rewind the clone behind them.
git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -q --allow-empty -m one
git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -q --allow-empty -m two
git -C "$tmp/seed" push -q "$tmp/origin.git" main
out=$(run_app "$tmp/app")
assert_has "$out" "2 update(s) available" "counts commits behind"
assert_has "$out" "--update" "names the command to run"

# A published version bump is reported as versions, not as a commit count:
# "3 commits" says nothing about what changed, and the number resets meaning
# every release.
local_v=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)
sed -i '' 's/"version": "[^"]*"/"version": "99.9.9"/' "$tmp/seed/package.json"
git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -qam "publish 99.9.9"
git -C "$tmp/seed" push -q "$tmp/origin.git" main
out=$(run_app "$tmp/app")
assert_has "$out" "v99.9.9 available" "names the published version"
assert_has "$out" "you have v$local_v" "names the version you are on"
assert_lacks "$out" "update(s) available" "drops the commit count once versions differ"

# Being behind must never stop the app from launching.
assert_has "$out" "Ready" "still reports ready when behind"

# A subfolder of a larger repo is somebody else's checkout -- never touch it.
sub=$(mktemp -d "$SUITE_TMP/XXXXXX")
git -C "$sub" init -q -b main
mkdir -p "$sub/budget-claude"
( cd "$tmp/app" && git ls-files -z | tar --null -T - -cf - ) | tar -xf - -C "$sub/budget-claude"
cp "$tmp/app/.env.local" "$tmp/app/.env" "$sub/budget-claude/"
ln -s "$ROOT/node_modules" "$sub/budget-claude/node_modules"
git -C "$sub" add -A && git -C "$sub" -c user.email=t@test -c user.name=test commit -qm mono
out=$(run_app "$sub/budget-claude")
assert_lacks "$out" "update(s) available" "no update checks inside a monorepo"

# A real clone with no origin configured hits a different branch of
# updatable() (toplevel matches, but no remote) -- must also stay silent.
noorigin=$(mktemp -d "$SUITE_TMP/XXXXXX")
git init -q -b main "$noorigin"
( cd "$ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -xf - -C "$noorigin"
git -C "$noorigin" add -A && git -C "$noorigin" -c user.email=t@test -c user.name=test commit -qm seed
ln -s "$ROOT/node_modules" "$noorigin/node_modules"
echo 'DATABASE_URL="file:./dev.db"' > "$noorigin/.env"
cp "$noorigin/.env.example" "$noorigin/.env.local"
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$noorigin/.env.local"
out=$(run_app "$noorigin")
assert_lacks "$out" "update(s) available" "no origin remote means no update checks"

echo "launcher: update"
tmp=$(make_fixture)
run_app "$tmp/app" >/dev/null
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$tmp/app/.env.local"
run_app "$tmp/app" >/dev/null

# The published commit carries a REAL migration, not `--allow-empty`. Asserting
# afterwards that dev.db has an Account table proves nothing: that table was
# created when the fixture was first set up, and would be there whether or not
# the update migrated anything. UpdateProbe exists only in the commit about to
# be pulled, so it can only appear if --update really ran migrate deploy on
# what it fetched. The far-future timestamp keeps it ordered last.
mkdir -p "$tmp/seed/prisma/migrations/20991231235959_update_probe"
cat > "$tmp/seed/prisma/migrations/20991231235959_update_probe/migration.sql" <<'SQL'
-- Arrives only with the pulled commit; nothing else in the repo creates it.
CREATE TABLE "UpdateProbe" (
    "id" TEXT NOT NULL PRIMARY KEY
);
SQL
git -C "$tmp/seed" add prisma/migrations
git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -q -m newer
git -C "$tmp/seed" push -q "$tmp/origin.git" main

# --check-only promises to only report; --update changes things. Combining
# them must be rejected before any git write happens -- run_app always adds
# --check-only, so this is exactly the combination review round 1 found
# every other test in this section was unknowingly exercising.
before_combo=$(git -C "$tmp/app" rev-parse HEAD)
out=$(run_app "$tmp/app" --update)
after_combo=$(git -C "$tmp/app" rev-parse HEAD)
assert_has "$out" "contradictory" "rejects --check-only combined with --update"
[ "$before_combo" = "$after_combo" ] && pass "no git write for the contradictory combo" \
                                      || fail "no git write for the contradictory combo" \
                                              "HEAD moved from $before_combo to $after_combo"

# A dirty tree aborts with an explanation, and changes survive. Uses
# run_update (the real, non --check-only path) now that the combo above is
# rejected.
echo "scratch" >> "$tmp/app/README.md"
out=$(run_update "$tmp/app" --update)
assert_has "$out" "uncommitted" "explains why a dirty tree stopped the update"
assert_has "$out" "git stash" "suggests how to proceed"
grep -q scratch "$tmp/app/README.md" && pass "leaves local edits intact" \
                                     || fail "leaves local edits intact" "edit was lost"
git -C "$tmp/app" checkout -q -- README.md

# An untracked file is invisible to `git diff` but not to `git status --
# porcelain`. Before this fix, do_update would sail past it into a pull that
# can fail with git's own confusing "would be overwritten by merge" error,
# which used to get misreported as diverged history (see the "own commits"
# check further down) -- it must be caught up front instead, with the same
# actionable message a modified tracked file gets.
echo "not tracked" > "$tmp/app/untracked-scratch.txt"
out=$(run_update "$tmp/app" --update)
assert_has "$out" "uncommitted" "an untracked file also stops the update"
assert_lacks "$out" "own commits" "an untracked file is not misdiagnosed as diverged history"
[ -f "$tmp/app/untracked-scratch.txt" ] && pass "leaves the untracked file alone" \
                                        || fail "leaves the untracked file alone" "file was removed"
rm -f "$tmp/app/untracked-scratch.txt"

# Clean tree fast-forwards -- combined with proving the running server gets
# stopped BEFORE the forced migration (not after): fake an already-running
# instance by binding the fixed test port directly, independent of anything
# Budget.command itself starts.
#
# Checking liveness here, after run_update has returned, cannot fail: run_update
# ends with its own `lsof -ti:39173 | xargs kill`, and the normal build path
# further down Budget.command kills the port a second time anyway, so the old
# server is dead by now whichever line did it. run_update therefore samples the
# port at the moment the launcher starts migrating and leaves the answer in
# watch_state; delete the launcher's kill and that sample reads "alive".
nc -l 39173 >/dev/null 2>&1 &
old_server_pid=$!
disown "$old_server_pid" 2>/dev/null
sleep 0.2
WATCH_PORT_PID="$old_server_pid"
out=$(run_update "$tmp/app" --update)
WATCH_PORT_PID=""
watch_state=$(cat "$SUITE_TMP/watch_state" 2>/dev/null)
case "$watch_state" in
  dead) pass "stops the already-running server before migrating";;
  alive) fail "stops the already-running server before migrating" \
              "the old server still held port 39173 when the migration started";;
  *) fail "stops the already-running server before migrating" \
          "never observed the migration starting (watch_state: ${watch_state:-unset})";;
esac
kill "$old_server_pid" 2>/dev/null
msg=$(git -C "$tmp/app" log -1 --pretty=%s)
[ "$msg" = "newer" ] && pass "fast-forwards to the newest commit" \
                     || fail "fast-forwards to the newest commit" "HEAD is at: $msg"
# UpdateProbe comes only from the migration in the commit just pulled, so
# unlike Account it cannot already have been there.
tables=$(sqlite3 "$tmp/app/prisma/dev.db" ".tables" 2>/dev/null)
case "$tables" in *UpdateProbe*) pass "applies newly-pulled migrations for real";;
  *) fail "applies newly-pulled migrations for real" "tables found: ${tables:-none}";; esac

# The daily archive returns early whenever dev.db was written today, which it
# always has been by the time anyone runs --update -- so the backup standing
# between a migration and someone's financial data could be a day old. This
# fixture's dev.db was written moments ago, which is exactly the case the daily
# rule skips, so a pre-update copy existing here can only come from the
# unconditional one.
preupdate=$(ls "$tmp/app/prisma/backups"/pre-update-*.db 2>/dev/null | head -1)
[ -n "$preupdate" ] && pass "backs the database up before migrating it" \
                    || fail "backs the database up before migrating it" \
                            "no pre-update-*.db in $tmp/app/prisma/backups"
assert_has "$out" "Code changed" "the existing rebuild check fires on its own after the pull"
assert_has "$out" "Step 1 of 2: Code changed since the last build" "the build is numbered among the steps left"
assert_lacks "$out" "Step 0" "steps count from 1"
# The brief's own suggested check here -- assert_lacks "$out" "update(s)
# available" -- is trivially true regardless of whether the pull worked:
# do_update REPLACES check_updates when --update is passed, so that string
# can never appear in $out either way. A real test has to depend on the pull
# having actually happened, so instead run the app again *without* --update
# and let check_updates do a real fetch-and-compare against origin: if the
# fast-forward silently failed to move HEAD, this second run would still be
# behind origin and would report "update(s) available".
out2=$(run_app "$tmp/app")
assert_lacks "$out2" "update(s) available" "check_updates finds nothing pending after the fast-forward"

# Diverged history cannot fast-forward and must say so rather than emit raw git.
git -C "$tmp/app" -c user.email=t@test -c user.name=test commit -q --allow-empty -m local
git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -q --allow-empty -m remote
git -C "$tmp/seed" push -q "$tmp/origin.git" main
out=$(run_update "$tmp/app" --update)
assert_has "$out" "own commits" "explains diverged history in plain words"

echo "launcher: an update that rewrites the launcher itself"
# Every pull this suite publishes above is `commit --allow-empty`, so
# Budget.command comes back byte-identical -- and Budget.command is the file
# an update is most likely to change. Bash reads a script incrementally: it
# parses a command, runs it, then seeks back to a saved byte offset for the
# next one, so a file that changes underneath a running interpreter can strand
# it mid-text. Everything --update still has to do -- the kill, the forced
# migration, the rebuild, the restart -- lives after the pull.
#
# This fixture covers the case end to end. It is honest about what it does not
# prove: `git pull` installs a changed file under a *fresh inode* (git unlinks
# and recreates rather than writing in place), so the running script keeps
# reading the original, unlinked copy and finishes normally even without the
# main() structure below. Measured, not assumed -- the pre-main() launcher
# passes these same assertions. The structural guard further down is what
# actually fails when that structure is removed.
rw=$(make_fixture)
run_app "$rw/app" >/dev/null
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$rw/app/.env.local"
run_app "$rw/app" >/dev/null    # create dev.db, so this is an ordinary update

# The published change inserts a line near the TOP of the launcher, which
# shifts every byte after it. An append-only change would leave the resume
# offset pointing at the same text and would prove nothing. The trailing
# marker then shows whether the running script read any of the new file.
awk 'NR==1 { print; print "# fixture: this published update edits the launcher itself"; next } { print }' \
  "$rw/seed/Budget.command" > "$rw/seed/Budget.command.new"
mv "$rw/seed/Budget.command.new" "$rw/seed/Budget.command"
chmod +x "$rw/seed/Budget.command"
printf '\necho "TAIL_OF_THE_PULLED_FILE"\n' >> "$rw/seed/Budget.command"
git -C "$rw/seed" add Budget.command
git -C "$rw/seed" -c user.email=t@test -c user.name=test commit -qm "launcher change"
git -C "$rw/seed" push -q "$rw/origin.git" main

before_rw=$(git -C "$rw/app" rev-parse HEAD)
out=$(run_update "$rw/app" --update)
[ "$(git -C "$rw/app" rev-parse HEAD)" != "$before_rw" ] \
  && pass "pulls a commit that rewrites the launcher" \
  || fail "pulls a commit that rewrites the launcher" "HEAD did not move"
# Everything below is what lives *after* the pull in the source order.
assert_has "$out" "Setting up the database" \
  "still migrates after the pull rewrote the running script"
assert_has "$out" "Code changed" \
  "still reaches the rebuild after the pull rewrote the running script"
assert_lacks "$out" "TAIL_OF_THE_PULLED_FILE" \
  "never executes text out of the file the pull just replaced"

echo "launcher: the executable body stays inside main()"
# Bash parses a function in full before executing a line of it, so nothing
# inside main() can be changed by a file swap that happens part-way through
# the run; a top-level statement has no such protection. Today git's unlink-
# and-recreate saves the current structure anyway, but that is git's
# implementation detail rather than a promise, and it is not true of every way
# a file gets replaced -- an in-place rewrite (`cp`, `sed -i ''`, a redirect)
# strands the interpreter for real, which is reproducible in isolation.
# Structure is the only guarantee that does not depend on any of that, so
# assert on the structure: at column 0 Budget.command may have a comment, a
# function definition, its closing brace, and the single main call. Nothing
# else, because anything else is a statement running while the file is still
# being read.
stray=$(grep -nE '^[^[:space:]#]' "$ROOT/Budget.command" \
        | grep -vE '^[0-9]+:[A-Za-z_][A-Za-z0-9_]*\(\) \{$' \
        | grep -vE '^[0-9]+:\}$' \
        | grep -vE '^[0-9]+:main "\$@"')
[ -z "$stray" ] && pass "nothing but function definitions and the main call at top level" \
                || fail "nothing but function definitions and the main call at top level" "$stray"

# ...and main must be the last thing in the file, on one line with its exit, so
# that once it returns there is nothing further to read out of the script.
last_stmt=$(grep -vE '^[[:space:]]*(#|$)' "$ROOT/Budget.command" | tail -1)
printf '%s\n' "$last_stmt" | grep -qE '^main "\$@"' \
  && pass "main is invoked on the final line" \
  || fail "main is invoked on the final line" "last statement is: $last_stmt"

# A pull can also fail for a reason that has nothing to do with diverged
# history -- e.g. no upstream branch configured -- and must not be
# misdiagnosed as "your own commits" either. Separate small fixture so
# unsetting tracking here can't affect the diverged-history checks above.
echo "launcher: update (generic failure, not a false divergence diagnosis)"
tmp2=$(make_fixture)
run_app "$tmp2/app" >/dev/null
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$tmp2/app/.env.local"
git -C "$tmp2/app" branch --unset-upstream
out=$(run_update "$tmp2/app" --update)
assert_has "$out" "Could not update" "reports a generic failure for a non-divergence cause"
assert_lacks "$out" "own commits" "does not blame diverged history when there isn't any"

echo "launcher: update refuses when not updatable"
# A subfolder of a larger repo -- same construction as the "no update checks
# inside a monorepo" fixture above, but exercised through --update itself
# rather than through check_updates, and asserting on the one property that
# actually matters here: not a single git write happens.
sub2=$(mktemp -d "$SUITE_TMP/XXXXXX")
git -C "$sub2" init -q -b main
mkdir -p "$sub2/budget-claude"
( cd "$tmp/app" && git ls-files -z | tar --null -T - -cf - ) | tar -xf - -C "$sub2/budget-claude"
cp "$tmp/app/.env.local" "$tmp/app/.env" "$sub2/budget-claude/"
ln -s "$ROOT/node_modules" "$sub2/budget-claude/node_modules"
git -C "$sub2" add -A && git -C "$sub2" -c user.email=t@test -c user.name=test commit -qm mono

before_mono=$(git -C "$sub2/budget-claude" rev-parse HEAD)
out=$(run_update "$sub2/budget-claude" --update)
after_mono=$(git -C "$sub2/budget-claude" rev-parse HEAD)
assert_has "$out" "larger repository" "explains a monorepo subfolder has nothing to update"
[ "$before_mono" = "$after_mono" ] && pass "no git write inside a monorepo" \
                                    || fail "no git write inside a monorepo" \
                                            "HEAD moved from $before_mono to $after_mono"

# A real clone with no origin configured -- same "if it is cheap" check for
# the other branch of updatable() that can return false.
noorigin2=$(mktemp -d "$SUITE_TMP/XXXXXX")
git init -q -b main "$noorigin2"
( cd "$ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -xf - -C "$noorigin2"
git -C "$noorigin2" add -A && git -C "$noorigin2" -c user.email=t@test -c user.name=test commit -qm seed
ln -s "$ROOT/node_modules" "$noorigin2/node_modules"
echo 'DATABASE_URL="file:./dev.db"' > "$noorigin2/.env"
cp "$noorigin2/.env.example" "$noorigin2/.env.local"
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$noorigin2/.env.local"

before_noorigin=$(git -C "$noorigin2" rev-parse HEAD)
out=$(run_update "$noorigin2" --update)
after_noorigin=$(git -C "$noorigin2" rev-parse HEAD)
# Not "larger repository": this clone IS the whole repository, it just has
# nowhere to pull from. Telling someone to "update it from that repository
# instead" when there is no other repository is a dead end -- the message has
# to name the actual cause, and `git remote add` is the actual fix.
assert_has "$out" "no 'origin' remote" "names the real reason a clone with no origin can't update"
assert_lacks "$out" "larger repository" "doesn't misdiagnose a missing origin as a monorepo subfolder"
[ "$before_noorigin" = "$after_noorigin" ] && pass "no git write with no origin remote" \
                                            || fail "no git write with no origin remote" \
                                                    "HEAD moved from $before_noorigin to $after_noorigin"

# A linked worktree is the subtlest third of updatable(): it passes the
# clone-root check (its own toplevel) and the origin check (remotes live in
# the shared config), so only the --git-dir/--git-common-dir comparison stops
# a pull from landing in somebody else's checkout. Nothing exercised it until
# now. Origin gets a new commit first, so a HEAD that does not move is
# evidence the guard held rather than evidence there was nothing to pull.
wt=$(make_fixture)
run_app "$wt/app" >/dev/null
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$wt/app/.env.local"
git -C "$wt/app" worktree add -q -b linked "$wt/linked" origin/main
cp "$wt/app/.env.local" "$wt/app/.env" "$wt/linked/"
ln -s "$ROOT/node_modules" "$wt/linked/node_modules"
git -C "$wt/seed" -c user.email=t@test -c user.name=test commit -q --allow-empty -m "published later"
git -C "$wt/seed" push -q "$wt/origin.git" main

before_wt=$(git -C "$wt/linked" rev-parse HEAD)
out=$(run_update "$wt/linked" --update)
after_wt=$(git -C "$wt/linked" rev-parse HEAD)
assert_has "$out" "linked git worktree" "explains that a linked worktree is not updated here"
[ "$before_wt" = "$after_wt" ] && pass "no git write inside a linked worktree" \
                               || fail "no git write inside a linked worktree" \
                                       "HEAD moved from $before_wt to $after_wt"

# Structural guard, mirroring the existing ensure_db/install/build ordering
# check above: the --update path must stop the server before forcing a
# migration pass, not after -- otherwise the old process could keep
# answering requests against a freshly migrated schema for the gap between.
update_kill_line=$(grep -n 'xargs kill 2>/dev/null' "$ROOT/Budget.command" | head -1 | cut -d: -f1)
update_force_line=$(grep -n 'ensure_db force' "$ROOT/Budget.command" | head -1 | cut -d: -f1)
if [ -n "$update_kill_line" ] && [ -n "$update_force_line" ] \
   && [ "$update_kill_line" -lt "$update_force_line" ]; then
  pass "the --update path stops the server before forcing a migration (source order)"
else
  fail "the --update path stops the server before forcing a migration (source order)" \
       "kill=$update_kill_line force=$update_force_line"
fi

echo "launcher: an update started from the app"
# The app starts `--update` from inside the running server, so the launcher
# inherits `next start`'s NODE_ENV=production (npm install then drops the
# build tools) and Next's __NEXT_PROCESSED_ENV (the new server skips .env).
# Same stubbed package.json as the port test above, committed so the clone is
# clean for the pull: `build` and `start` record what they were handed, under
# .next/ (gitignored), and `start` listens on the port.
au=$(make_fixture)
cp "$port_fx/app/stub-server.js" "$au/app/stub-server.js"
node -e '
  const fs = require("fs");
  const f = process.argv[1] + "/package.json";
  const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
  pkg.scripts.build = "mkdir -p .next && echo \"${NODE_ENV:-unset} ${__NEXT_PROCESSED_ENV:-unset}\" > .next/env-seen && date +%s > .next/BUILD_ID";
  pkg.scripts.start = "node stub-server.js";
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
' "$au/app"
sed -i '' "s/'.port-seen'/'.next\/port-seen'/" "$au/app/stub-server.js"
git -C "$au/app" add -A
git -C "$au/app" -c user.email=t@test -c user.name=test commit -qm "stub build and start"
git -C "$au/app" push -q origin main
git -C "$au/app" -c user.email=t@test -c user.name=test commit -q --allow-empty -m "published"
git -C "$au/app" push -q origin main
git -C "$au/app" reset -q --hard HEAD~1
echo 'DATABASE_URL="file:./dev.db"' > "$au/app/.env"
cp "$au/app/.env.example" "$au/app/.env.local"
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$au/app/.env.local"
# An earlier app-started try that failed.
echo 1000 > "$au/app/.update-started"
echo 1 > "$au/app/.update-exit"
out=$(NODE_ENV=production __NEXT_PROCESSED_ENV=true run_update "$au/app" --update)
assert_has "$out" "ready at http://localhost:39173" "an update run with the server's environment still finishes"
seen=$(cat "$au/app/.next/env-seen" 2>/dev/null)
[ "$seen" = "unset unset" ] && pass "the build never sees the server's NODE_ENV or __NEXT_PROCESSED_ENV" \
                            || fail "the build never sees the server's NODE_ENV or __NEXT_PROCESSED_ENV" "build saw: ${seen:-<never built>}"
[ ! -e "$au/app/.update-started" ] && [ ! -e "$au/app/.update-exit" ] \
  && pass "a finished --update clears an earlier failure's state files" \
  || fail "a finished --update clears an earlier failure's state files" "$(ls -a "$au/app" | grep update-)"

echo "launcher: start at login"
tmp=$(make_fixture)
# A space in the folder name: the folder travels as its own argument, so it
# must arrive intact without any quoting inside the agent's command.
mv "$tmp/app" "$tmp/my app"
login_dir="$tmp/my app"
# The launcher resolves symlinks (/var -> /private/var), so compare against that.
login_real=$( cd "$login_dir" && pwd -P )
agents="$tmp/agents"
fakebin="$tmp/fakebin"; mkdir -p "$fakebin"
cat > "$fakebin/launchctl" <<'EOF'
#!/bin/bash
echo "$*" >> "$(dirname "$0")/launchctl.log"
EOF
chmod +x "$fakebin/launchctl"
out=$( cd "$login_dir" && LAUNCHCTL="$fakebin/launchctl" LAUNCH_AGENTS_DIR="$agents" BUDGET_PORT=39173 ./Budget.command --login on 2>&1 )
plist="$agents/local.budget.server.plist"
[ -f "$plist" ] && pass "--login on writes the agent" || fail "--login on writes the agent" "no $plist; output: $out"
plutil -lint "$plist" >/dev/null 2>&1 && pass "the agent is a valid plist" || fail "the agent is a valid plist" "$(plutil -lint "$plist" 2>&1)"
[ "$(plutil -extract ProgramArguments.5 raw "$plist" 2>/dev/null)" = "$login_real" ] \
  && pass "the folder is passed intact, space and all" \
  || fail "the folder is passed intact, space and all" "got: $(plutil -extract ProgramArguments.5 raw "$plist" 2>&1)"
[ "$(plutil -extract RunAtLoad raw "$plist" 2>/dev/null)" = true ] && [ "$(plutil -extract KeepAlive.SuccessfulExit raw "$plist" 2>/dev/null)" = false ] \
  && pass "starts at login and restarts only after a failing exit" \
  || fail "starts at login and restarts only after a failing exit" "RunAtLoad not true or KeepAlive.SuccessfulExit not false"
# The agent's own command, run against stand-in launchers: a launch that fails
# must end the job successfully (no restart, so a broken build isn't retried
# every 30s forever); a server that ran and stopped must end it with a failure
# (so launchd starts it again). Nothing listens on 39173 here, so the wait
# loop ends at once.
agent_cmd=$(plutil -extract ProgramArguments.4 raw "$plist" 2>/dev/null)
stand_in="$tmp/stand-in"; mkdir -p "$stand_in"
printf '#!/bin/bash\nexit 1\n' > "$stand_in/Budget.command"; chmod +x "$stand_in/Budget.command"
/bin/bash -c "$agent_cmd" "$stand_in" >/dev/null 2>&1
status=$?
[ "$status" -eq 0 ] && pass "a failed launch ends the agent's job without a restart" \
                    || fail "a failed launch ends the agent's job without a restart" "exit $status"
printf '#!/bin/bash\nexit 0\n' > "$stand_in/Budget.command"
/bin/bash -c "$agent_cmd" "$stand_in" >/dev/null 2>&1
status=$?
[ "$status" -eq 1 ] && pass "a server that stopped ends the job so launchd restarts it" \
                    || fail "a server that stopped ends the job so launchd restarts it" "exit $status"
assert_has "$(plutil -extract ProgramArguments.4 raw "$plist" 2>/dev/null)" "39173" "the agent watches this launcher's port"
grep -q "^bootstrap gui/$(id -u) $plist$" "$fakebin/launchctl.log" \
  && pass "loads the agent with launchctl" || fail "loads the agent with launchctl" "$(cat "$fakebin/launchctl.log")"
assert_has "$out" "--login off" "says how to turn it off"
out=$( cd "$login_dir" && LAUNCHCTL="$fakebin/launchctl" LAUNCH_AGENTS_DIR="$agents" ./Budget.command --login off 2>&1 )
[ ! -e "$plist" ] && pass "--login off removes the agent" || fail "--login off removes the agent" "still there"
grep -q "^bootout gui/$(id -u)/local.budget.server$" "$fakebin/launchctl.log" \
  && pass "unloads the agent" || fail "unloads the agent" "$(cat "$fakebin/launchctl.log")"
out=$( cd "$login_dir" && LAUNCHCTL="$fakebin/launchctl" LAUNCH_AGENTS_DIR="$agents" ./Budget.command --login maybe 2>&1 )
status=$?
[ "$status" -ne 0 ] && pass "an unknown --login value is refused" || fail "an unknown --login value is refused" "exit 0"
assert_has "$out" "--login on" "and the usage is shown"
[ ! -f "$login_dir/.env.local" ] && pass "--login never bootstraps the app" || fail "--login never bootstraps the app" ".env.local created"
out=$( cd "$login_dir" && LAUNCHCTL="$fakebin/launchctl" LAUNCH_AGENTS_DIR="$agents" ./Budget.command --login 2>&1 )
status=$?
[ "$status" -eq 1 ] && pass "--login with no value exits 1" || fail "--login with no value exits 1" "exit $status"
assert_has "$out" "--login on" "and shows the usage"
# A launchctl that refuses the agent leaves no agent file behind: the
# installer asks about start-at-login only when the file is missing.
cat > "$fakebin/launchctl" <<'EOF'
#!/bin/bash
[ "$1" = bootstrap ] && exit 5
exit 0
EOF
out=$( cd "$login_dir" && LAUNCHCTL="$fakebin/launchctl" LAUNCH_AGENTS_DIR="$agents" BUDGET_PORT=39173 ./Budget.command --login on 2>&1 )
status=$?
[ "$status" -ne 0 ] && pass "a refused bootstrap fails --login on" || fail "a refused bootstrap fails --login on" "exit 0"
[ ! -e "$plist" ] && pass "and removes the agent file it wrote" || fail "and removes the agent file it wrote" "still there"

echo "launcher: lock"
tmp=$(make_fixture)
# A live holder is a running Budget.command; this stand-in carries the name
# in its command line (`; :` keeps bash from exec-ing into sleep). Started in
# this shell, not in $(...), so the pid is in hand without waiting on it.
/bin/bash -c 'sleep 30; :' Budget.command & holder=$!
# Each takeover run below stops at the Plaid check (no .env.local), so none
# reaches a real build.
lock_run() { rm -f "$tmp/app/.env.local"; ( cd "$tmp/app" && BUDGET_PORT=39173 BUDGET_LOCK_WAIT=2 ./Budget.command --no-open 2>&1 ); }
mkdir "$tmp/app/.budget.lock"
echo "$holder" > "$tmp/app/.budget.lock/pid"
out=$( cd "$tmp/app" && BUDGET_PORT=39173 BUDGET_LOCK_WAIT=2 ./Budget.command --no-open 2>&1 )
status=$?
assert_has "$out" "Another Budget launch or update is running" "waits for a live holder"
[ "$status" -eq 1 ] && pass "gives up after the wait" || fail "gives up after the wait" "exit $status; output: $out"
assert_has "$out" "delete the .budget.lock folder in" "names the lock folder when it gives up"
[ ! -f "$tmp/app/.env.local" ] && pass "does nothing while it waits" || fail "does nothing while it waits" ".env.local created"
out=$(run_app "$tmp/app")
assert_lacks "$out" "Another Budget launch" "--check-only never waits for the lock"
kill "$holder" 2>/dev/null
echo 999999 > "$tmp/app/.budget.lock/pid"     # no such process
out=$(lock_run)
assert_lacks "$out" "Another Budget launch" "takes over a dead holder's lock"
assert_has "$out" "Plaid" "and carries on with the launch"
[ ! -e "$tmp/app/.budget.lock" ] && pass "releases the lock on exit" || fail "releases the lock on exit" "still there"
# After a power cut the old pid can belong to some other live process.
mkdir "$tmp/app/.budget.lock"; sleep 30 & other=$!; echo "$other" > "$tmp/app/.budget.lock/pid"
out=$(lock_run)
kill "$other" 2>/dev/null
assert_lacks "$out" "Another Budget launch" "takes over a lock whose pid is now another program"
# A holder that died between mkdir and writing its pid.
mkdir "$tmp/app/.budget.lock"; : > "$tmp/app/.budget.lock/pid"
touch -t 202001010000 "$tmp/app/.budget.lock/pid"
out=$(lock_run)
assert_lacks "$out" "Another Budget launch" "takes over a lock whose pid file stayed empty"

echo "launcher: what triggers a rebuild"
tmp=$(make_fixture)
echo 'DATABASE_URL="file:./dev.db"' > "$tmp/app/.env"
cp "$tmp/app/.env.example" "$tmp/app/.env.local"
mkdir -p "$tmp/app/.next"; echo fake > "$tmp/app/.next/BUILD_ID"
touch -t 202001010000 "$tmp/app/.next/BUILD_ID"
find "$tmp/app" -path "$tmp/app/node_modules" -prune -o -path "$tmp/app/.next" -prune -o -type f -exec touch -t 201901010000 {} +
touch "$tmp/app/README.md" "$tmp/app/CHANGELOG.md"
out=$(run_app "$tmp/app")
assert_lacks "$out" "rebuild is pending" "a docs-only change does not rebuild"
touch "$tmp/app/src/app/layout.tsx"
out=$(run_app "$tmp/app")
assert_has "$out" "rebuild is pending" "an app change does"

echo "launcher: update status"
tmp=$(make_fixture)
here=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)
out=$( cd "$tmp/app" && ./Budget.command --update-status 2>&1 )
[ "$out" = "{\"version\":\"$here\",\"latest\":\"$here\",\"behind\":0,\"blocker\":\"\"}" ] \
  && pass "up to date: one JSON line" || fail "up to date: one JSON line" "got: $out"
[ ! -f "$tmp/app/.env.local" ] && [ ! -e "$tmp/app/.budget.lock" ] \
  && pass "--update-status sets nothing up and takes no lock" || fail "--update-status sets nothing up and takes no lock" "files created"
sed -i '' "s/\"version\": \"$here\"/\"version\": \"9.9.9\"/" "$tmp/seed/package.json"
grep -q '"version": "9.9.9"' "$tmp/seed/package.json" \
  && pass "seed version bumped" || fail "seed version bumped" "sed did not match the seed's version line"
git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -qam "bump"
git -C "$tmp/seed" push -q "$tmp/origin.git" main
out=$( cd "$tmp/app" && ./Budget.command --update-status 2>&1 )
[ "$out" = "{\"version\":\"$here\",\"latest\":\"9.9.9\",\"behind\":1,\"blocker\":\"\"}" ] \
  && pass "behind: names the published version" || fail "behind: names the published version" "got: $out"
mono=$(mktemp -d "$SUITE_TMP/XXXXXX")
git -C "$mono" init -q
cp -R "$tmp/seed" "$mono/budget"; rm -rf "$mono/budget/.git"
out=$( cd "$mono/budget" && ./Budget.command --update-status 2>&1 )
[ "$out" = "{\"version\":\"9.9.9\",\"latest\":null,\"behind\":0,\"blocker\":\"subfolder\"}" ] \
  && pass "a subfolder reports its blocker and fetches nothing" || fail "a subfolder reports its blocker and fetches nothing" "got: $out"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
