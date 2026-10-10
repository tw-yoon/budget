#!/bin/bash
# Publishes this project to its public repository, and reports where releases
# stand.
#
#   bash scripts/release.sh prepare <minor|patch|X.Y.Z>   bump, test, build the public commit
#   bash scripts/release.sh scan            look for your real data in the prepared release
#   bash scripts/release.sh publish [--yes] push the prepared release to GitHub
#   bash scripts/release.sh status --json   what is unreleased, released, backed up
#
# Run it from the private repository only. Progress lines are plain sentences;
# when something goes wrong the last line is "Stopped: <reason>" and the exit
# code is not zero.
#
# Tests swap these through the environment: RELEASE_PUBLIC_URL (the public
# remote), RELEASE_DB (the database `scan` reads), RELEASE_TEST_CMD (the test
# run before publishing) and RELEASE_TODAY (the changelog date).
set -uo pipefail

BUDGET="$(cd "$(dirname "$0")/.." && pwd -P)"
PUBLIC_NAME="qadidas"
PUBLIC_EMAIL="taewonyoon2026@u.northwestern.edu"
PUBLIC_URL="${RELEASE_PUBLIC_URL:-https://github.com/tw-yoon/budget.git}"
PHONE_STATE="$BUDGET/ios/build/phone"
NET_SECONDS=10

say() { echo "$*"; }

# Prints the reason on the last line and exits with the given code (default 1).
stop() {
  echo "Stopped: $1"
  exit "${2:-1}"
}

# Runs a command, giving up after $NET_SECONDS. macOS has no `timeout`.
with_timeout() {
  perl -e 'alarm shift; exec @ARGV' "$NET_SECONDS" "$@"
}

# Only the private project may run this: its folder must be budget-claude/ in
# the repository. The published copy has no such parent, so it refuses.
# The work folder (public clone, prepared-release state, lock, scan files)
# lives in the repository's git folder, outside the app, so the app's build
# never sees the public copy.
guard() {
  local prefix common
  prefix=$(git -C "$BUDGET" rev-parse --show-prefix 2>/dev/null) || prefix=""
  if [ "$prefix" != "budget-claude/" ]; then
    stop "release.sh only runs in the private project." 2
  fi
  MONO=$(git -C "$BUDGET" rev-parse --show-toplevel)
  common=$(git -C "$MONO" rev-parse --path-format=absolute --git-common-dir) \
    || stop "Couldn't find the project's git folder."
  WORK="$common/budget-release"
  PUBLIC_CLONE="$WORK/public"
  STATE_FILE="$WORK/state"
  LOCK="$WORK/lock"
}

LOCK_HELD=0

# Takes the lock that keeps two release steps from running at once. A lock
# older than two hours is left over from a step that was killed; it is broken.
take_lock() {
  mkdir -p "$WORK" || stop "Couldn't make the release folder."
  if ! mkdir "$LOCK" 2>/dev/null; then
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
      rm -rf "$LOCK"
      mkdir "$LOCK" 2>/dev/null || stop "Another release step is running. Try again in a minute."
    else
      stop "Another release step is running. Try again in a minute."
    fi
  fi
  LOCK_HELD=1
}

release_lock() {
  [ "$LOCK_HELD" -eq 1 ] || return 0
  rm -rf "$LOCK"
  LOCK_HELD=0
}

# Runs on every exit: scan's temporary files and the lock go.
on_exit() {
  scan_cleanup
  release_lock
}

# The "version" in a package.json, or nothing.
package_version() {
  [ -f "$1" ] || return 0
  node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version;if(typeof v==="string")console.log(v)}catch(e){}' "$1"
}

# Reads CHANGELOG.md and prints {"unreleased":[...],"history":[...]} as JSON.
# An entry is a top-level "- " bullet with its wrapped lines joined by single
# spaces. History is the dated "## X.Y.Z — YYYY-MM-DD" headings, newest first
# (file order), at most 20.
changelog_json() {
  node -e '
    const fs = require("fs");
    let text = "";
    try { text = fs.readFileSync(process.argv[1], "utf8"); } catch (e) {}
    const unreleased = [];
    const history = [];
    let section = null;
    let entries = null;
    let current = null;
    const flush = () => { if (current !== null && entries) entries.push(current); current = null; };
    for (const line of text.split("\n")) {
      const h = line.match(/^## (.*?)\s*$/);
      if (h) {
        flush();
        const dated = h[1].match(/^(\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/);
        if (h[1] === "Unreleased") { section = "u"; entries = unreleased; }
        else if (dated) { section = "h"; const item = { version: dated[1], date: dated[2], entries: [] }; history.push(item); entries = item.entries; }
        else { section = null; entries = null; }
        continue;
      }
      if (!entries) continue;
      if (line.startsWith("- ")) { flush(); current = line.slice(2).trim(); }
      else if (line.trim() === "") { flush(); }
      else if (current !== null && /^\s/.test(line)) { current += " " + line.trim(); }
      else { flush(); }
    }
    flush();
    console.log(JSON.stringify({ unreleased, history: history.slice(0, 20) }));
  ' "$BUDGET/CHANGELOG.md"
}

# Brings origin/main in $PUBLIC_CLONE level with the public repository:
# clone once, then fetch. Leaves the clone's files alone. Returns 1 if the
# public repository cannot be reached.
fetch_public_clone() {
  mkdir -p "$WORK"
  export GIT_TERMINAL_PROMPT=0
  if [ ! -d "$PUBLIC_CLONE/.git" ]; then
    rm -rf "$PUBLIC_CLONE"
    with_timeout git clone -q "$PUBLIC_URL" "$PUBLIC_CLONE" >/dev/null 2>&1 || return 1
  else
    with_timeout git -C "$PUBLIC_CLONE" fetch -q origin >/dev/null 2>&1 || return 1
  fi
}

# fetch_public_clone, then puts the clone's files on the public tip.
refresh_public_clone() {
  fetch_public_clone || return 1
  git -C "$PUBLIC_CLONE" reset -q --hard origin/main >/dev/null 2>&1 || return 1
}

# The "version" in the public repository's package.json, from the last fetch.
fetched_public_version() {
  git -C "$PUBLIC_CLONE" show origin/main:package.json 2>/dev/null \
    | node -e 'try{const v=JSON.parse(require("fs").readFileSync(0,"utf8")).version;if(typeof v==="string")console.log(v)}catch(e){}'
}

# How many commits on main are not yet on the private remote, or nothing if
# that cannot be told.
count_not_backed_up() {
  with_timeout git -C "$MONO" fetch -q origin >/dev/null 2>&1 || return 0
  git -C "$MONO" rev-list --count origin/main..main 2>/dev/null
}

# The value of KEY in the prepared-release state file, or nothing.
state_value() {
  [ -f "$STATE_FILE" ] || return 0
  sed -n "s/^$1=//p" "$STATE_FILE" | tail -n 1
}

# "<timestamp>" of the newest failed phone install if it came after the newest
# successful one, or nothing.
phone_last_failure() {
  local log="$PHONE_STATE/log"
  [ -f "$log" ] || return 0
  awk '
    /^[0-9-]+ [0-9:]+ install: ok/ { ok = NR }
    /^[0-9-]+ [0-9:]+ install: (build failed|install failed|no phone)/ { fail = NR; stamp = $1 " " $2 }
    END { if (fail && fail > ok) print stamp }
  ' "$log"
}

# The first line of a file if it is a whole number, else nothing.
epoch_file() {
  local value
  [ -f "$1" ] || return 0
  value=$(head -n 1 "$1" | tr -d '[:space:]')
  case "$value" in ''|*[!0-9]*) ;; *) echo "$value";; esac
}

cmd_status() {
  [ "${1:-}" = "--json" ] || stop "status needs --json." 2
  local local_version public_version prepared not_backed_up mac_version
  local phone_version installed_at expires_at last_failure

  local_version=$(package_version "$BUDGET/package.json")
  public_version=""
  if fetch_public_clone; then
    public_version=$(fetched_public_version)
  fi
  prepared=$(state_value version)
  not_backed_up=$(count_not_backed_up)
  mac_version=""
  [ -f "$BUDGET/.next/budget-version" ] && mac_version=$(head -n 1 "$BUDGET/.next/budget-version" | tr -d '[:space:]')
  phone_version=""
  [ -f "$PHONE_STATE/version" ] && phone_version=$(head -n 1 "$PHONE_STATE/version" | tr -d '[:space:]')
  installed_at=$(epoch_file "$PHONE_STATE/last-success")
  expires_at=$(epoch_file "$PHONE_STATE/expires")
  last_failure=$(phone_last_failure)

  node -e '
    const [changelog, localVersion, publicVersion, prepared, notBackedUp,
      macVersion, phoneVersion, installedAt, expiresAt, lastFailure] = process.argv.slice(1);
    const str = (s) => (s === "" ? null : s);
    const num = (s) => (s === "" ? null : Number(s));
    const c = JSON.parse(changelog);
    console.log(JSON.stringify({
      unreleased: c.unreleased,
      history: c.history,
      localVersion: str(localVersion),
      publicVersion: str(publicVersion),
      prepared: str(prepared),
      notBackedUp: num(notBackedUp),
      macVersion: str(macVersion),
      phone: {
        version: str(phoneVersion),
        installedAt: num(installedAt),
        expiresAt: num(expiresAt),
        lastFailure: str(lastFailure),
      },
    }));
  ' "$(changelog_json)" "$local_version" "$public_version" "$prepared" "$not_backed_up" \
    "$mac_version" "$phone_version" "$installed_at" "$expires_at" "$last_failure"
}

# True if dotted version $1 is greater than $2.
version_gt() {
  node -e 'const a=process.argv[1].split(".").map(Number),b=process.argv[2].split(".").map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])process.exit(a[i]>b[i]?0:1)}process.exit(1)' "$1" "$2"
}

# The next version after $2 for the argument $1 (minor, patch or X.Y.Z), or
# nothing if the argument is none of those.
next_version() {
  case "$1" in
    minor) echo "$2" | awk -F. '{ print $1 "." $2 + 1 ".0" }' ;;
    patch) echo "$2" | awk -F. '{ print $1 "." $2 "." $3 + 1 }' ;;
    *) echo "$1" ;;
  esac
}

# The changelog entries of a release ("Unreleased" or a version), one per line.
changelog_entries() {
  changelog_json | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const c = JSON.parse(s), want = process.argv[1];
      const list = want === "Unreleased" ? c.unreleased : ((c.history.find(h => h.version === want) || {}).entries || []);
      for (const e of list) console.log(e);
    });' "$1"
}

# Replaces the first line matching the awk regex $2 in file $1 with text $3.
replace_first_line() {
  REPLACEMENT="$3" awk -v re="$2" '!done && $0 ~ re { print ENVIRON["REPLACEMENT"]; done = 1; next } { print }' "$1" >"$1.tmp" \
    && mv "$1.tmp" "$1"
}

# Sets the first "version" in a package.json, keeping the rest of the line.
set_package_version() {
  awk -v v="$2" '!done && sub(/"version"[ \t]*:[ \t]*"[^"]*"/, "\"version\": \"" v "\"") { done = 1 } { print }' "$1" >"$1.tmp" \
    && mv "$1.tmp" "$1"
}

# Which of the three version files does not name version $1 after a bump,
# or nothing if all three do.
unbumped_file() {
  awk -v h="## $1 — " 'index($0, h) == 1 { found = 1 } END { exit !found }' "$BUDGET/CHANGELOG.md" \
    || { echo "CHANGELOG.md"; return; }
  grep -qF "\"version\": \"$1\"" "$BUDGET/package.json" \
    || { echo "package.json"; return; }
  grep -qxF "MARKETING_VERSION = $1" "$BUDGET/ios/Config/Shared.xcconfig" \
    || { echo "ios/Config/Shared.xcconfig"; return; }
}

# Edits the files for release $1 on a branch and merges it into main. On
# failure everything is undone, main is checked out, and BUMP_FAILED names the
# file whose version didn't change (empty for any other failure).
BUMP_FAILED=""
bump_version() {
  local version="$1" branch="release-$1"
  BUMP_FAILED=""
  git -C "$MONO" switch -q -c "$branch" || return 1
  if replace_first_line "$BUDGET/CHANGELOG.md" '^## Unreleased[[:space:]]*$' "## Unreleased

## $version — ${RELEASE_TODAY:-$(date +%Y-%m-%d)}" \
    && set_package_version "$BUDGET/package.json" "$version" \
    && replace_first_line "$BUDGET/ios/Config/Shared.xcconfig" '^MARKETING_VERSION' "MARKETING_VERSION = $version" \
    && { BUMP_FAILED=$(unbumped_file "$version"); [ -z "$BUMP_FAILED" ]; } \
    && git -C "$MONO" commit -qam "Release $version" \
    && git -C "$MONO" switch -q main \
    && git -C "$MONO" merge -q --no-ff "$branch" -m "Merge $branch" \
    && git -C "$MONO" branch -q -d "$branch"; then
    return 0
  fi
  git -C "$MONO" merge --abort >/dev/null 2>&1
  git -C "$MONO" reset -q --hard >/dev/null 2>&1
  git -C "$MONO" switch -q main >/dev/null 2>&1
  git -C "$MONO" reset -q --hard >/dev/null 2>&1
  git -C "$MONO" branch -q -D "$branch" >/dev/null 2>&1
  return 1
}

# Moves the entries under "## Unreleased" to the top of the pending release
# $1, which must be the next heading, and leaves Unreleased empty. Edits
# CHANGELOG.md only; returns 1 if the layout isn't that.
fold_unreleased() {
  node -e '
    const fs = require("fs"), file = process.argv[1], version = process.argv[2];
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const u = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
    if (u < 0) process.exit(1);
    let n = u + 1;
    while (n < lines.length && !lines[n].startsWith("## ")) n++;
    if (n >= lines.length || !lines[n].startsWith("## " + version + " — ")) process.exit(1);
    const trim = (a) => { a = a.slice(); while (a.length && a[0].trim() === "") a.shift(); while (a.length && a[a.length - 1].trim() === "") a.pop(); return a; };
    const later = trim(lines.slice(u + 1, n));
    let rest = lines.slice(n + 1);
    while (rest.length && rest[0].trim() === "") rest.shift();
    const gap = rest.length && rest[0].startsWith("- ") ? [] : [""];
    const out = [...lines.slice(0, u + 1), "", lines[n], "", ...later, ...gap, ...rest];
    fs.writeFileSync(file, out.join("\n"));
  ' "$BUDGET/CHANGELOG.md" "$1"
}

# Every line a diff adds, one per line, as "path:lineno<TAB>text". Inside a
# hunk every "+" line is content; "+++ " is a file header only before the
# first "@@" of its file.
added_lines() {
  git -C "$1" diff -U0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ "$2" "$3" | awk '
    /^diff --git / { inhunk = 0; next }
    /^@@/ { s = $0; sub(/^@@ -[0-9,]+ \+/, "", s); lineno = s + 0; inhunk = 1; next }
    !inhunk && /^\+\+\+ / { file = substr($0, 7); next }
    inhunk && /^\+/ { print file ":" lineno "\t" substr($0, 2); lineno++ }'
}

# Puts the public clone back on the public tip and stops with a reason.
stop_and_reset_clone() {
  git -C "$PUBLIC_CLONE" reset -q --hard origin/main >/dev/null 2>&1
  git -C "$PUBLIC_CLONE" clean -fdq >/dev/null 2>&1
  stop "$1"
}

cmd_prepare() {
  local arg="${1:-}" version local_version public_version entries
  case "$arg" in
    minor|patch) ;;
    *) if ! printf '%s' "$arg" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
         stop "\"$arg\" isn't a version. Use minor, patch, or a number like 1.2.0." 2
       fi ;;
  esac

  # 1. Preconditions.
  [ "$(git -C "$MONO" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] \
    || stop "The project must be on the main branch. Switch to main and try again."
  [ -z "$(git -C "$MONO" status --porcelain --untracked-files=no)" ] \
    || stop "There are unsaved changes. Save or undo them and try again."

  # 2. Version.
  refresh_public_clone && public_version=$(package_version "$PUBLIC_CLONE/package.json")
  [ -n "${public_version:-}" ] || stop "Couldn't reach the public GitHub. Check the internet and try again."
  local_version=$(package_version "$BUDGET/package.json")
  entries=$(changelog_entries Unreleased)
  # A publish that reached the public GitHub but stopped before finishing:
  # keep the prepared release so publish can finish it.
  if [ -f "$STATE_FILE" ] && [ "$(state_value public)" = "$(git -C "$PUBLIC_CLONE" rev-parse origin/main)" ]; then
    version=$(state_value version)
    say "$version is already on the public GitHub."
    say "Ready: $version is prepared. Run scripts/release.sh publish to finish it."
    return 0
  fi
  if [ -n "$local_version" ] && version_gt "$local_version" "$public_version"; then
    version="$local_version"
    if [ -n "$entries" ]; then
      local count
      count=$(printf '%s\n' "$entries" | wc -l | tr -d ' ')
      if ! fold_unreleased "$version" || [ -n "$(changelog_entries Unreleased)" ] \
        || ! git -C "$MONO" commit -qam "Release $version: add later changes" >/dev/null 2>&1; then
        git -C "$MONO" checkout -q -- "$BUDGET/CHANGELOG.md" >/dev/null 2>&1
        stop "Couldn't add the later changes to $version. Nothing was changed."
      fi
      if [ "$count" -eq 1 ]; then say "Added 1 later change to $version."
      else say "Added $count later changes to $version."; fi
    fi
    say "Reusing $version, which is already prepared."
  else
    [ -n "$entries" ] || stop "Nothing new to release."
    version=$(next_version "$arg" "$public_version")
    version_gt "$version" "$public_version" \
      || stop "$version is not newer than the public version, $public_version."
    # 3. Bump.
    say "Bumping to $version."
    if ! bump_version "$version"; then
      [ -z "$BUMP_FAILED" ] || stop "Couldn't update the version in $BUMP_FAILED. Nothing was changed."
      stop "Couldn't bump the version. Nothing was changed."
    fi
  fi
  rm -f "$STATE_FILE"
  local release_commit
  release_commit=$(git -C "$MONO" rev-parse HEAD)

  # 4. Tests.
  say "Running the tests."
  (cd "$BUDGET" && eval "${RELEASE_TEST_CMD:-npm test && (cd ios && xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet)}") \
    || stop "Tests failed. Nothing was published."

  # 5. Public commit.
  say "Building the public commit."
  local base message
  base=$(git -C "$PUBLIC_CLONE" rev-parse origin/main)
  message=$(mktemp "${TMPDIR:-/tmp}/release-message.XXXXXX")
  { echo "Release $version"; echo; changelog_entries "$version" | sed 's/^/- /'; } >"$message"
  git -C "$PUBLIC_CLONE" checkout -q main \
    && git -C "$PUBLIC_CLONE" reset -q --hard origin/main \
    && git -C "$PUBLIC_CLONE" rm -rqf . >/dev/null 2>&1
  git -C "$PUBLIC_CLONE" clean -fdq
  if ! { git -C "$MONO" archive "$release_commit:budget-claude" | tar -x -C "$PUBLIC_CLONE"; } \
    || ! git -C "$PUBLIC_CLONE" add -A; then
    rm -f "$message"; stop_and_reset_clone "Couldn't copy the project into the public copy."
  fi
  if git -C "$PUBLIC_CLONE" diff --cached --quiet; then
    rm -f "$message"; stop_and_reset_clone "Nothing changed since the last public release."
  fi
  if ! GIT_AUTHOR_NAME="$PUBLIC_NAME" GIT_AUTHOR_EMAIL="$PUBLIC_EMAIL" \
    GIT_COMMITTER_NAME="$PUBLIC_NAME" GIT_COMMITTER_EMAIL="$PUBLIC_EMAIL" \
    git -C "$PUBLIC_CLONE" commit -q -F "$message"; then
    rm -f "$message"; stop_and_reset_clone "Couldn't make the public commit."
  fi

  # 6. Checks, all on the one commit just made.
  say "Checking the public commit."
  local public_head
  public_head=$(git -C "$PUBLIC_CLONE" rev-parse HEAD)
  if [ "$(git -C "$PUBLIC_CLONE" rev-parse "$public_head^{tree}")" != "$(git -C "$MONO" rev-parse "$release_commit:budget-claude")" ]; then
    rm -f "$message"; stop_and_reset_clone "The public copy doesn't match the project. Nothing was published."
  fi
  if [ "$(git -C "$PUBLIC_CLONE" rev-parse "$public_head^")" != "$base" ]; then
    rm -f "$message"; stop_and_reset_clone "The public copy doesn't build on the latest public changes. Run prepare again."
  fi
  local hit mac_path="/Us""ers/"  # split so test-scrub.sh doesn't flag this file
  # Every added line counts.
  hit=$(added_lines "$PUBLIC_CLONE" "$base" "$public_head" | awk -v p="$mac_path" '
    { i = index($0, "\t"); if (index(substr($0, i + 1), p)) { w = substr($0, 1, i - 1); sub(/:[0-9]+$/, "", w); print w; exit } }')
  if [ -z "$hit" ] && grep -qF "$mac_path" "$message"; then hit="the release message"; fi
  rm -f "$message"
  [ -z "$hit" ] || stop_and_reset_clone "A file path from this Mac is in $hit. Remove it and try again."

  # 7. Record.
  {
    echo "version=$version"
    echo "private=$release_commit"
    echo "base=$base"
    echo "public=$public_head"
  } >"$STATE_FILE"
  say "Ready: $version is prepared. Run scripts/release.sh publish to put it on GitHub."
}

# Columns that may hold the owner's real strings (table.column). Those in
# SCAN_JSON_COLUMNS hold a JSON array of strings; each string is a term.
SCAN_COLUMNS="Account.name Account.officialName Account.mask Transaction.name Transaction.merchantName Transaction.counterparty Transaction.personalNote TransactionSplit.note UserCard.name UserCard.last4 UserBenefit.name UserBenefit.notes UserBenefit.matchText PlaidItem.institution CategoryRule.pattern DebitCard.name DebitCard.last4 Subscription.name Subscription.merchantName"
SCAN_JSON_COLUMNS="UserBenefit.matchText"

SCAN_TMP=""
scan_cleanup() { [ -z "$SCAN_TMP" ] || rm -rf "$SCAN_TMP"; SCAN_TMP=""; }

# Looks for the owner's real data in the prepared release. Prints where it
# found any, never what.
cmd_scan() {
  local db="${RELEASE_DB:-$BUDGET/prisma/dev.db}" base head entry table col
  [ -f "$STATE_FILE" ] || stop "No release is prepared. Run prepare first."
  [ -f "$db" ] || stop "Couldn't find your Budget database."
  base=$(state_value base); head=$(state_value public)
  git -C "$PUBLIC_CLONE" cat-file -e "$base^{commit}" 2>/dev/null \
    && git -C "$PUBLIC_CLONE" cat-file -e "$head^{commit}" 2>/dev/null \
    || stop "The prepared release is missing. Run prepare again."
  say "Checking the release for your real data."
  mkdir -p "$WORK"
  SCAN_TMP=$(mktemp -d "$WORK/scan.XXXXXX") || stop "Couldn't make a temporary folder."

  : >"$SCAN_TMP/raw"
  local found=0 unreadable="Couldn't read your Budget database. Nothing was published." cols query
  for entry in $SCAN_COLUMNS; do
    table=${entry%%.*}; col=${entry#*.}
    cols=$(sqlite3 -readonly -init /dev/null -batch -list -noheader "$db" "PRAGMA table_info(\"$table\")" 2>/dev/null) \
      || stop "$unreadable"
    printf '%s\n' "$cols" | cut -d'|' -f2 | grep -qx "$col" || continue
    found=1
    query="SELECT DISTINCT \"$col\" FROM \"$table\" WHERE \"$col\" IS NOT NULL"
    case " $SCAN_JSON_COLUMNS " in
      *" $entry "*) query="SELECT DISTINCT j.value FROM \"$table\", json_each(\"$table\".\"$col\") AS j WHERE json_valid(\"$table\".\"$col\") AND j.type = 'text'" ;;
    esac
    sqlite3 -readonly -init /dev/null -batch -list -noheader "$db" "$query" >>"$SCAN_TMP/raw" 2>/dev/null \
      || stop "$unreadable"
  done
  [ "$found" -eq 1 ] || stop "$unreadable"
  # Trimmed, at least 4 characters, no repeats.
  sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$SCAN_TMP/raw" | awk 'length($0) >= 4 && !seen[$0]++' >"$SCAN_TMP/terms.all"
  # Drop terms the public base already contains.
  : >"$SCAN_TMP/present"
  [ ! -s "$SCAN_TMP/terms.all" ] \
    || git -C "$PUBLIC_CLONE" grep -hoiF -f "$SCAN_TMP/terms.all" "$base" >"$SCAN_TMP/present" 2>/dev/null
  awk 'FILENAME == ARGV[1] { seen[tolower($0)] = 1; next } !(tolower($0) in seen)' "$SCAN_TMP/present" "$SCAN_TMP/terms.all" >"$SCAN_TMP/terms"

  # What the release adds: diff lines, then the message lines.
  added_lines "$PUBLIC_CLONE" "$base" "$head" | awk -v w="$SCAN_TMP/where.txt" -v a="$SCAN_TMP/added.txt" \
    '{ i = index($0, "\t"); print substr($0, 1, i - 1) > w; print substr($0, i + 1) > a }'
  touch "$SCAN_TMP/where.txt" "$SCAN_TMP/added.txt"
  git -C "$PUBLIC_CLONE" log -1 --format=%B "$head" | awk -v w="$SCAN_TMP/where.txt" -v a="$SCAN_TMP/added.txt" \
    '{ print "commit message:" NR >> w; print >> a }'

  local places=0 line
  : >"$SCAN_TMP/hits"
  if [ -s "$SCAN_TMP/terms" ]; then
    grep -n -i -w -F -f "$SCAN_TMP/terms" "$SCAN_TMP/added.txt" | cut -d: -f1 >"$SCAN_TMP/hitlines"
    while read -r line; do
      sed -n "${line}p" "$SCAN_TMP/where.txt" >>"$SCAN_TMP/hits"
    done <"$SCAN_TMP/hitlines"
  fi
  while read -r line; do
    say "Private data found at $line"
    places=$((places + 1))
  done < <(awk '!seen[$0]++' "$SCAN_TMP/hits")
  scan_cleanup
  if [ "$places" -gt 0 ]; then
    if [ "$places" -eq 1 ]; then
      stop "Found 1 place that matches your real data. Nothing was published."
    fi
    stop "Found $places places that match your real data. Nothing was published."
  fi
  say "No private data found."
}

# The commit a remote's main points to, or nothing if it can't be reached.
remote_main() {
  with_timeout git ls-remote "$1" refs/heads/main 2>/dev/null | awk '{ print $1; exit }'
}

cmd_publish() {
  local yes=0 answer version base head url tip
  case "${1:-}" in
    "") ;;
    --yes) yes=1 ;;
    *) usage; exit 2 ;;
  esac
  export GIT_TERMINAL_PROMPT=0
  [ -f "$STATE_FILE" ] || stop "No release is prepared. Run prepare first."
  version=$(state_value version); base=$(state_value base); head=$(state_value public)

  # 1. Nothing moved since prepare.
  tip=$(remote_main "$PUBLIC_URL")
  [ -n "$tip" ] || stop "Couldn't reach the public GitHub. Check the internet and try again."
  git -C "$MONO" merge-base --is-ancestor "$(state_value private)" main 2>/dev/null \
    || stop "The project changed since this release was prepared. Run prepare again."
  if [ "$tip" = "$head" ]; then
    # An earlier publish got the release onto the public GitHub but stopped
    # before the end. Finish it: back up the project and clear the state.
    say "$version is already on the public GitHub. Finishing."
    finish_publish "$version"
    return
  fi
  [ "$tip" = "$base" ] || stop "The public GitHub changed since this release was prepared. Run prepare again."

  # 2. Private data.
  cmd_scan

  # 3. Summary and question.
  say "Version $version"
  say "$(git -C "$PUBLIC_CLONE" diff --stat "$base" "$head" | tail -n 1 | sed 's/^ *//')"
  changelog_entries "$version" | sed 's/^/- /'
  if [ "$yes" -ne 1 ]; then
    read -r -p 'Type yes to publish: ' answer || answer=""
    [ "$answer" = "yes" ] || stop "Not published."
  fi

  # 4. Push the private project, then the public copy.
  say "Publishing."
  git -C "$MONO" push -q origin main >/dev/null 2>&1 \
    || stop "Couldn't back up the project to your private GitHub. Nothing was published."
  git -C "$PUBLIC_CLONE" push -q origin "$head:refs/heads/main" >/dev/null 2>&1 \
    || stop "Couldn't publish to the public GitHub. Run publish again."

  # 5. Confirm both arrived.
  [ "$(remote_main "$PUBLIC_URL")" = "$head" ] \
    || stop "The public copy didn't arrive on GitHub. Run publish again."
  finish_publish "$version"
}

# Makes sure the private remote has main, then clears the prepared release.
finish_publish() {
  local url
  git -C "$MONO" push -q origin main >/dev/null 2>&1 \
    || stop "Couldn't back up the project to your private GitHub. Run publish again."
  url=$(git -C "$MONO" remote get-url origin 2>/dev/null)
  [ "$(remote_main "$url")" = "$(git -C "$MONO" rev-parse main)" ] \
    || stop "The private copy didn't arrive on GitHub. Run publish again."
  rm -f "$STATE_FILE"
  say "Published $1. Friends can update now."
}

usage() {
  echo "Usage: bash scripts/release.sh prepare <minor|patch|X.Y.Z> | scan | publish [--yes] | status --json"
}

main() {
  guard
  trap on_exit EXIT
  trap 'exit 130' INT TERM HUP
  case "${1:-}" in
    prepare) shift; take_lock; cmd_prepare "$@" ;;
    scan) take_lock; cmd_scan ;;
    publish) shift; take_lock; cmd_publish "$@" ;;
    status) shift; cmd_status "$@" ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
