#!/bin/bash
# Drives scripts/release.sh against throwaway repos in a temp folder: a private
# monorepo, its bare "origin", and a bare "public" repo. Never GitHub, never the
# real database, never the real phone state.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
REAL_SCRIPT="$ROOT/scripts/release.sh"
PASS=0; FAIL=0
pass() { echo "  ok: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; echo "    $2"; FAIL=$((FAIL+1)); }
assert_has() { case "$1" in *"$2"*) pass "$3";; *) fail "$3" "expected to find: $2 in: $1";; esac; }
assert_lacks() { case "$1" in *"$2"*) fail "$3" "should not contain: $2";; *) pass "$3";; esac; }
assert_eq() { if [ "$1" = "$2" ]; then pass "$3"; else fail "$3" "expected [$2], got [$1]"; fi; }
assert_fails() { if [ "$RC" -ne 0 ]; then pass "$1"; else fail "$1" "exit code was 0"; fi; }
assert_rc() { if [ "$RC" -eq "$1" ]; then pass "$2"; else fail "$2" "exit code was $RC, expected $1"; fi; }

SUITE_TMP=$(mktemp -d)
[ -n "$SUITE_TMP" ] || { echo "mktemp failed" >&2; exit 1; }
trap 'rm -rf "$SUITE_TMP"' EXIT

# Invented identity for the throwaway repos.
export GIT_AUTHOR_NAME="Test" GIT_AUTHOR_EMAIL="test@example.com" \
       GIT_COMMITTER_NAME="Test" GIT_COMMITTER_EMAIL="test@example.com" \
       GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
git() { command git -c init.defaultBranch=main "$@"; }

# The tree every world starts from, written into $1 (a budget-claude folder).
write_tree() {
  local dir="$1"
  mkdir -p "$dir/ios/Config" "$dir/scripts"
  cat >"$dir/package.json" <<'JSON'
{
  "name": "budget",
  "version": "0.1.0",
  "private": true
}
JSON
  cat >"$dir/CHANGELOG.md" <<'MD'
# Changelog

Intro text.

## Unreleased

- First new thing.
- Second new thing that is long
  and wraps onto a second line.

## 0.1.0 — 2026-01-01

- Initial release.
MD
  echo "MARKETING_VERSION = 0.1.0" >"$dir/ios/Config/Shared.xcconfig"
  echo "# Budget" >"$dir/README.md"
}

# A fresh world in $W: $MONO (private monorepo with budget-claude/), $ORIGIN
# (its bare remote), $PUBLIC (bare public repo holding the same tree at its
# root). Exports the RELEASE_* overrides. $BUDGET is the project folder and
# $SCRIPT the copy of release.sh inside it.
make_world() {
  W=$(mktemp -d "$SUITE_TMP/world.XXXXXX")
  MONO="$W/mono"; ORIGIN="$W/origin.git"; PUBLIC="$W/public.git"
  BUDGET="$MONO/budget-claude"; SCRIPT="$BUDGET/scripts/release.sh"
  WORKDIR="$MONO/.git/budget-release"
  mkdir -p "$MONO"
  git -C "$MONO" init -q
  write_tree "$BUDGET"
  cp "$REAL_SCRIPT" "$SCRIPT"
  printf '/build\n/.next/\n' >"$BUDGET/.gitignore"
  git -C "$MONO" add -A
  git -C "$MONO" commit -q -m "Start"
  git init -q --bare "$ORIGIN"
  git -C "$MONO" remote add origin "$ORIGIN"
  git -C "$MONO" push -q origin main
  local seed="$W/seed"
  mkdir -p "$seed"
  git -C "$seed" init -q
  write_tree "$seed"
  cp "$REAL_SCRIPT" "$seed/scripts/release.sh"
  printf '/build\n/.next/\n' >"$seed/.gitignore"
  git -C "$seed" add -A
  git -C "$seed" commit -q -m "Public start"
  git init -q --bare "$PUBLIC"
  git -C "$seed" push -q "$PUBLIC" main
  export RELEASE_PUBLIC_URL="file://$PUBLIC" RELEASE_TEST_CMD=true \
         RELEASE_TODAY=2026-02-02 RELEASE_DB="$W/none.db"
}
# Runs release.sh in the current world: sets OUT and RC.
release() {
  OUT=$(bash "$SCRIPT" "$@" 2>&1); RC=$?
}
# Reads one JSON field of $OUT with a JS expression over `j`.
json() {
  printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=('"$1"');console.log(JSON.stringify(v))})'
}
# A fake phone state folder in the current world.
phone_state() {
  mkdir -p "$BUDGET/ios/build/phone"
}

echo "status"

make_world
release status --json
assert_rc 0 "status --json succeeds"
assert_eq "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 1 "prints exactly one line"
assert_eq "$(json 'j.unreleased.length')" 2 "two unreleased entries"
assert_eq "$(json 'j.unreleased[0]')" '"First new thing."' "first entry"
assert_eq "$(json 'j.unreleased[1]')" '"Second new thing that is long and wraps onto a second line."' "wrapped entry joined"
assert_eq "$(json 'j.history[0].version')" '"0.1.0"' "history version"
assert_eq "$(json 'j.history[0].date')" '"2026-01-01"' "history date"
assert_eq "$(json 'j.history[0].entries[0]')" '"Initial release."' "history entries"
assert_eq "$(json 'j.localVersion')" '"0.1.0"' "local version"
assert_eq "$(json 'j.publicVersion')" '"0.1.0"' "public version"
assert_eq "$(json 'j.prepared')" null "nothing prepared"
assert_eq "$(json 'j.notBackedUp')" 0 "everything backed up"
assert_eq "$(json 'j.macVersion')" null "no Mac build yet"
assert_eq "$(json 'j.phone.version')" null "no phone version"
assert_eq "$(json 'j.phone.installedAt')" null "no phone install time"
assert_eq "$(json 'j.phone.expiresAt')" null "no phone expiry"
assert_eq "$(json 'j.phone.lastFailure')" null "no phone failure"

echo "status: backups, Mac build, prepared"

make_world
echo more >>"$BUDGET/README.md"
git -C "$MONO" commit -q -am "Local change"
release status --json
assert_eq "$(json 'j.notBackedUp')" 1 "one change not backed up"
mkdir -p "$BUDGET/.next"; echo "0.1.0" >"$BUDGET/.next/budget-version"
release status --json
assert_eq "$(json 'j.macVersion')" '"0.1.0"' "Mac build version read"
mkdir -p "$WORKDIR"; printf 'version=0.2.0\nother=x\n' >"$WORKDIR/state"
release status --json
assert_eq "$(json 'j.prepared')" '"0.2.0"' "prepared version read"

echo "status: offline"

make_world
export RELEASE_PUBLIC_URL="file://$W/missing.git"
git -C "$MONO" remote set-url origin "$W/missing-origin.git"
release status --json
assert_rc 0 "still succeeds with nothing reachable"
assert_eq "$(json 'j.publicVersion')" null "public version null"
assert_eq "$(json 'j.notBackedUp')" null "not-backed-up null"

echo "status: leaves the public copy alone"

make_world
release prepare minor
CLONE_HEAD=$(git -C "$WORKDIR/public" rev-parse HEAD)
release status --json
assert_rc 0 "status after prepare succeeds"
assert_eq "$(git -C "$WORKDIR/public" rev-parse HEAD)" "$CLONE_HEAD" "status keeps the prepared commit checked out"
assert_eq "$(json 'j.publicVersion')" '"0.1.0"' "public version read from the fetched tip"
assert_eq "$(json 'j.prepared')" '"0.2.0"' "prepared still reported"

echo "lock"

make_world
mkdir -p "$WORKDIR/lock"
release prepare minor
assert_fails "prepare refused while another step runs"
assert_eq "$(printf '%s\n' "$OUT" | tail -n 1)" "Stopped: Another release step is running. Try again in a minute." "lock message"
assert_eq "$(git -C "$MONO" rev-list --count HEAD)" 1 "nothing bumped under someone else's lock"
[ -d "$WORKDIR/lock" ] && pass "someone else's lock is kept" || fail "someone else's lock is kept" "lock removed"
release scan
assert_eq "$(printf '%s\n' "$OUT" | tail -n 1)" "Stopped: Another release step is running. Try again in a minute." "scan waits for the lock"
release publish --yes
assert_eq "$(printf '%s\n' "$OUT" | tail -n 1)" "Stopped: Another release step is running. Try again in a minute." "publish waits for the lock"
release status --json
assert_rc 0 "status ignores the lock"
touch -t "$(date -v-3H +%Y%m%d%H%M)" "$WORKDIR/lock"
release prepare minor
assert_rc 0 "a lock older than two hours is broken"
[ ! -e "$WORKDIR/lock" ] && pass "lock removed after prepare" || fail "lock removed after prepare" "lock left"
RELEASE_TEST_CMD=false release prepare minor
[ ! -e "$WORKDIR/lock" ] && pass "lock removed after a failed prepare" || fail "lock removed after a failed prepare" "lock left"

echo "status: phone"

make_world
phone_state
P="$BUDGET/ios/build/phone"
echo 0.1.0 >"$P/version"; echo 1791359746 >"$P/last-success"; echo 1791964552 >"$P/expires"
printf '2026-10-09 08:00:00 install: start\n2026-10-09 08:01:00 install: ok\n2026-10-09 09:19:36 install: build failed\n' >"$P/log"
release status --json
assert_eq "$(json 'j.phone.version')" '"0.1.0"' "phone version"
assert_eq "$(json 'j.phone.installedAt')" 1791359746 "phone install time"
assert_eq "$(json 'j.phone.expiresAt')" 1791964552 "phone expiry"
assert_eq "$(json 'j.phone.lastFailure')" '"2026-10-09 09:19:36"' "failure after last ok shows"
printf '2026-10-09 07:00:00 install: no phone\n2026-10-09 08:01:00 install: ok (old signature)\n' >"$P/log"
release status --json
assert_eq "$(json 'j.phone.lastFailure')" null "failure before last ok is hidden"
printf '2026-10-09 07:00:00 install: install failed\n' >"$P/log"
release status --json
assert_eq "$(json 'j.phone.lastFailure')" '"2026-10-09 07:00:00"' "failure with no ok at all shows"
printf '2026-10-09 07:00:00 install: ok\nerror: install: build failed (raw tool output)\n' >"$P/log"
release status --json
assert_eq "$(json 'j.phone.lastFailure')" null "raw tool output without a timestamp is ignored"

echo "guard and usage"

make_world
mkdir -p "$W/mono/other/scripts"
cp "$REAL_SCRIPT" "$W/mono/other/scripts/release.sh"
OUT=$(bash "$W/mono/other/scripts/release.sh" status --json 2>&1); RC=$?
assert_rc 2 "refuses outside budget-claude"
assert_eq "$(printf '%s\n' "$OUT" | tail -n 1)" "Stopped: release.sh only runs in the private project." "says why"
release bogus
assert_rc 2 "unknown command exits 2"
assert_has "$OUT" "Usage" "unknown command prints usage"
release
assert_rc 2 "no command exits 2"

# Reads a file of the clone's HEAD or of the monorepo.
mono_show() { git -C "$MONO" show "$1" 2>/dev/null; }
clone_git() { git -C "$WORKDIR/public" "$@"; }
last_line() { printf '%s\n' "$OUT" | tail -n 1; }

echo "prepare: minor"

make_world
PUB_BEFORE=$(git -C "$PUBLIC" rev-parse main)
release prepare minor
assert_rc 0 "prepare minor succeeds"
assert_eq "$(last_line)" "Ready: 0.2.0 is prepared. Run scripts/release.sh publish to put it on GitHub." "final line"
assert_eq "$(git -C "$MONO" log -1 --format=%s)" "Merge release-0.2.0" "merge commit on main"
assert_eq "$(git -C "$MONO" rev-parse --abbrev-ref HEAD)" main "back on main"
assert_eq "$(git -C "$MONO" branch --list 'release-*')" "" "release branch deleted"
assert_eq "$(sed -n '5,9p' "$BUDGET/CHANGELOG.md" | tr '\n' '|')" "## Unreleased||## 0.2.0 — 2026-02-02||- First new thing.|" "changelog renamed"
assert_has "$(cat "$BUDGET/package.json")" '"version": "0.2.0"' "package.json bumped"
assert_eq "$(cat "$BUDGET/ios/Config/Shared.xcconfig")" "MARKETING_VERSION = 0.2.0" "xcconfig bumped"
C="$WORKDIR/public"
assert_eq "$(clone_git log -1 --format=%s)" "Release 0.2.0" "public commit subject"
BODY=$(clone_git log -1 --format=%b)
assert_has "$BODY" "- First new thing." "body has first entry"
assert_has "$BODY" "- Second new thing that is long and wraps onto a second line." "body has joined entry"
assert_eq "$(clone_git rev-parse 'HEAD^{tree}')" "$(git -C "$MONO" rev-parse HEAD:budget-claude)" "public tree equals release tree"
assert_eq "$(clone_git rev-parse 'HEAD^')" "$PUB_BEFORE" "parent is public tip"
assert_eq "$(clone_git log -1 --format='%an <%ae>|%cn <%ce>')" "qadidas <taewonyoon2026@u.northwestern.edu>|qadidas <taewonyoon2026@u.northwestern.edu>" "public identity"
assert_eq "$(sed -n 's/^version=//p' "$WORKDIR/state")" 0.2.0 "state version"
assert_eq "$(sed -n 's/^private=//p' "$WORKDIR/state")" "$(git -C "$MONO" rev-parse HEAD)" "state private"
assert_eq "$(sed -n 's/^base=//p' "$WORKDIR/state")" "$PUB_BEFORE" "state base"
assert_eq "$(sed -n 's/^public=//p' "$WORKDIR/state")" "$(clone_git rev-parse HEAD)" "state public"
assert_eq "$(git -C "$PUBLIC" rev-parse main)" "$PUB_BEFORE" "nothing pushed"
MERGES=$(git -C "$MONO" rev-list --count HEAD)
release prepare minor
assert_rc 0 "second prepare succeeds"
assert_has "$OUT" "Ready: 0.2.0" "still 0.2.0"
assert_eq "$(git -C "$MONO" rev-list --count HEAD)" "$MERGES" "no second bump"
assert_eq "$(clone_git rev-parse 'HEAD^')" "$PUB_BEFORE" "rebuilt on same base"
node -e 'const f=process.argv[1],fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("## Unreleased\n","## Unreleased\n\n- Newer thing.\n"))' "$BUDGET/CHANGELOG.md"
git -C "$MONO" commit -q -am "More"
release prepare minor
assert_rc 0 "pending bump plus new entries folds them in"
assert_has "$OUT" "Added 1 later change to 0.2.0." "says it added the change"
assert_has "$(last_line)" "Ready: 0.2.0" "still 0.2.0 after folding"
assert_eq "$(git -C "$MONO" log -1 --format=%s)" "Release 0.2.0: add later changes" "fold commit on main"
assert_eq "$(git -C "$MONO" rev-parse --abbrev-ref HEAD)" main "back on main after folding"
assert_eq "$(git -C "$MONO" status --porcelain --untracked-files=no)" "" "nothing left unsaved after folding"
assert_eq "$(sed -n '5,11p' "$BUDGET/CHANGELOG.md" | tr '\n' '|')" "## Unreleased||## 0.2.0 — 2026-02-02||- Newer thing.|- First new thing.|- Second new thing that is long|" "later change moved under 0.2.0"
assert_eq "$(clone_git rev-parse 'HEAD^{tree}')" "$(git -C "$MONO" rev-parse HEAD:budget-claude)" "public tree has the later change"
assert_has "$(clone_git log -1 --format=%b)" "- Newer thing." "public message has the later change"
assert_eq "$(sed -n 's/^private=//p' "$WORKDIR/state")" "$(git -C "$MONO" rev-parse HEAD)" "state private is the fold commit"
assert_eq "$(git -C "$MONO" log --format=%s | grep -c '^Merge release')" 1 "still one bump"
node -e 'const f=process.argv[1],fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("## Unreleased\n","## Unreleased\n\n- Third thing.\n- Fourth thing.\n"))' "$BUDGET/CHANGELOG.md"
git -C "$MONO" commit -q -am "Even more"
release prepare minor
assert_has "$OUT" "Added 2 later changes to 0.2.0." "counts two later changes"
assert_rc 0 "second fold succeeds"
[ ! -e "$BUDGET/build/release" ] && pass "nothing written inside the app folder" || fail "nothing written inside the app folder" "build/release exists"

echo "prepare: patch and exact"

make_world
release prepare patch
assert_has "$OUT" "Ready: 0.1.1" "patch gives 0.1.1"
make_world
release prepare 1.0.0
assert_has "$OUT" "Ready: 1.0.0" "exact version"
make_world
release prepare 0.0.9
assert_fails "older exact version refused"
assert_eq "$(last_line | cut -c1-8)" "Stopped:" "stopped line"
assert_eq "$(git -C "$MONO" rev-list --count HEAD)" 1 "nothing committed"
release prepare bogus
assert_rc 2 "bad argument exits 2"
for bad in 1.2.3. 1.2.3.4 1..2.3 01.2.3; do
  release prepare "$bad"
  assert_rc 2 "malformed version $bad refused"
  assert_eq "$(last_line)" "Stopped: \"$bad\" isn't a version. Use minor, patch, or a number like 1.2.0." "message for $bad"
  assert_eq "$(git -C "$MONO" rev-list --count HEAD)" 1 "main untouched by $bad"
done

echo "prepare: refusals"

make_world
echo x >>"$BUDGET/README.md"
release prepare minor
assert_fails "dirty tracked file refused"
assert_eq "$(last_line | cut -c1-8)" "Stopped:" "dirty stopped"
git -C "$MONO" checkout -q -- .
echo x >"$BUDGET/untracked.txt"
release prepare minor
assert_rc 0 "untracked file allowed"
make_world
git -C "$MONO" switch -q -c side
release prepare minor
assert_fails "other branch refused"
assert_has "$(last_line)" "main" "mentions main"
make_world
node -e 'const f=process.argv[1],fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/- First[\s\S]*?line\.\n/,""))' "$BUDGET/CHANGELOG.md"
git -C "$MONO" commit -q -am "Empty"
release prepare minor
assert_fails "empty Unreleased refused"
assert_eq "$(last_line)" "Stopped: Nothing new to release." "says nothing new"
make_world
echo "OTHER = 1" >"$BUDGET/ios/Config/Shared.xcconfig"
git -C "$MONO" commit -q -am "No marketing version"
MAIN_BEFORE=$(git -C "$MONO" rev-parse main)
release prepare minor
assert_fails "missing MARKETING_VERSION stops the bump"
assert_eq "$(last_line)" "Stopped: Couldn't update the version in ios/Config/Shared.xcconfig. Nothing was changed." "names the file"
assert_eq "$(git -C "$MONO" rev-parse main)" "$MAIN_BEFORE" "nothing merged"
assert_eq "$(git -C "$MONO" rev-parse --abbrev-ref HEAD)" main "back on main after a failed bump"
assert_eq "$(git -C "$MONO" branch --list 'release-*')" "" "branch deleted after a failed bump"
assert_eq "$(git -C "$MONO" status --porcelain --untracked-files=no)" "" "edits undone after a failed bump"
make_world
export RELEASE_PUBLIC_URL="file://$W/missing.git"
release prepare minor
assert_fails "unreachable public refused"
assert_eq "$(last_line)" "Stopped: Couldn't reach the public GitHub. Check the internet and try again." "network message"

echo "prepare: checks"

make_world
RELEASE_TEST_CMD=false release prepare minor
assert_fails "failing tests stop it"
assert_eq "$(last_line)" "Stopped: Tests failed. Nothing was published." "tests message"
[ ! -e "$WORKDIR/state" ] && pass "no state file" || fail "no state file" "state exists"
release prepare minor
assert_rc 0 "re-run after failed tests reuses the bump"
assert_eq "$(git -C "$MONO" log --format=%s | grep -c '^Merge release')" 1 "one merge only"
make_world
mkdir -p "$BUDGET/docs"
echo "see /Us""ers/someone/x" >"$BUDGET/docs/notes.md"
git -C "$MONO" add -A; git -C "$MONO" commit -q -m "Add notes"
release prepare minor
assert_fails "path from this Mac stops it"
assert_has "$(last_line)" "docs/notes.md" "names the file"
[ ! -e "$WORKDIR/state" ] && pass "no state after path stop" || fail "no state after path stop" "state exists"
assert_eq "$(clone_git rev-parse HEAD)" "$(git -C "$PUBLIC" rev-parse main)" "clone reset to public tip"

make_world
mkdir -p "$BUDGET/docs"
printf '%s\n' "+ /Us""ers/someone/x" >"$BUDGET/docs/bullets.md"
git -C "$MONO" add -A; git -C "$MONO" commit -q -m "Add bullets"
release prepare minor
assert_fails "added line starting with + still checked"
assert_has "$(last_line)" "docs/bullets.md" "names the bullet file"

# A fixture database with invented data in $W/fixture.db; exports RELEASE_DB.
make_db() {
  rm -f "$W/fixture.db"
  sqlite3 "$W/fixture.db" <<'SQL'
CREATE TABLE Account (id INTEGER PRIMARY KEY, name TEXT, mask TEXT);
CREATE TABLE "Transaction" (id INTEGER PRIMARY KEY, name TEXT, merchantName TEXT);
INSERT INTO Account (name, mask) VALUES ('Example Bank', '0042');
CREATE TABLE PlaidItem (id INTEGER PRIMARY KEY, institution TEXT);
INSERT INTO PlaidItem (institution) VALUES ('Quillfeather Credit Union');
INSERT INTO "Transaction" (name, merchantName) VALUES ('Zephyrine Bakery', NULL);
INSERT INTO "Transaction" (name, merchantName) VALUES ('ab', '  ');
SQL
  export RELEASE_DB="$W/fixture.db"
}
# Adds a file to the monorepo and commits it.
mono_add() {
  case "$MONO" in "$SUITE_TMP"/?*) ;; *) echo "mono_add outside a temp world" >&2; exit 1;; esac
  mkdir -p "$(dirname "$BUDGET/$1")"
  printf '%s\n' "$2" >>"$BUDGET/$1"
  git -C "$MONO" add -A; git -C "$MONO" commit -q -m "Add $1"
}

echo "scan"

make_world; make_db
release scan
assert_fails "scan needs a prepared release"
assert_eq "$(last_line)" "Stopped: No release is prepared. Run prepare first." "no state message"
release prepare minor
RELEASE_DB="$W/none.db" release scan
assert_fails "missing database stops scan"
assert_eq "$(last_line)" "Stopped: Couldn't find your Budget database." "database message"
release scan
assert_rc 0 "clean release passes scan"
assert_eq "$(last_line)" "No private data found." "clean message"
[ -z "$(ls "$WORKDIR" | grep -v -e '^public$' -e '^state$')" ] && pass "scan temp files removed" || fail "scan temp files removed" "$(ls "$WORKDIR")"

make_world; make_db
mono_add README.md "Lunch at zephyrine bakery"
release prepare minor
release scan
assert_rc 1 "private term in a README stops scan"
assert_has "$OUT" "Private data found at README.md:2" "names file and line"
assert_lacks "$OUT" "ephyrine" "never prints the term"
assert_lacks "$OUT" "Lunch" "never prints the line"
assert_eq "$(last_line)" "Stopped: Found 1 place that matches your real data. Nothing was published." "hit summary"

make_world; make_db
git clone -q "$PUBLIC" "$W/pub2"
echo "We bank with Example Bank." >>"$W/pub2/README.md"
git -C "$W/pub2" commit -q -am "Mention bank"; git -C "$W/pub2" push -q origin main
mono_add docs/more.md "We use Example Bank, ab, and id 004200."
release prepare minor
release scan
assert_rc 0 "term already public, short term and partial word are ignored"

make_world; make_db
sed -i.bak 's/^- First new thing\./- Zephyrine Bakery view./' "$BUDGET/CHANGELOG.md"; rm -f "$BUDGET/CHANGELOG.md.bak"
git -C "$MONO" commit -q -am "Entry"
release prepare minor
release scan
assert_rc 1 "private term in the message stops scan"
assert_has "$OUT" "Private data found at commit message:3" "names the message line"
assert_lacks "$OUT" "ephyrine" "message term not printed"

echo "publish"

make_world; make_db
release prepare minor
release publish --yes
assert_rc 0 "publish --yes succeeds"
assert_has "$OUT" "Version 0.2.0" "summary has version"
assert_has "$OUT" "files changed" "summary has files changed"
assert_has "$OUT" "- First new thing." "summary has entries"
assert_eq "$(last_line)" "Published 0.2.0. Friends can update now." "success line"
assert_eq "$(git -C "$PUBLIC" rev-parse main)" "$(clone_git rev-parse HEAD)" "public repo has the release"
assert_eq "$(git -C "$ORIGIN" rev-parse main)" "$(git -C "$MONO" rev-parse main)" "private remote has main"
[ ! -e "$WORKDIR/state" ] && pass "state removed" || fail "state removed" "state exists"
release publish --yes
assert_fails "publish with nothing prepared fails"

make_world; make_db
PUB_BEFORE=$(git -C "$PUBLIC" rev-parse main); ORIGIN_BEFORE=$(git -C "$ORIGIN" rev-parse main)
release prepare minor
OUT=$(printf 'no\n' | bash "$SCRIPT" publish 2>&1); RC=$?
assert_fails "answering no does not publish"
assert_eq "$(last_line)" "Stopped: Not published." "not published line"
assert_eq "$(git -C "$PUBLIC" rev-parse main)" "$PUB_BEFORE" "public untouched after no"
assert_eq "$(git -C "$ORIGIN" rev-parse main)" "$ORIGIN_BEFORE" "private remote untouched after no"
OUT=$(printf 'yes\n' | bash "$SCRIPT" publish 2>&1); RC=$?
assert_rc 0 "typing yes publishes"
assert_eq "$(git -C "$PUBLIC" rev-parse main)" "$(clone_git rev-parse HEAD)" "published after yes"

make_world; make_db
release prepare minor
git clone -q "$PUBLIC" "$W/pub2"
echo "later" >>"$W/pub2/README.md"
git -C "$W/pub2" commit -q -am "Someone else"; git -C "$W/pub2" push -q origin main
PUB_MOVED=$(git -C "$PUBLIC" rev-parse main); ORIGIN_BEFORE=$(git -C "$ORIGIN" rev-parse main)
release publish --yes
assert_fails "moved public tip refused"
assert_eq "$(last_line)" "Stopped: The public GitHub changed since this release was prepared. Run prepare again." "moved tip message"
assert_eq "$(git -C "$PUBLIC" rev-parse main)" "$PUB_MOVED" "public not pushed"
assert_eq "$(git -C "$ORIGIN" rev-parse main)" "$ORIGIN_BEFORE" "private remote not pushed"

make_world; make_db
release prepare minor
mono_add notes.md "unrelated work"
release publish --yes
assert_rc 0 "unrelated commit on main after prepare is fine"
assert_eq "$(git -C "$ORIGIN" rev-parse main)" "$(git -C "$MONO" rev-parse main)" "private remote has the newer main"

make_world; make_db
release prepare minor
git -C "$MONO" reset -q --hard HEAD~1
ORIGIN_BEFORE=$(git -C "$ORIGIN" rev-parse main)
release publish --yes
assert_fails "main without the release commit refused"
assert_eq "$(last_line)" "Stopped: The project changed since this release was prepared. Run prepare again." "changed message"
assert_eq "$(git -C "$ORIGIN" rev-parse main)" "$ORIGIN_BEFORE" "nothing pushed after change"

make_world; make_db
release prepare minor
RECORDED=$(sed -n 's/^public=//p' "$WORKDIR/state")
release status --json
release publish --yes
assert_rc 0 "publish works after status --json"
assert_eq "$(git -C "$PUBLIC" rev-parse main)" "$RECORDED" "public main is the recorded commit"

make_world; make_db
release prepare minor
RECORDED=$(sed -n 's/^public=//p' "$WORKDIR/state")
git -C "$WORKDIR/public" push -q origin "$RECORDED:refs/heads/main"
release prepare minor
assert_rc 0 "prepare after a half-finished publish keeps the release"
assert_has "$OUT" "0.2.0 is already on the public GitHub." "says it is already public"
assert_has "$(last_line)" "Ready: 0.2.0 is prepared." "ready line for the half-finished release"
assert_eq "$(sed -n 's/^public=//p' "$WORKDIR/state")" "$RECORDED" "state kept"
release publish --yes
assert_rc 0 "publish finishes a half-finished publish"
assert_eq "$(last_line)" "Published 0.2.0. Friends can update now." "finished line"
assert_eq "$(git -C "$PUBLIC" rev-parse main)" "$RECORDED" "public still the recorded commit"
assert_eq "$(git -C "$ORIGIN" rev-parse main)" "$(git -C "$MONO" rev-parse main)" "private remote backed up"
[ ! -e "$WORKDIR/state" ] && pass "state removed after finishing" || fail "state removed after finishing" "state exists"

make_world
echo "not a database" >"$W/junk.db"
release prepare minor
RELEASE_DB="$W/junk.db" release scan
assert_fails "non-database stops scan"
assert_eq "$(last_line)" "Stopped: Couldn't read your Budget database. Nothing was published." "unreadable message"
sqlite3 "$W/empty.db" "CREATE TABLE Other (x TEXT);"
RELEASE_DB="$W/empty.db" release scan
assert_fails "database with none of the columns stops scan"
assert_eq "$(last_line)" "Stopped: Couldn't read your Budget database. Nothing was published." "no columns message"

make_world; make_db
mono_add docs/bank.md "Joined Quillfeather Credit Union"
release prepare minor
release scan
assert_rc 1 "institution name is scanned"
assert_lacks "$OUT" "Quillfeather" "institution not printed"

# Adds the card, note and benefit tables to the fixture database.
more_db() {
  sqlite3 "$W/fixture.db" <<'SQL'
CREATE TABLE UserCard (id INTEGER PRIMARY KEY, name TEXT, last4 TEXT);
INSERT INTO UserCard (name, last4) VALUES ('Sample Rewards Card', '7319');
CREATE TABLE DebitCard (id INTEGER PRIMARY KEY, name TEXT, last4 TEXT);
INSERT INTO DebitCard (name, last4) VALUES ('Sample Debit', '8264');
CREATE TABLE UserBenefit (id INTEGER PRIMARY KEY, name TEXT, notes TEXT, matchText TEXT);
INSERT INTO UserBenefit (name, notes, matchText) VALUES ('Sample Credit', NULL, '["Glimmerwick Rail", "zz"]');
INSERT INTO UserBenefit (name, notes, matchText) VALUES ('Other Credit', NULL, 'not json');
ALTER TABLE "Transaction" ADD COLUMN personalNote TEXT;
INSERT INTO "Transaction" (name, personalNote) VALUES ('Sample Mart', 'Gift for Brindlewood');
SQL
}
for planted in "card ending 7319" "debit 8264 here" "Ride on glimmerwick rail" "Note: gift for brindlewood."; do
  make_world; make_db; more_db
  mono_add docs/planted.md "$planted"
  release prepare minor
  release scan
  assert_rc 1 "scan finds: ${planted%% *}..."
  assert_has "$OUT" "Private data found at docs/planted.md:1" "names the file for ${planted%% *}"
done
make_world; make_db; more_db
mono_add docs/planted.md "Order 173190 and code 82645 stay."
release prepare minor
release scan
assert_rc 0 "last4 inside a longer number is not a match"

make_world; make_db
mono_add README.md "Lunch at zephyrine bakery"
release prepare minor
PUB_BEFORE=$(git -C "$PUBLIC" rev-parse main); ORIGIN_BEFORE=$(git -C "$ORIGIN" rev-parse main)
release publish --yes
assert_fails "publish with a match fails"
assert_lacks "$OUT" "ephyrine" "publish never prints the term"
assert_eq "$(last_line | cut -c1-8)" "Stopped:" "publish stopped line"
assert_eq "$(git -C "$PUBLIC" rev-parse main)" "$PUB_BEFORE" "public not pushed on match"
assert_eq "$(git -C "$ORIGIN" rev-parse main)" "$ORIGIN_BEFORE" "private remote not pushed on match"
[ -e "$WORKDIR/state" ] && pass "state kept on match" || fail "state kept on match" "state missing"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
