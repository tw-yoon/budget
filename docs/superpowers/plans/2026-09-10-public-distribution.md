# Public Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Budget Claude something another developer can clone, run against their own data, and keep current — without the maintainer's data, keys, or private monorepo going with it.

**Architecture:** `budget-claude/` stays in a private monorepo and is mirrored to a public repo by a deliberate release step (planned here as `git subtree push`, which turned out not to work -- see the correction in Task 9). All new behavior lands in `Budget.command`: a bootstrap step that makes a fresh clone boot, and an update step that fetches on launch but only pulls when asked. No application code changes.

**Tech Stack:** Bash (launcher + tests), Next.js 16.2.9, Prisma 5 / SQLite, git subtree.

**Spec:** `docs/superpowers/specs/2026-09-10-public-distribution-design.md`

## Global Constraints

- Every launcher change must keep working when run by double-click from Finder, or from any GUI wrapper, which supply a minimal `PATH`. The existing `export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"` line covers this — do not remove it.
- The launcher must start the app successfully with **no network connection**. Update checking is best-effort and never blocks a launch.
- No new npm dependencies. There is no test runner in this project and this plan does not add one; launcher tests are plain Bash assertions.
- Never commit `.env`, `.env.local`, `*.db`, or `data/`. These are already in `.gitignore`; do not weaken those rules.
- macOS is the only supported launcher platform. Do not add Windows or Linux branching.
- Consult `node_modules/next/dist/docs/` before changing how the app builds or starts. This project tracks a Next.js version whose conventions differ from common knowledge.

## Spec Addendum — git root guard

The spec did not account for this: on the maintainer's machine the git root of
`budget-claude/` is **the monorepo**, not the app folder. A naive `git pull` in
the launcher would try to update the private monorepo. Every git operation in
this plan is therefore guarded by `updatable()` (Task 6), which requires the app
directory to be the clone root and to have an `origin` remote. Inside the
monorepo the guard is false and all update behavior silently disables itself.

---

### Task 1: Remove personal paths from the Venmo sandbox script

`scripts/venmo-categorize.mjs` is a standalone dev sandbox, not part of the app. It hardcodes the maintainer's `~/Downloads` statement paths and encodes personal merchants in its category rules. Both ship publicly as-is today.

Note `src/lib/venmo.ts:111` already resolves `VENMO_STATEMENT_DIR ?? join(homedir(), "Downloads")` and needs no change — only the standalone script is affected.

`.claude/settings.local.json` is also tracked, and carries machine-local
detail that has no business in a public repo. The `.local` suffix is Claude
Code's convention for machine-local settings — it should not be in git at all. `.claude/launch.json` stays; it is a useful shared dev-server
config with nothing personal in it.

**Files:**
- Modify: `scripts/venmo-categorize.mjs:23-27` (delete `DEFAULT_FILES`), `:44-51` (`RULES`), `:133` (file resolution)
- Modify: `.gitignore`
- Delete from the index (keep on disk): `.claude/settings.local.json`
- Create: `scripts/test-scrub.sh`

**Interfaces:**
- Consumes: nothing
- Produces: `scripts/test-scrub.sh`, runnable as `bash scripts/test-scrub.sh`, exit 0 on pass. Task 3 reuses its `pass`/`fail` output style but not its code.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-scrub.sh`:

```bash
#!/bin/bash
# Guards against republishing personal data in the tracked source tree.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
pass() { echo "  ok: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; echo "    $2"; FAIL=$((FAIL+1)); }

echo "scrub checks"

# No absolute home paths anywhere in tracked files.
hits=$(cd "$ROOT" && git grep -nI '/Users/' -- . ':!docs/' 2>/dev/null)
[ -z "$hits" ] && pass "no /Users/ paths in tracked source" \
               || fail "no /Users/ paths in tracked source" "$hits"

# The script must refuse to run with no arguments rather than silently
# reading someone else's Downloads folder.
out=$(node "$ROOT/scripts/venmo-categorize.mjs" 2>&1); rc=$?
[ $rc -ne 0 ] && pass "exits non-zero with no args" \
              || fail "exits non-zero with no args" "exit code was $rc"
case "$out" in *[Uu]sage*) pass "prints usage with no args";;
  *) fail "prints usage with no args" "got: $out";; esac

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-scrub.sh`
Expected: FAIL on all three — `/Users/` paths are present, and the script currently starts a server on port 4317 instead of exiting.

Note: the no-args case currently hangs (it starts an HTTP server). Press Ctrl-C; that hang is itself the failure.

- [ ] **Step 3: Make the changes**

Delete the `DEFAULT_FILES` array at `scripts/venmo-categorize.mjs:23-27` entirely.

Replace line 133:

```js
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/venmo-categorize.mjs <statement.csv> [more.csv ...]");
  console.error("Export your statements from venmo.com → Statement → Download CSV.");
  process.exit(1);
}
```

Replace the `RULES` array with generic merchant keywords. The existing entries name the maintainer's apartment building, particular restaurants and specific trips — every keyword that identifies a place rather than a kind of place must go (enumerating them here would republish the same detail this task exists to remove):

```js
const RULES = [
  [/walmart|wal\s*mart|sam.?s club|costco|grocer|target|kroger|safeway|aldi|trader/, "Groceries"],
  [/dinner|lunch|brunch|food|pizza|🍕|burger|taco|🌮|sushi|ramen|coffee|boba|bar tab/, "Dining"],
  [/uber|lyft|taxi|flight|airfare|hotel|airbnb|train|gas|parking|trip/, "Travel"],
  [/movie|🎬|museum|concert|🎟|show|game|tickets|karaoke|bowling/, "Entertainment"],
  [/rent|utilities|electric|water bill|internet|wifi|lease|deposit/, "Housing"],
  [/amazon|shop|🛍|store|order|target run/, "Shopping"],
];
```

Update the usage comment in the file header (lines 8-9) to drop the "uses the 3 default files" line.

Then untrack the local settings file, keeping your own copy on disk:

```bash
git rm --cached .claude/settings.local.json
printf '\n# machine-local Claude Code settings\n.claude/settings.local.json\n' >> .gitignore
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-scrub.sh`
Expected: `3 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add scripts/venmo-categorize.mjs scripts/test-scrub.sh .gitignore .claude/settings.local.json
git commit -m "Stop shipping one machine's details to everyone else's clone

The Venmo sandbox hardcoded three statement paths under one home
directory and named specific restaurants and trips in its category
rules. Statements now come from the command line, and the rules
describe merchant kinds instead of places someone went.

.claude/settings.local.json was tracked too, carrying machine-local
detail. The .local suffix means exactly what it says, so it is
untracked now rather than cleaned up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Add `.env.example` and `LICENSE`

The five required environment variables exist only as prose in the README. A stranger has nothing to copy.

**Files:**
- Create: `.env.example`, `LICENSE`
- Modify: `scripts/test-scrub.sh` (append an env coverage check)

**Interfaces:**
- Consumes: `scripts/test-scrub.sh` from Task 1
- Produces: `.env.example` at the repo root. Task 4's `bootstrap_env()` copies this file verbatim and substitutes only the `TOKEN_STORE_KEY` line, so the key name must appear exactly as `TOKEN_STORE_KEY=` at the start of a line.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-scrub.sh`, before the final `echo "$PASS passed..."` line:

```bash
# Every env var the code reads must be documented in .env.example, so a
# fresh clone has a complete starting point.
if [ -f "$ROOT/.env.example" ]; then
  missing=""
  for v in DATABASE_URL PLAID_CLIENT_ID PLAID_SECRET PLAID_ENV TOKEN_STORE_KEY; do
    grep -qE "^${v}=" "$ROOT/.env.example" || missing="$missing $v"
  done
  [ -z "$missing" ] && pass ".env.example documents every required var" \
                    || fail ".env.example documents every required var" "missing:$missing"
else
  fail ".env.example exists" "file not found"
fi
[ -f "$ROOT/LICENSE" ] && pass "LICENSE exists" || fail "LICENSE exists" "file not found"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-scrub.sh`
Expected: FAIL with `.env.example exists — file not found` and `LICENSE exists — file not found`.

- [ ] **Step 3: Create the files**

`.env.example`:

```bash
# Copy this to .env.local and fill it in. Budget.command does that for you on
# first launch, including generating TOKEN_STORE_KEY. Nothing here is ever
# committed — .env* is gitignored.

# Where your data lives. A file path, relative to this folder.
DATABASE_URL="file:./dev.db"

# Plaid credentials — https://dashboard.plaid.com
# Sandbox keys are free and issued instantly when you sign up. Connecting real
# banks requires separately applying to Plaid for production access, which is
# reviewed per account and billed per connected institution.
PLAID_CLIENT_ID=
PLAID_SECRET=

# "sandbox" for Plaid's fake test banks, "production" for real ones.
# PLAID_SECRET must be the secret matching whichever you choose.
PLAID_ENV=sandbox

# Encrypts your stored bank access tokens at rest. Generated automatically on
# first launch. If you lose it you must reconnect your banks; rotating it
# invalidates the existing token store.
TOKEN_STORE_KEY=

# Optional. Defaults shown; uncomment only to override.
# TOKEN_STORE_PATH=./data/tokens.enc
# VENMO_STATEMENT_DIR=~/Downloads
```

`LICENSE`: the standard MIT License text, `Copyright (c) 2026 Taewon Yoon`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-scrub.sh`
Expected: `5 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add .env.example LICENSE scripts/test-scrub.sh
git commit -m "Give a fresh clone something to copy

The five required variables only existed as prose in the README, so
there was nothing to start from. .env.example lists them with the
context that matters -- particularly that Plaid sandbox keys are
instant and production access is not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Launcher test harness and `--check-only`

Tasks 4-7 all change `Budget.command`. Testing them by hand means a 30-60s build each time. This task builds a fixture that looks like a stranger's clone, plus the flag the tests drive.

`--check-only` is a real feature, not test scaffolding: it answers "am I set up, and am I current?" without building or starting anything.

**Files:**
- Create: `scripts/test-launcher.sh`
- Modify: `Budget.command:19-30` (arg parsing), `Budget.command:12` (add `SCRIPT_DIR`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `SCRIPT_DIR` — absolute, symlink-resolved path to the app folder. Tasks 5-7 use it for every `git -C` and `npx --prefix` call.
  - `CHECK_ONLY` — bool, true when `--check-only` was passed.
  - `make_fixture()` in `scripts/test-launcher.sh` — echoes the path of a temp dir containing `origin.git` (bare) and `app/` (a clone, with `node_modules` symlinked to the real one, and no `.env.local`, `.env`, or `dev.db`). Tasks 4-7 call it as `tmp=$(make_fixture)`.
  - `run_app()` in `scripts/test-launcher.sh` — `run_app <app_dir> [args...]`, runs `./Budget.command --no-open --check-only <args>`, echoes combined stdout+stderr, never starts a server.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-launcher.sh`:

```bash
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

FIXTURES=()
cleanup() { for d in "${FIXTURES[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done; }
trap cleanup EXIT

# A bare origin plus a clone of it. Seeded from tracked files only, which is
# exactly what a stranger receives -- so anything gitignored is absent by
# construction rather than by us remembering to delete it.
make_fixture() {
  local tmp; tmp=$(mktemp -d)
  FIXTURES+=("$tmp")
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
  ( cd "$dir" && ./Budget.command --no-open --check-only "$@" 2>&1 )
}

echo "launcher: check-only"
tmp=$(make_fixture)
out=$(run_app "$tmp/app")
assert_lacks "$out" "Starting Budget" "--check-only never starts a server"
[ ! -d "$tmp/app/.next" ] && pass "--check-only never builds" \
                          || fail "--check-only never builds" ".next was created"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-launcher.sh`
Expected: FAIL — `--check-only` is not a recognized flag, so the launcher ignores it and proceeds to build and start.

- [ ] **Step 3: Add `SCRIPT_DIR` and the flag**

In `Budget.command`, immediately after the `cd "$(dirname "$0")" || exit 1` line (line 12), add:

```bash
# Absolute and symlink-resolved: every git and npx call below is anchored to
# this path rather than to whatever directory the caller happened to be in.
SCRIPT_DIR="$(pwd -P)"
```

In the arg-parsing block, add `CHECK_ONLY=false` beside the existing flags and a case arm:

```bash
    --check-only) CHECK_ONLY=true ;;
```

Then, immediately before the `if server_running && ! needs_build; then` block, add:

```bash
if $CHECK_ONLY; then
  needs_build && echo "A rebuild is pending — the next launch will take ~30–60s."
  echo "Ready. Launch with ./Budget.command"
  exit 0
fi
```

Update the usage comment at the top of the file to list `--check-only   report setup and update status without building or starting`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-launcher.sh`
Expected: `2 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add Budget.command scripts/test-launcher.sh
git commit -m "Let the launcher report status without building anything

Adds --check-only, which answers 'am I set up and am I current' in under
a second, and a test harness that drives it against a throwaway clone
seeded from tracked files only -- so gitignored data is absent by
construction rather than by remembering to delete it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Bootstrap `.env.local` on first run

A fresh clone has no `.env.local`, so the app crashes on start. It also has no `.env`, which the Prisma CLI (not Next) reads for `DATABASE_URL` — both files are needed, which is why both exist in the working copy today.

**Files:**
- Modify: `Budget.command` (new `bootstrap_env()`, called first)
- Modify: `scripts/test-launcher.sh` (append a section)

**Interfaces:**
- Consumes: `SCRIPT_DIR`, `CHECK_ONLY` (Task 3); `.env.example` (Task 2)
- Produces: `bootstrap_env()` — creates `.env` and `.env.local` when absent, exits 2 when the user must supply Plaid keys. Task 5's `ensure_db()` assumes `.env` exists and runs after it.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-launcher.sh`, before the summary line:

```bash
echo "launcher: env bootstrap"
tmp=$(make_fixture)
out=$(run_app "$tmp/app")
assert_has "$out" "Plaid" "explains that Plaid keys are needed"
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-launcher.sh`
Expected: FAIL — no `.env.local` or `.env` is created and nothing mentions Plaid.

- [ ] **Step 3: Implement `bootstrap_env()`**

Add to `Budget.command` after `SCRIPT_DIR` is set:

```bash
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
  # LC_ALL=C keeps sed from choking on non-ASCII bytes elsewhere in the file.
  LC_ALL=C sed "s|^TOKEN_STORE_KEY=.*|TOKEN_STORE_KEY=$key|" \
    "$SCRIPT_DIR/.env.example" > "$SCRIPT_DIR/.env.local"

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

bootstrap_env
```

Place the `bootstrap_env` call immediately after the function definitions and before `snapshot_db`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-launcher.sh`
Expected: `8 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add Budget.command scripts/test-launcher.sh
git commit -m "Make a fresh clone boot instead of crash

Cloning gave you no .env.local and no .env, so the first launch died on
a missing DATABASE_URL. The launcher now writes both, generates the
token encryption key itself, and stops with instructions for the one
thing it cannot derive -- Plaid credentials. Stopping beats starting a
server that only serves an error.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Create the database on first run

`Budget.command` has never run `prisma migrate deploy`. The maintainer's `dev.db` predates the launcher, so this has been invisible — and it breaks the very first clone.

**Files:**
- Modify: `Budget.command` (new `ensure_db()`, called after `needs_install`)
- Modify: `scripts/test-launcher.sh` (append a section)

**Interfaces:**
- Consumes: `SCRIPT_DIR` (Task 3), `bootstrap_env()` (Task 4)
- Produces: `ensure_db()` — runs `prisma migrate deploy` when `prisma/dev.db` is missing or has no tables. Task 7 calls it again after a pull.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-launcher.sh`:

```bash
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

# Re-running must be a no-op, not a second migration pass.
before=$(stat -f %m "$tmp/app/prisma/dev.db")
run_app "$tmp/app" >/dev/null
after=$(stat -f %m "$tmp/app/prisma/dev.db")
[ "$before" = "$after" ] && pass "leaves an existing database untouched" \
                         || fail "leaves an existing database untouched" "mtime changed"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-launcher.sh`
Expected: FAIL — `prisma/dev.db` is never created.

- [ ] **Step 3: Implement `ensure_db()`**

Add to `Budget.command` beside the other functions:

```bash
# The schema lives in migrations, not in the repo as a file, so a fresh clone
# has no database at all. migrate deploy is idempotent, but running it on every
# launch costs a second or two -- so only reach for it when there is nothing
# there, or when a pull may have brought new migrations.
ensure_db() {
  local force="${1:-}"
  if [ -z "$force" ] && [ -s "$DB" ] && sqlite3 "$DB" ".tables" 2>/dev/null | grep -q .; then
    return 0
  fi
  echo "Setting up the database…"
  if ! npx --prefix "$SCRIPT_DIR" prisma migrate deploy 2>&1 | tee -a "$LOG"; then
    echo "Database setup failed — see $LOG."
    exit 1
  fi
  npx --prefix "$SCRIPT_DIR" prisma generate >>"$LOG" 2>&1 || true
}
```

Call it after the `needs_install` / `npm install` block and before `npm run build`, since it needs `node_modules` present. In the `--check-only` path, call `ensure_db` before the status output.

Note the existing `DB="prisma/dev.db"` is a relative path and the script has already `cd`'d to its own directory, so it resolves correctly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-launcher.sh`
Expected: `11 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add Budget.command scripts/test-launcher.sh
git commit -m "Create the database the first time it is missing

The launcher never ran migrate deploy. That was invisible here because
this dev.db predates the launcher, but it meant the first person to
clone the repo got a schema-less database and a stack trace.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Report available updates on launch

**Files:**
- Modify: `Budget.command` (new `updatable()` and `check_updates()`)
- Modify: `scripts/test-launcher.sh` (append a section)

**Interfaces:**
- Consumes: `SCRIPT_DIR` (Task 3)
- Produces:
  - `updatable()` — returns 0 only when `SCRIPT_DIR` is itself the git root **and** an `origin` remote exists. Task 7 gates on this.
  - `check_updates()` — prints a one-line notice when behind; silent otherwise. Never fails a launch.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-launcher.sh`:

```bash
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

# Being behind must never stop the app from launching.
assert_has "$out" "Ready" "still reports ready when behind"

# A subfolder of a larger repo is somebody else's checkout -- never touch it.
sub=$(mktemp -d); FIXTURES+=("$sub")
git -C "$sub" init -q -b main
mkdir -p "$sub/budget-claude"
( cd "$tmp/app" && git ls-files -z | tar --null -T - -cf - ) | tar -xf - -C "$sub/budget-claude"
cp "$tmp/app/.env.local" "$tmp/app/.env" "$sub/budget-claude/"
ln -s "$ROOT/node_modules" "$sub/budget-claude/node_modules"
git -C "$sub" add -A && git -C "$sub" -c user.email=t@test -c user.name=test commit -qm mono
out=$(run_app "$sub/budget-claude")
assert_lacks "$out" "update(s) available" "no update checks inside a monorepo"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-launcher.sh`
Expected: FAIL on `counts commits behind` — nothing checks for updates yet.

- [ ] **Step 3: Implement the guard and the check**

Add to `Budget.command`:

```bash
# Updating only makes sense when this folder is the whole clone. In the
# maintainer's monorepo, budget-claude is a subfolder of a larger private
# repo -- pulling there would update the wrong project entirely -- so the
# guard is false and every update path below turns itself off.
updatable() {
  local root
  root=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ "$(cd "$root" && pwd -P)" = "$SCRIPT_DIR" ] || return 1
  git -C "$SCRIPT_DIR" remote get-url origin >/dev/null 2>&1
}

# Best-effort and always silent on failure: an offline launch is a normal
# launch. The low-speed limits stand in for `timeout`, which macOS lacks, and
# abort a stalled fetch after five seconds.
check_updates() {
  updatable || return 0
  GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=5 \
    git -C "$SCRIPT_DIR" fetch --quiet origin 2>/dev/null || return 0

  local branch behind
  branch=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null) || return 0
  git -C "$SCRIPT_DIR" rev-parse --verify --quiet "origin/$branch" >/dev/null || return 0
  behind=$(git -C "$SCRIPT_DIR" rev-list --count "HEAD..origin/$branch" 2>/dev/null) || return 0
  [ "${behind:-0}" -gt 0 ] || return 0

  echo "$behind update(s) available — run ./Budget.command --update"
}
```

Call `check_updates` after `bootstrap_env` and before `snapshot_db`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-launcher.sh`
Expected: `16 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add Budget.command scripts/test-launcher.sh
git commit -m "Notice new versions without installing them

Launch now fetches quietly and says how far behind you are, then starts
the version you already have. Applying an update stays something you
ask for -- silently rebuilding someone's finance app underneath them is
the wrong default, and one bad commit would otherwise break everyone at
once.

Guarded so it does nothing when this folder is a subdirectory of a
larger repo, which is exactly the case in the monorepo it is developed
in.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The `--update` flag

**Files:**
- Modify: `Budget.command` (new `do_update()`, new flag)
- Modify: `scripts/test-launcher.sh` (append a section)

**Interfaces:**
- Consumes: `updatable()` (Task 6), `ensure_db()` (Task 5), `SCRIPT_DIR` (Task 3)
- Produces: `do_update()` — fast-forwards, then defers to `ensure_db` and the existing `needs_install` / `needs_build` checks. No new build logic; a pull makes source files newer than `.next/BUILD_ID`, which is exactly what `needs_build()` already tests for.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-launcher.sh`:

```bash
echo "launcher: update"
tmp=$(make_fixture)
run_app "$tmp/app" >/dev/null
printf 'PLAID_CLIENT_ID=x\nPLAID_SECRET=y\n' >> "$tmp/app/.env.local"
run_app "$tmp/app" >/dev/null

git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -q --allow-empty -m newer
git -C "$tmp/seed" push -q "$tmp/origin.git" main

# A dirty tree aborts with an explanation, and changes survive.
echo "scratch" >> "$tmp/app/README.md"
out=$(run_app "$tmp/app" --update)
assert_has "$out" "uncommitted" "explains why a dirty tree stopped the update"
assert_has "$out" "git stash" "suggests how to proceed"
grep -q scratch "$tmp/app/README.md" && pass "leaves local edits intact" \
                                     || fail "leaves local edits intact" "edit was lost"
git -C "$tmp/app" checkout -q -- README.md

# Clean tree fast-forwards.
out=$(run_app "$tmp/app" --update)
msg=$(git -C "$tmp/app" log -1 --pretty=%s)
[ "$msg" = "newer" ] && pass "fast-forwards to the newest commit" \
                     || fail "fast-forwards to the newest commit" "HEAD is at: $msg"
assert_lacks "$out" "update(s) available" "reports nothing pending afterwards"

# Diverged history cannot fast-forward and must say so rather than emit raw git.
git -C "$tmp/app" -c user.email=t@test -c user.name=test commit -q --allow-empty -m local
git -C "$tmp/seed" -c user.email=t@test -c user.name=test commit -q --allow-empty -m remote
git -C "$tmp/seed" push -q "$tmp/origin.git" main
out=$(run_app "$tmp/app" --update)
assert_has "$out" "own commits" "explains diverged history in plain words"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-launcher.sh`
Expected: FAIL — `--update` is unrecognized, so nothing pulls.

- [ ] **Step 3: Implement `do_update()`**

Add `UPDATE=false` beside the other flags, a `--update) UPDATE=true ;;` case arm, and:

```bash
# Users are expected to edit things like card presets locally, so a dirty tree
# is a normal state to be in, not a failure -- say what to do about it rather
# than surfacing a raw git error.
do_update() {
  if ! updatable; then
    echo "This folder is part of a larger repository, so there is nothing to update here."
    echo "Update it from that repository instead."
    return 0
  fi

  if ! git -C "$SCRIPT_DIR" diff --quiet || ! git -C "$SCRIPT_DIR" diff --cached --quiet; then
    echo "You have uncommitted changes, so the update stopped before touching them."
    echo
    echo "  Set them aside:  git stash"
    echo "  Update:          ./Budget.command --update"
    echo "  Bring them back: git stash pop"
    exit 1
  fi

  echo "Fetching the latest version…"
  if ! GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=30 \
       git -C "$SCRIPT_DIR" pull --ff-only 2>&1; then
    echo
    echo "Could not update. This usually means you have your own commits that"
    echo "aren't in the published version, so the two histories have diverged."
    echo "Check with:  git log --oneline origin/main..HEAD"
    exit 1
  fi
}
```

Wire it in: when `$UPDATE` is true, call `do_update` in place of `check_updates`, then force `ensure_db force` so newly pulled migrations apply. The existing `needs_install` and `needs_build` checks then fire on their own, since pulled files are newer than `.next/BUILD_ID`.

Add `--update` to the usage comment at the top of the file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-launcher.sh`
Expected: `22 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add Budget.command scripts/test-launcher.sh
git commit -m "Add --update, which pulls and then gets out of the way

Fast-forward, apply any new migrations, and let the existing build
check do the rest -- a pull makes source files newer than BUILD_ID,
which is already the condition that triggers a rebuild, so no new build
logic was needed.

The two failure modes people will actually hit -- local edits in the
tree, and their own commits on top -- explain themselves instead of
printing git's version of events.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Rewrite the README for someone who has never seen this

The current README is written for the maintainer: it assumes the app is already set up and never mentions cloning, Plaid signup, or what the project is for.

**Files:**
- Modify: `README.md` (full rewrite)

**Interfaces:**
- Consumes: every flag and behavior from Tasks 1-7
- Produces: nothing code-level

- [ ] **Step 1: Write the README**

Structure, in order:

1. **What it is** — one paragraph. A local-first personal budgeting app: connects to banks via Plaid, keeps everything in SQLite on your own machine, tracks accounts and net worth, a transaction ledger, spending analytics, and credit-card benefits.
2. **Screenshot** — at minimum `/analytics` or `/benefits`. Capture from the running app and save to `public/screenshot-*.png`.
3. **Before you start** — macOS, Node 20+, git, and a Plaid account. State plainly, in this section and not lower: sandbox keys are free and instant, but **connecting real banks requires applying to Plaid for production access, which is reviewed per account and billed per connected institution.** Most people trying this out will be on sandbox.
4. **Setup** — `git clone`, then `./Budget.command`, which writes `.env.local` and stops; paste Plaid keys; run it again. Mention the macOS unidentified-developer warning and the right-click → Open workaround, which the current README already documents.
5. **Seeing data** — hit `/api/plaid/sandbox-seed` to populate fake accounts and transactions so the first screen isn't empty.
6. **Updating** — launching reports when updates exist; `./Budget.command --update` applies them. Note that `--check-only` reports status without building.
7. **Where your data lives** — `prisma/dev.db`, encrypted tokens in `data/tokens.enc`, daily snapshots in `prisma/backups/`. None of it is in git, none of it leaves the machine, and there is no server to send it to.
8. **Other platforms** — the launcher is macOS-only; `npm install && npm run build && npm start` works anywhere; Windows needs WSL. Say it directly.
9. **Pages**, **Configuration**, and **schema changes** — carry over from the current README, which is accurate.

Keep the existing "Turn it OFF" and "Good to know" material; it's useful and correct.

- [ ] **Step 2: Verify every command in it**

Run each command block in the README against the test fixture, not the working copy:

```bash
bash scripts/test-launcher.sh && bash scripts/test-scrub.sh
```

Expected: both suites pass. Then read the README start to finish as if you had never seen the project, and fix anything that assumes prior knowledge.

- [ ] **Step 3: Commit**

```bash
git add README.md public/screenshot-*.png
git commit -m "Rewrite the README for someone who just found this

The old one was written for the person who already had it running --
no clone step, no Plaid signup, no statement of what the project is.
This one leads with what it does, and puts the Plaid production wall up
top where it belongs rather than letting people discover it after
setup.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Extract and publish — REQUIRES EXPLICIT APPROVAL

> **Do not execute any step of this task without the repository owner confirming, at execution time, that they want the repository created and made public.** Publishing is outward-facing and effectively irreversible: once pushed, the code and its full history can be cloned, cached, and indexed by others regardless of later deletion. Steps 1-3 are local and safe; steps 4-5 publish. Stop before step 4 and ask.

**Files:**
- Create: `/tmp/budget-publish/` (scratch, outside the repo)
- No files in the repo change

**Interfaces:**
- Consumes: a clean working tree with Tasks 1-8 committed
- Produces: the public repo `tw-yoon/budget`, and the release workflow used for every future release

- [ ] **Step 1: Build the publishable tree — squash, do not preserve history**

**This supersedes the graft procedure originally written here.** That procedure
worked and recovered all 47 commits, but the final review established that a
scrubbed working tree does not imply a scrubbed history: the removed local
settings file, the personal category rules, the maintainer's home-directory
username and the private sibling project names all survive in earlier commits.
The audit in Step 2 greps only the tip and would have passed every one of them.

Work in a throwaway directory, never in the monorepo itself.

```bash
SCRATCH=$(mktemp -d)
cd <monorepo>/budget-claude
git ls-files -z | tar --null -T - -cf - | tar -xf - -C "$SCRATCH"
cd "$SCRATCH"
git init -q -b main
git add -A
git commit -q -m "Initial commit"
git log --oneline
```

Expected: exactly one commit. Seeding from `git ls-files` rather than copying the
directory is deliberate — gitignored data (the database, `.env.local`, `data/`,
`node_modules`) is absent by construction rather than by remembering to delete
it.

- [ ] **Step 2: Audit the tree that will actually be published**

Because there is only one commit, auditing the tip audits everything — which is
the whole point of squashing.

```bash
cd "$SCRATCH"
git grep -nIiE '/Users/|@gmail|<your-private-repo>' -- . || echo "clean: no personal paths"
find . -name '.env' -o -name '.env.local' -o -name '*.db' -o -path './data/*' | grep -v '^./.git/' || echo "clean: no secrets"
git log --all --oneline | wc -l    # must be 1
```

All three must come back clean. A count other than 1 means history came along
from somewhere and the squash did not do what it was supposed to.

Note the scrub test's own keyword list is base64-encoded, so a cleartext grep for
those terms is expected to find nothing; that is intentional, not a gap.

- [ ] **Step 3: Rehearse the stranger's experience**

```bash
rm -rf /tmp/budget-publish && mkdir -p /tmp/budget-publish
git -C "$SCRATCH/clone" archive public-budget | tar -x -C /tmp/budget-publish
cd /tmp/budget-publish && ls -la
```

Confirm by eye that there is no `.env`, no `.env.local`, no `prisma/dev.db`, no `prisma/backups/`, no `data/`, and no `scripts/.venmo-parsed.json`. Then run the real cold start:

```bash
cd /tmp/budget-publish && git init -q && git add -A \
  && git -c user.email=t@test -c user.name=test commit -qm init \
  && ./Budget.command --no-open
```

Expected: it writes `.env.local`, generates a key, and exits 2 asking for Plaid credentials. Paste real sandbox keys, run `./Budget.command` again, and confirm it installs, migrates, builds, starts, and serves a working app at `http://localhost:3000`. **This is the only step that proves the whole plan worked.** Everything before it tested pieces.

- [ ] **Step 4: STOP — get approval, then create the repository**

Confirm with the owner before running this. It is the point of no return.

```bash
gh repo create tw-yoon/budget --public \
  --description "Local-first personal budgeting. Your data stays on your machine."
```

- [ ] **Step 5: Push, and record the release workflow**

```bash
cd "$SCRATCH/clone"
git push https://github.com/tw-yoon/budget.git public-budget:main
```

Verify on GitHub that the history and README render correctly, then consider leaving Issues disabled until the support posture is decided — see the Risks section of the spec.

Every future release from the monorepo:

**Corrected 2026-09-16: the command written here -- `git subtree push
--prefix=budget-claude <public-url> main` -- cannot work, and was never run.**
`git subtree split` rebuilds the subfolder's full private history and roots it
at that history's first commit, which is unrelated to the squashed `Initial
commit` this repo is rooted at. The push is rejected as unrelated history, and
forcing it would publish the very history Step 1 squashed away. The procedure
that does work -- replaying new commits with `git format-patch --relative` and
`git am` onto a clone of the published tip -- is recorded in the spec's
Repository section, which is the single source of truth for it. No command is
left here, so that there is nothing to copy-paste by mistake.

- [ ] **Step 6: Commit the workflow note**

Add the release procedure to the spec's Repository section as the recorded one, so it is not rediscovered later.

```bash
git add docs/superpowers/specs/2026-09-10-public-distribution-design.md
git commit -m "Record how a release actually goes out

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the executor

**Run both suites before every commit:**

```bash
bash scripts/test-scrub.sh && bash scripts/test-launcher.sh
```

**Do not test against the working copy.** `scripts/test-launcher.sh` builds a
throwaway fixture for a reason: these tests write `.env.local`, run migrations,
and reset git state. Pointing them at the real `budget-claude/` checkout would
touch real financial data.

**`.env.local` is read at server start, not at build time.** Per
`node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`, server-side
environment variables are evaluated at runtime. Changing Plaid keys therefore
requires a restart, not a rebuild — worth getting right in the README.

---

## Corrections applied during execution

Every code block below was written into this plan before it had ever been run.
Executing it under review surfaced the following defects. They are recorded here
because this document is published alongside the code, and a plan whose listings
do not work is worse than no plan.

**Task 1 — the scrub test matched itself.** `scripts/test-scrub.sh` greps tracked
files for `/Users/` and necessarily contains that literal, so it passed while
untracked and failed the moment it was committed. The scan now excludes its own
file by pathspec. Task 9's audit has the same shape and the same exclusion.

**Task 2 — `.env.example` was gitignored.** `.gitignore` already carried `.env*`,
which would have excluded the example file the task exists to add. A `!.env.example`
negation was needed; `.env` and `.env.local` stay ignored.

**Task 3 — fixture cleanup never ran.** `tmp=$(make_fixture)` is a command
substitution, so `FIXTURES+=("$tmp")` executed in a subshell and never reached the
parent array. The EXIT trap deleted nothing and every run leaked a temp directory.
Replaced with a single `SUITE_TMP` parent created in the parent shell.

**Task 3 — the test suite could kill the user's running app.** `PORT` was
hardcoded to 3000 and the rebuild path runs `lsof -ti:"$PORT" | xargs kill`. The
launcher now reads `PORT="${BUDGET_PORT:-3000}"` and the harness always overrides
it, so no test can reach a real server.

**Task 3 — assertions tested only absence.** "Did not start a server" and "did not
build" both pass if the launcher crashes before either could happen. A positive
assertion on the success message was added.

**Task 4 — the `.env.local` write was neither atomic nor checked.** A redirect
truncates immediately, so an interrupted write left a partial file that the
existence check then treated as bootstrapped forever, while the code still
reported success. Now writes to a temp file in the same directory and `mv`s.

**Task 4 — the assertion count in Step 4 was wrong** (8 stated, 9 actual).

**Task 5 — migration failures were invisible.** `npx prisma migrate deploy | tee`
returns `tee`'s status, and `set -o pipefail` was not enabled until after both
call sites, so a failed migration was treated as success. Now wrapped in a
pipefail subshell.

**Task 5 — the idempotency test could not fail.** It compared `stat -f %m` before
and after, but `prisma migrate deploy` is itself idempotent and would not touch
the file even if the freshness check were deleted. Replaced with an assertion on
output that only appears when migrate is actually invoked.

**Task 5 — the ordering constraint had no coverage**, because `run_app` always
passes `--check-only` and never exercises the normal launch path. A structural
assertion on source order was added in its place.

**Task 6 — the fetch bound did not apply to SSH origins.**
`GIT_HTTP_LOW_SPEED_*` governs only git's curl transport. An SSH origin could hang
indefinitely on a host-key prompt with no TTY, blocking a launch the spec requires
to work offline. Now bounded by batch-mode SSH plus a wall-clock watchdog.

**Task 6 — `updatable()` accepted linked git worktrees.** Inside one,
`rev-parse --show-toplevel` returns the worktree's own directory and `origin` is
inherited, so the guard approved what was really a private monorepo checkout. It
now also requires `--git-dir` to equal `--git-common-dir`.

**Task 7 — the wiring instruction referenced `ensure_db` before its definition.**
The dispatch was moved after `snapshot_db`, preserving snapshot-before-mutate.

**Task 7 — `--check-only --update` pulled and migrated without restarting.**
`check_updates` was read-only at that call site; `do_update` is not. Every test in
the section unknowingly exercised this combination, because `run_app` hardcodes
`--check-only`. The combination is now rejected.

**Task 7 — the post-update assertion could not fail.**
`assert_lacks "update(s) available"` is trivially true, since `do_update` replaces
`check_updates` when `--update` is passed.

**Task 7 — the dirty-tree check ignored untracked files**, so an untracked file
colliding with an incoming change failed the pull and was then misreported as
diverged history.

**Task 7 — ruling T7-B was itself wrong.** The controller directed that the
post-update path be tested by prepending a PATH directory with a stub `npm`.
That cannot work: `Budget.command` exports
`PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"` after any PATH the harness sets,
so the real `npm` always wins. The implementer proved it rather than forcing it,
and substituted bounded real execution under its own process group with
`package-lock.json` backdating to keep `npm install` from mutating the shared
`node_modules`.

**Task 8 — the screenshot placeholder rendered as a broken image.** The
explanation sat in an HTML comment, which GitHub does not render, above a live
image tag pointing at a file that did not exist.

### What this list is for

Seventeen defects, across every task that contained shell code. None were found
by writing the plan; all were found by running it under review. The pattern is
consistent enough to state plainly: **the tests were wrong more often than the
code was.** Assertions that checked only for absence, an idempotency check that
could not fail, a cleanup trap that deleted nothing, a suite that would have
killed the user's running application — each looked correct on the page and
proved hollow the moment it ran.

A plan is a hypothesis. This one was a good hypothesis, and it was still wrong
seventeen times.
