# Updates From the App, Auto-Start at Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install updates from a button (web + iPhone), start Budget at login, number the launcher's steps, and show the phone how current it and the Mac are.

**Architecture:** `Budget.command` stays the one place that knows how to update, build and start. It gains `--login on|off`, `--update-status` (one JSON line), numbered steps and a lock. The server's `/api/update` reads `--update-status` and starts `--update` as a detached process. The web page and the iPhone app poll that route.

**Tech Stack:** bash (macOS), Next.js 16 route handlers + React client component, Node test runner, SwiftUI / Swift 6 / Swift Testing.

**Spec:** `docs/superpowers/specs/2026-10-06-self-update-design.md`. Read it before each task.

## Global Constraints

- Work only in this worktree, on branch `self-update`. Every commit command checks the branch first: `test "$(git branch --show-current)" = self-update && git commit …`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The live server (`http://localhost:3000`) holds real money data: only GET requests to it, ever. Never POST `/api/update` to it. Tests use temp folders, fakes and `StubURLProtocol`.
- Launcher tests use port 39173 (`BUDGET_PORT`), never 3000.
- No absolute paths, real names, institutions or amounts in code, docs or commits (public repo). Run `bash scripts/test-scrub.sh` before each commit.
- iOS: never edit `project.pbxproj` (folder-synchronized groups pick up new files). Suites using `StubURLProtocol` nest under `extension StubbedNetworkTests { @Suite(.serialized) … }`. Inside `Task {}` use `do throws(APIError)`.
- iOS test command (run from `ios/`): `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Web tests: `node --import ./scripts/resolve-alias.mjs --test scripts/<file>.mjs`; full suite `npm test`.
- Match surrounding style: comments explain why, like the existing ones in `Budget.command`.
- Gitignore every state file the launcher or server writes: `.budget.lock`, `.update-started`, `.update-exit`, `.update.log`, `.launchd.log`.

---

### Task 1: `Budget.command --login on|off`

**Files:**
- Modify: `Budget.command` (usage header, new functions above `main`, argument parsing in `main`)
- Modify: `.gitignore` (add `.launchd.log` if missing)
- Test: `scripts/test-launcher.sh` (new section before the final `echo "$PASS passed…"`)

**Interfaces:**
- Produces: `./Budget.command --login on` / `--login off`; env overrides `LAUNCHCTL` (default `launchctl`), `LAUNCH_AGENTS_DIR` (default `$HOME/Library/LaunchAgents`); agent label `local.budget.server`. Used by Task 7's installer.

- [ ] **Step 1: Write the failing test** — append to `scripts/test-launcher.sh` before the summary line:

```bash
echo "launcher: start at login"
tmp=$(make_fixture)
# A space in the folder name: the folder travels as its own argument, so it
# must arrive intact without any quoting inside the agent's command.
mv "$tmp/app" "$tmp/my app"
login_dir="$tmp/my app"
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
[ "$(plutil -extract ProgramArguments.5 raw "$plist" 2>/dev/null)" = "$login_dir" ] \
  && pass "the folder is passed intact, space and all" \
  || fail "the folder is passed intact, space and all" "got: $(plutil -extract ProgramArguments.5 raw "$plist" 2>&1)"
[ "$(plutil -extract RunAtLoad raw "$plist" 2>/dev/null)" = true ] && [ "$(plutil -extract KeepAlive raw "$plist" 2>/dev/null)" = true ] \
  && pass "starts at login and restarts when it stops" || fail "starts at login and restarts when it stops" "RunAtLoad/KeepAlive not true"
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/test-launcher.sh 2>&1 | grep -A1 "start at login" ; bash scripts/test-launcher.sh 2>&1 | tail -1`
Expected: FAIL lines for "--login on writes the agent" etc.

- [ ] **Step 3: Implement.** In `Budget.command`, add to the usage header comment:

```bash
#   --login on     start Budget when you log in (and restart it if it stops)
#   --login off    stop doing that
```

Add above `main()`:

```bash
# Start at login: one LaunchAgent in ~/Library/LaunchAgents, written and
# removed only here -- the same shape as ios/scripts/phone.sh's schedule.
# The agent runs this launcher, then waits while the port is served; when the
# server stops, the agent's job ends and launchd's KeepAlive runs it again.
# The folder is handed to `bash -c` as $0 rather than written into the
# command, so no path can break the command's quoting.
LOGIN_LABEL="local.budget.server"

xml_escape() {
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

login_on() {
  local plist dir
  plist="$LAUNCH_AGENTS_DIR/$LOGIN_LABEL.plist"
  dir=$(printf '%s' "$SCRIPT_DIR" | xml_escape)
  mkdir -p "$LAUNCH_AGENTS_DIR" || { echo "Couldn't create $LAUNCH_AGENTS_DIR."; return 1; }
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LOGIN_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd "\$0" &amp;&amp; ./Budget.command --no-open; while lsof -nP -iTCP:$PORT -sTCP:LISTEN &gt;/dev/null 2&gt;&amp;1; do sleep 30; done</string>
    <string>$dir</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$dir/.launchd.log</string>
  <key>StandardErrorPath</key><string>$dir/.launchd.log</string>
</dict>
</plist>
EOF
  "$LAUNCHCTL" bootout "gui/$(id -u)/$LOGIN_LABEL" >/dev/null 2>&1
  if ! "$LAUNCHCTL" bootstrap "gui/$(id -u)" "$plist" >>"$LOG" 2>&1; then
    echo "launchctl couldn't load $plist. Details: $LOG"
    return 1
  fi
  echo "Budget now starts when you log in, and starts again if it stops."
  echo "It also keeps the Mac from going to sleep on its own while it runs, so your phone can reach it."
  echo "Turn it off with: ./Budget.command --login off"
}

login_off() {
  "$LAUNCHCTL" bootout "gui/$(id -u)/$LOGIN_LABEL" >/dev/null 2>&1
  rm -f "$LAUNCH_AGENTS_DIR/$LOGIN_LABEL.plist"
  echo "Budget no longer starts when you log in."
}
```

In `main`, replace the `for arg in "$@"` loop with a `while` loop that can read `--login`'s value, and handle it right after the loop (before the `--check-only`/`--update` conflict check and before `bootstrap_env`):

```bash
  NO_OPEN=false
  FORCE=false
  CHECK_ONLY=false
  UPDATE=false
  LOGIN=""
  LOGIN_GIVEN=false
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-open) NO_OPEN=true ;;
      --rebuild) FORCE=true ;;
      --check-only) CHECK_ONLY=true ;;
      --update) UPDATE=true ;;
      --login) LOGIN_GIVEN=true; LOGIN="${2:-}"; [ $# -gt 0 ] && shift ;;
    esac
    shift
  done

  LAUNCHCTL="${LAUNCHCTL:-launchctl}"
  LAUNCH_AGENTS_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
  # --login only manages the LaunchAgent: no setup, no build, no start.
  if $LOGIN_GIVEN; then
    case "$LOGIN" in
      on) login_on; exit $? ;;
      off) login_off; exit 0 ;;
      *) echo "Usage: ./Budget.command --login on   (or --login off)"; exit 1 ;;
    esac
  fi
```

(Careful with `shift` on `--login` as the last argument: `LOGIN` is empty and the loop must still terminate — the guarded `shift` plus the loop's own `shift` must not run `shift` on an empty list; test with `./Budget.command --login`.)

Add `.launchd.log` to `.gitignore` if it isn't there.

- [ ] **Step 4: Run the tests**

Run: `bash scripts/test-launcher.sh 2>&1 | tail -3` and `bash scripts/test-scrub.sh | tail -1`
Expected: `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = self-update && git add Budget.command .gitignore scripts/test-launcher.sh && git commit -m "Budget: --login on/off starts Budget at login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Launcher lock and numbered steps

**Files:**
- Modify: `Budget.command` (`main`: lock before `bootstrap_env`; steps in the build/start blocks)
- Modify: `.gitignore` (`.budget.lock`)
- Test: `scripts/test-launcher.sh` (new sections; update the two `assert_has "$out" "Code changed"` lines only if their wording no longer matches — the new step text keeps "Code changed" so they should pass unchanged)

**Interfaces:**
- Produces: `.budget.lock/pid`; env `BUDGET_LOCK_WAIT` (seconds, default 900). Step lines `Step N of M: …`. Task 4's detached update relies on the lock to keep a launchd restart from building at the same time.

- [ ] **Step 1: Write the failing tests** — append before the summary line:

```bash
echo "launcher: lock"
tmp=$(make_fixture)
mkdir "$tmp/app/.budget.lock"
sleep 30 & holder=$!
echo "$holder" > "$tmp/app/.budget.lock/pid"
out=$( cd "$tmp/app" && BUDGET_PORT=39173 BUDGET_LOCK_WAIT=2 ./Budget.command --no-open 2>&1 )
status=$?
kill "$holder" 2>/dev/null
assert_has "$out" "Another Budget launch or update is running" "waits for a live holder"
[ "$status" -eq 1 ] && pass "gives up after the wait" || fail "gives up after the wait" "exit $status; output: $out"
[ ! -f "$tmp/app/.env.local" ] && pass "does nothing while it waits" || fail "does nothing while it waits" ".env.local created"
echo 999999 > "$tmp/app/.budget.lock/pid"     # no such process
out=$( cd "$tmp/app" && BUDGET_PORT=39173 BUDGET_LOCK_WAIT=2 ./Budget.command --no-open 2>&1 )
assert_lacks "$out" "Another Budget launch" "takes over a dead holder's lock"
assert_has "$out" "Plaid" "and carries on with the launch"
[ ! -e "$tmp/app/.budget.lock" ] && pass "releases the lock on exit" || fail "releases the lock on exit" "still there"
mkdir "$tmp/app/.budget.lock"; sleep 30 & holder=$!; echo "$holder" > "$tmp/app/.budget.lock/pid"
out=$(run_app "$tmp/app")
kill "$holder" 2>/dev/null; rm -rf "$tmp/app/.budget.lock"
assert_lacks "$out" "Another Budget launch" "--check-only never waits for the lock"

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
```

In the existing `launcher: update` section, next to the existing `assert_has "$out" "Code changed" "the existing rebuild check fires on its own after the pull"`, add:

```bash
assert_has "$out" "Step 1 of 2: Code changed since the last build" "the build is numbered among the steps left"
assert_lacks "$out" "Step 0" "steps count from 1"
```

(That fixture's `package-lock.json` is stamped so no install runs: build + start = 2 steps.)

- [ ] **Step 2: Run to verify they fail**

Run: `bash scripts/test-launcher.sh 2>&1 | grep FAIL`
Expected: the lock and step assertions fail (the docs-only test may already pass — that's the point of pinning it).

- [ ] **Step 3: Implement.** Above `main()`:

```bash
# One launch or update at a time. Start-at-login restarts Budget whenever the
# server stops -- which an update does on purpose -- and without this the
# restart would begin its own build in the middle of the update's. A holder
# that died without cleaning up (a crash, a closed Terminal) leaves its pid
# behind; a pid that no longer answers is taken over.
take_lock() {
  local waited=0 holder
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    holder=$(cat "$LOCK_DIR/pid" 2>/dev/null)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$LOCK_DIR"
      continue
    fi
    [ "$waited" -eq 0 ] && echo "Another Budget launch or update is running — waiting…"
    if [ "$waited" -ge "$LOCK_WAIT" ]; then
      echo "Still busy after $LOCK_WAIT seconds, so this launch stopped. Try again in a minute."
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo $$ > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
}

# "Step 2 of 3: …" for the work a launch actually does.
step() {
  STEP=$((STEP + 1))
  echo "Step $STEP of $STEPS: $1"
}
```

In `main`, set `LOCK_DIR=".budget.lock"` and `LOCK_WAIT="${BUDGET_LOCK_WAIT:-900}"` with the other variables. Immediately after the `--check-only`/`--update` conflict check and before `bootstrap_env`:

```bash
  # --check-only only reads, so it never waits behind a running update.
  $CHECK_ONLY || take_lock
```

After the `if $UPDATE … else check_updates fi` block and the `$CHECK_ONLY` block, right before `if server_running && ! needs_build; then`, count the steps:

```bash
  # Counted after any pull: what it brought decides whether a build is due.
  STEP=0
  STEPS=0
  if needs_build; then
    needs_install && STEPS=$((STEPS + 1))
    STEPS=$((STEPS + 2))
  elif ! server_running; then
    STEPS=1
  fi
```

Replace `echo "Code changed since the last build — updating Budget (~30–60s)…"` with nothing (delete it), replace `echo "Installing dependencies…"` with `step "Installing dependencies…"`, put `step "Code changed since the last build — building (~30–60s)…"` immediately before `set -o pipefail` / `npm run build`, and replace `echo "Starting Budget…"` with `step "Starting Budget…"`.

Add `.budget.lock` to `.gitignore`.

- [ ] **Step 4: Run the tests**

Run: `bash scripts/test-launcher.sh 2>&1 | tail -3`
Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = self-update && git add Budget.command .gitignore scripts/test-launcher.sh && git commit -m "Budget: one launch at a time; numbered steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `Budget.command --update-status`

**Files:**
- Modify: `Budget.command` (extract the bounded fetch out of `check_updates` into `fetch_origin`; add `update_status_json`; flag in `main`)
- Test: `scripts/test-launcher.sh`

**Interfaces:**
- Produces: `./Budget.command --update-status` prints exactly one line `{"version":"<v>","latest":"<v>"|null,"behind":<n>,"blocker":"<blocker>"}` and exits 0. Never builds, starts, bootstraps or takes the lock. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```bash
echo "launcher: update status"
tmp=$(make_fixture)
here=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)
out=$( cd "$tmp/app" && ./Budget.command --update-status 2>&1 )
[ "$out" = "{\"version\":\"$here\",\"latest\":\"$here\",\"behind\":0,\"blocker\":\"\"}" ] \
  && pass "up to date: one JSON line" || fail "up to date: one JSON line" "got: $out"
[ ! -f "$tmp/app/.env.local" ] && [ ! -e "$tmp/app/.budget.lock" ] \
  && pass "--update-status sets nothing up and takes no lock" || fail "--update-status sets nothing up and takes no lock" "files created"
sed -i '' "s/\"version\": \"$here\"/\"version\": \"9.9.9\"/" "$tmp/seed/package.json"
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/test-launcher.sh 2>&1 | grep -A2 "update status"`
Expected: FAIL (the flag is unknown, so the launcher runs its normal path).

- [ ] **Step 3: Implement.** Split `check_updates`: move the backgrounded fetch and its 10s polling loop into

```bash
# The bounded, prompt-free fetch both update checks use. Returns non-zero
# when it failed or ran past its 10s cap; either way nothing is left running.
fetch_origin() {
  GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -oBatchMode=yes -oConnectTimeout=5" \
  GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=5 \
    git -C "$SCRIPT_DIR" fetch --quiet origin 2>/dev/null &
  local fetch_pid=$! tries=0
  while kill -0 "$fetch_pid" 2>/dev/null; do
    if [ "$tries" -ge 100 ]; then
      kill "$fetch_pid" 2>/dev/null
      wait "$fetch_pid" 2>/dev/null
      return 1
    fi
    sleep 0.1
    tries=$((tries + 1))
  done
  wait "$fetch_pid" 2>/dev/null
}
```

(keep the existing explanatory comments with it), so `check_updates` begins `updatable || return 0; fetch_origin || return 0` and is otherwise unchanged. Then add:

```bash
# --update-status: what the app's Settings → Updates shows, as one JSON line
# for the server to read (src/lib/updater.ts). Read-only: no setup, no lock.
update_status_json() {
  local blocker version latest="" behind=0 branch
  blocker=$(update_blocker)
  version=$(app_version)
  if [ -z "$blocker" ] && fetch_origin; then
    branch=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ -n "$branch" ] && git -C "$SCRIPT_DIR" rev-parse --verify --quiet "origin/$branch" >/dev/null; then
      behind=$(git -C "$SCRIPT_DIR" rev-list --count "HEAD..origin/$branch" 2>/dev/null)
      latest=$(git -C "$SCRIPT_DIR" show "origin/$branch:package.json" 2>/dev/null | read_version)
    fi
  fi
  local latest_json=null
  [ -n "$latest" ] && latest_json="\"$latest\""
  printf '{"version":"%s","latest":%s,"behind":%d,"blocker":"%s"}\n' \
    "$version" "$latest_json" "${behind:-0}" "$blocker"
}
```

In `main`'s argument loop add `--update-status) UPDATE_STATUS=true ;;` (initialise `UPDATE_STATUS=false`), and right after the `--login` handling:

```bash
  if $UPDATE_STATUS; then
    update_status_json
    exit 0
  fi
```

Add `#   --update-status  print this clone's version and the published one, as JSON` to the usage header.

- [ ] **Step 4: Run the tests**

Run: `bash scripts/test-launcher.sh 2>&1 | tail -3`
Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = self-update && git add Budget.command scripts/test-launcher.sh && git commit -m "Budget: --update-status reports versions as JSON

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server updater and `/api/update`

**Files:**
- Create: `src/lib/updater.ts`, `src/lib/update-poll.ts`, `src/app/api/update/route.ts`, `scripts/test-updater.mjs`
- Modify: `src/types/index.ts` (add `UpdateStatusDTO`), `package.json` (`test` script lists `scripts/test-updater.mjs` after `scripts/test-server-timing.mjs`), `.gitignore` (`.update-started`, `.update-exit`, `.update.log`)

**Interfaces:**
- Consumes: `./Budget.command --update-status` (Task 3) output; `withServerTiming` from `src/lib/server-timing.ts`.
- Produces:
  - `UpdateStatusDTO = { version: string; latest: string | null; available: boolean; canUpdate: boolean; updating: boolean; failed: string | null; checkedAt: string }` in `src/types/index.ts`.
  - `GET /api/update[?check=1]` → `UpdateStatusDTO`; `POST /api/update` (body `{}`) → `202 {ok:true}` | `409 {error}`.
  - `pollOutcome(startVersion: string, s: UpdateStatusDTO | null): "waiting" | "done" | "failed"` in `src/lib/update-poll.ts` (Task 5 uses it; Task 6 ports it).
  - Error strings (Task 5/6 show them as sent): `"This copy is updated from its repository, not from here."`, `"Budget is already up to date."`, `"An update is already running."`.

- [ ] **Step 1: Write the failing test** `scripts/test-updater.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUpdater, parseLauncherStatus, readUpdateState, UPDATE_COMMAND } from "../src/lib/updater.ts";
import { pollOutcome } from "../src/lib/update-poll.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "updater-"));
const line = (o) => JSON.stringify({ version: "1.0.0", latest: "1.1.0", behind: 2, blocker: "", ...o }) + "\n";

function fake(dir, out = line({}), now = 1_000_000) {
  const calls = { status: 0, start: 0 };
  const clock = { now };
  const updater = createUpdater({
    dir,
    runStatus: async () => { calls.status++; return out; },
    startUpdate: () => { calls.start++; },
    now: () => clock.now,
  });
  return { updater, calls, clock };
}

test("parses the launcher's line, ignoring anything printed before it", () => {
  assert.deepEqual(parseLauncherStatus("noise\n" + line({})), { version: "1.0.0", latest: "1.1.0", behind: 2, blocker: "" });
  assert.throws(() => parseLauncherStatus("not json"));
});

test("status maps the launcher's answer", async () => {
  const { updater } = fake(tmp());
  const s = await updater.status();
  assert.equal(s.version, "1.0.0");
  assert.equal(s.latest, "1.1.0");
  assert.equal(s.available, true);
  assert.equal(s.canUpdate, true);
  assert.equal(s.updating, false);
  assert.equal(s.failed, null);
});

test("a blocker means no Install", async () => {
  const { updater } = fake(tmp(), line({ blocker: "subfolder", latest: null, behind: 0 }));
  const s = await updater.status();
  assert.equal(s.canUpdate, false);
  assert.equal(s.available, false);
});

test("the launcher runs at most once an hour unless asked", async () => {
  const { updater, calls, clock } = fake(tmp());
  await updater.status();
  await updater.status();
  assert.equal(calls.status, 1);
  await updater.status(true);
  assert.equal(calls.status, 2);
  clock.now += 60 * 60 * 1000 + 1;
  await updater.status();
  assert.equal(calls.status, 3);
});

test("start writes the start time, clears the last exit and spawns once", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".update-exit"), "1\n");
  const { updater, calls } = fake(dir);
  assert.deepEqual(await updater.start(), { ok: true });
  assert.equal(calls.start, 1);
  assert.equal(fs.readFileSync(path.join(dir, ".update-started"), "utf8").trim(), "1000000");
  assert.equal(fs.existsSync(path.join(dir, ".update-exit")), false);
  assert.equal((await updater.status()).updating, true);
  assert.deepEqual(await updater.start(), { error: "An update is already running." });
  assert.equal(calls.start, 1);
});

test("start refuses a copy that can't update, and an up-to-date one", async () => {
  assert.deepEqual(await fake(tmp(), line({ blocker: "subfolder" })).updater.start(),
    { error: "This copy is updated from its repository, not from here." });
  assert.deepEqual(await fake(tmp(), line({ behind: 0, latest: "1.0.0" })).updater.start(),
    { error: "Budget is already up to date." });
});

test("updating ends with the exit file, or after 15 minutes", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".update-started"), "1000000\n");
  assert.equal(readUpdateState(dir, 1_000_000 + 1000).updating, true);
  assert.equal(readUpdateState(dir, 1_000_000 + 15 * 60 * 1000 + 1).updating, false);
  fs.writeFileSync(path.join(dir, ".update-exit"), "0\n");
  fs.utimesSync(path.join(dir, ".update-exit"), 1001, 1001); // seconds: after the start
  assert.deepEqual(readUpdateState(dir, 1_002_000), { updating: false, failed: null });
});

test("a non-zero exit reports the log's last five lines", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".update-started"), "1000000\n");
  fs.writeFileSync(path.join(dir, ".update.log"), "a\nb\n\nc\nd\ne\nf\n\n");
  fs.writeFileSync(path.join(dir, ".update-exit"), "1\n");
  fs.utimesSync(path.join(dir, ".update-exit"), 1001, 1001);
  assert.deepEqual(readUpdateState(dir, 1_002_000), { updating: false, failed: "b\nc\nd\ne\nf" });
});

test("the update runs the launcher detached and records its exit", () => {
  assert.equal(UPDATE_COMMAND, "./Budget.command --update --no-open > .update.log 2>&1; echo $? > .update-exit");
});

test("polling is done once the version changed and the update ended", () => {
  const base = { version: "1.0.0", latest: "1.1.0", available: true, canUpdate: true, updating: false, failed: null, checkedAt: "" };
  assert.equal(pollOutcome("1.0.0", null), "waiting");
  assert.equal(pollOutcome("1.0.0", { ...base, updating: true }), "waiting");
  assert.equal(pollOutcome("1.0.0", { ...base, version: "1.1.0", updating: true }), "waiting");
  assert.equal(pollOutcome("1.0.0", { ...base, version: "1.1.0" }), "done");
  assert.equal(pollOutcome("1.0.0", { ...base, failed: "boom" }), "failed");
});
```

Add `scripts/test-updater.mjs` to `package.json`'s `test` script after `scripts/test-server-timing.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --import ./scripts/resolve-alias.mjs --test scripts/test-updater.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Add to `src/types/index.ts`:

```ts
/** GET /api/update — Settings → Updates (web) and About (iPhone). */
export interface UpdateStatusDTO {
  version: string;
  latest: string | null;
  available: boolean;
  canUpdate: boolean;
  updating: boolean;
  failed: string | null;
  checkedAt: string;
}
```

`src/lib/update-poll.ts`:

```ts
import type { UpdateStatusDTO } from "@/types";

// Where an Install stands, from one poll of GET /api/update. A failed request
// (null) is normal while the server is stopped for the update. Done needs both
// the new version and the update's end: the launcher pulls before it stops the
// old server, so the old server can briefly report the new version.
export function pollOutcome(
  startVersion: string,
  s: UpdateStatusDTO | null
): "waiting" | "done" | "failed" {
  if (!s) return "waiting";
  if (s.failed) return "failed";
  if (!s.updating && s.version !== startVersion) return "done";
  return "waiting";
}
```

`src/lib/updater.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import type { UpdateStatusDTO } from "@/types";

// Updating from the app (docs/superpowers/specs/2026-10-06-self-update-design.md).
// Budget.command stays the one place that knows how to update: this reads its
// --update-status line and starts its --update, detached, so the update
// outlives the server it stops. Process calls are injected for the tests.

export const STATUS_TTL_MS = 60 * 60 * 1000;
export const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;
export const UPDATE_COMMAND =
  "./Budget.command --update --no-open > .update.log 2>&1; echo $? > .update-exit";

export interface LauncherStatus {
  version: string;
  latest: string | null;
  behind: number;
  blocker: string;
}

export interface UpdaterDeps {
  dir: string;
  runStatus: () => Promise<string>;
  startUpdate: () => void;
  now: () => number;
}

export type StartResult = { ok: true } | { error: string };

/** The last line of `--update-status`'s output; throws when it isn't the JSON. */
export function parseLauncherStatus(out: string): LauncherStatus {
  const last = out.trim().split("\n").pop() ?? "";
  const v = JSON.parse(last);
  if (typeof v?.version !== "string" || typeof v?.blocker !== "string") {
    throw new Error("Unexpected --update-status output");
  }
  return { version: v.version, latest: v.latest ?? null, behind: Number(v.behind) || 0, blocker: v.blocker };
}

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** What the state files say about the last update started from the app. */
export function readUpdateState(dir: string, now: number): { updating: boolean; failed: string | null } {
  const started = Number(read(path.join(dir, ".update-started"))?.trim());
  if (!started) return { updating: false, failed: null };
  const exitFile = path.join(dir, ".update-exit");
  let exitedAt = 0;
  try {
    exitedAt = fs.statSync(exitFile).mtimeMs;
  } catch {}
  const ended = exitedAt >= started;
  if (!ended) return { updating: now - started < UPDATE_TIMEOUT_MS, failed: null };
  const code = Number(read(exitFile)?.trim());
  if (code === 0) return { updating: false, failed: null };
  const lines = (read(path.join(dir, ".update.log")) ?? "").split("\n").filter((l) => l.trim() !== "");
  return { updating: false, failed: lines.slice(-5).join("\n") || "The update stopped." };
}

export function createUpdater(deps: UpdaterDeps) {
  let cached: { status: LauncherStatus; at: number } | null = null;

  async function launcher(check: boolean): Promise<{ status: LauncherStatus; at: number }> {
    if (!check && cached && deps.now() - cached.at < STATUS_TTL_MS) return cached;
    cached = { status: parseLauncherStatus(await deps.runStatus()), at: deps.now() };
    return cached;
  }

  async function status(check = false): Promise<UpdateStatusDTO> {
    const { status: s, at } = await launcher(check);
    const state = readUpdateState(deps.dir, deps.now());
    return {
      version: s.version,
      latest: s.latest,
      available: s.blocker === "" && s.behind > 0,
      canUpdate: s.blocker === "",
      updating: state.updating,
      failed: state.updating ? null : state.failed,
      checkedAt: new Date(at).toISOString(),
    };
  }

  async function start(): Promise<StartResult> {
    const s = await status();
    if (!s.canUpdate) return { error: "This copy is updated from its repository, not from here." };
    if (s.updating) return { error: "An update is already running." };
    if (!s.available) return { error: "Budget is already up to date." };
    fs.writeFileSync(path.join(deps.dir, ".update-started"), `${deps.now()}\n`);
    fs.rmSync(path.join(deps.dir, ".update-exit"), { force: true });
    deps.startUpdate();
    cached = null;
    return { ok: true };
  }

  return { status, start };
}
```

Note the "start" test: after `start()` clears `cached`, the next `status()` re-runs the launcher — fine with the fake. The second `start()` sees `updating: true` and refuses.

`src/app/api/update/route.ts`:

```ts
import { execFile, spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { withServerTiming } from "@/lib/server-timing";
import { createUpdater, UPDATE_COMMAND } from "@/lib/updater";

// The server runs from the Budget folder (Budget.command starts it there).
const dir = process.cwd();

const updater = createUpdater({
  dir,
  runStatus: () =>
    new Promise((resolve, reject) =>
      execFile("./Budget.command", ["--update-status"], { cwd: dir, timeout: 30_000 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout)
      )
    ),
  // detached: its own process group, so stopping the server (or launchd
  // ending the start-at-login job) doesn't take the update down with it.
  startUpdate: () => {
    const child = spawn("/bin/bash", ["-c", UPDATE_COMMAND], { cwd: dir, detached: true, stdio: "ignore" });
    child.unref();
  },
  now: () => Date.now(),
});

async function handleGET(req: NextRequest) {
  try {
    const check = new URL(req.url).searchParams.get("check") === "1";
    return NextResponse.json(await updater.status(check));
  } catch (err) {
    console.error("update status failed", err);
    return NextResponse.json({ error: "Couldn't check for updates." }, { status: 500 });
  }
}

export const GET = withServerTiming(handleGET);

export async function POST() {
  try {
    const result = await updater.start();
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    console.error("update start failed", err);
    return NextResponse.json({ error: "Couldn't start the update." }, { status: 500 });
  }
}
```

Add `.update-started`, `.update-exit`, `.update.log` to `.gitignore`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `node --import ./scripts/resolve-alias.mjs --test scripts/test-updater.mjs && npx tsc --noEmit -p . && npx eslint src/lib src/app/api/update`
Expected: all pass. Then a GET against the live server is allowed only after the Mac is rebuilt from this branch — don't do it in this task.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = self-update && git add src/lib/updater.ts src/lib/update-poll.ts src/app/api/update/route.ts src/types/index.ts scripts/test-updater.mjs package.json .gitignore && git commit -m "Budget: /api/update reports versions and starts an update

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web Settings → Updates

**Files:**
- Create: `src/components/SettingsUpdates.tsx`, `src/app/settings/updates/page.tsx`
- Modify: `src/components/SideNav.tsx` (add `{ href: "/settings/updates", label: "Updates" }` after Mode)

**Interfaces:**
- Consumes: `GET/POST /api/update`, `UpdateStatusDTO`, `pollOutcome` (Task 4).

- [ ] **Step 1: Implement the page** (`src/app/settings/updates/page.tsx`, same shape as `settings/mode/page.tsx`):

```tsx
import { SettingsUpdates } from "@/components/SettingsUpdates";

export const metadata = {
  title: "Updates · Settings · Budget Claude",
};

export default function SettingsUpdatesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsUpdates />
    </main>
  );
}
```

- [ ] **Step 2: Implement the component** `src/components/SettingsUpdates.tsx`. Match `SettingsMode.tsx`'s header and button styles. Behaviour exactly as the spec's "Web: Settings → Updates":

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollOutcome } from "@/lib/update-poll";
import type { UpdateStatusDTO } from "@/types";

const POLL_MS = 3000;
const GIVE_UP_MS = 10 * 60 * 1000;

async function fetchStatus(check = false): Promise<UpdateStatusDTO | null> {
  try {
    const res = await fetch(`/api/update${check ? "?check=1" : ""}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as UpdateStatusDTO) : null;
  } catch {
    return null; // expected while the server is stopped for the update
  }
}

type Phase = "idle" | "checking" | "updating" | "stillNotBack";

export function SettingsUpdates() {
  const [status, setStatus] = useState<UpdateStatusDTO | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchStatus().then((s) => (s ? setStatus(s) : setLoadFailed(true)));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const checkNow = useCallback(async () => {
    setPhase("checking");
    const s = await fetchStatus(true);
    if (s) setStatus(s);
    setPhase("idle");
  }, []);

  const install = useCallback(async () => {
    if (!status) return;
    if (!window.confirm("Budget will stop for about a minute while it updates.")) return;
    setError(null);
    const res = await fetch("/api/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Couldn't start the update.");
      return;
    }
    setPhase("updating");
    const startVersion = status.version;
    const startedAt = Date.now();
    const poll = async () => {
      const s = await fetchStatus();
      const outcome = pollOutcome(startVersion, s);
      if (outcome === "done") return window.location.reload();
      if (outcome === "failed" && s) {
        setStatus(s);
        setPhase("idle");
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) return setPhase("stillNotBack");
      timer.current = setTimeout(poll, POLL_MS);
    };
    timer.current = setTimeout(poll, POLL_MS);
  }, [status]);

  // Render:
  // header "Updates" (same classes as SettingsMode's header), then:
  // - loadFailed && !status: "Couldn't check for updates."
  // - !status: "Checking…"
  // - phase updating: "Updating… Budget will be back in about a minute."
  // - phase stillNotBack: "Still not back. Check the Mac."
  // - !status.canUpdate: "Budget v{version}." + "This copy is updated from its repository, not from here."
  // - status.failed: "The last update didn't finish:" + <pre> of failed + "Run ./Budget.command --update in Terminal to see why."
  //   (and, if still available, the Install button below it)
  // - available: "v{latest} is available (you have v{version})." + Install button
  // - else: "Budget v{version} is up to date." + "Check Now" button (disabled while checking)
  // - error (from a refused POST): shown under the button.
}
```

Write the JSX for that render list using the same Tailwind classes as `SettingsMode.tsx` (`text-sm text-black/55 dark:text-white/55` for secondary text; the bordered button style for actions). Every branch above must be reachable.

- [ ] **Step 3: SideNav** — add `{ href: "/settings/updates", label: "Updates" }` after `{ href: "/settings/mode", label: "Mode" }`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p . && npx eslint src/components/SettingsUpdates.tsx src/app/settings/updates && npm test 2>&1 | tail -3`
Expected: clean. Do not load the page against the live server in this task (the running server is the old build).

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = self-update && git add src/components/SettingsUpdates.tsx src/app/settings/updates/page.tsx src/components/SideNav.tsx && git commit -m "Budget: Settings → Updates with an Install button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: iPhone — Mac row, Install, Installed / Stops Opening

**Files:**
- Create: `ios/BudgetPhone/Models/UpdateModels.swift`, `ios/BudgetPhone/Support/Provisioning.swift`, `ios/BudgetPhone/Support/AppVersion.swift`, `ios/BudgetPhone/Settings/UpdateStore.swift`, `ios/BudgetPhoneTests/UpdateTests.swift`
- Modify: `ios/BudgetPhone/Networking/APIClient+Settings.swift`, `ios/BudgetPhone/Settings/SettingsView.swift`

**Interfaces:**
- Consumes: `GET /api/update[?check=1]`, `POST /api/update` with body `{}` (Task 4); `pollOutcome` (ported).
- Produces: `UpdateStatus` (Codable mirror of `UpdateStatusDTO`), `APIClient.updateStatus(check:)`, `APIClient.startUpdate()`, `AppVersion.isNewer(_:than:)`, `Provisioning.parse(_:)`, `Provisioning.current()`, `UpdateStore`.

- [ ] **Step 1: Write the failing tests** `ios/BudgetPhoneTests/UpdateTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

struct UpdateModelTests {
  @Test func decodesTheStatus() throws {
    let json = #"{"version":"1.0.0","latest":"1.1.0","available":true,"canUpdate":true,"updating":false,"failed":null,"checkedAt":"2026-01-01T00:00:00.000Z"}"#
    let s = try JSONDecoder().decode(UpdateStatus.self, from: Data(json.utf8))
    #expect(s == UpdateStatus(version: "1.0.0", latest: "1.1.0", available: true, canUpdate: true, updating: false, failed: nil, checkedAt: "2026-01-01T00:00:00.000Z"))
  }

  @Test func comparesVersionsByNumber() {
    #expect(AppVersion.isNewer("0.12.0", than: "0.11.0"))
    #expect(AppVersion.isNewer("0.10.0", than: "0.9.1"))
    #expect(!AppVersion.isNewer("0.11.0", than: "0.11.0"))
    #expect(!AppVersion.isNewer("0.9.0", than: "0.11.0"))
    #expect(AppVersion.isNewer("1.0", than: "0.99.9"))
  }

  @Test func pollOutcomeMatchesTheWeb() {
    let base = UpdateStatus(version: "1.0.0", latest: "1.1.0", available: true, canUpdate: true, updating: false, failed: nil, checkedAt: "")
    #expect(UpdatePoll.outcome(startVersion: "1.0.0", nil) == .waiting)
    var s = base; s.updating = true
    #expect(UpdatePoll.outcome(startVersion: "1.0.0", s) == .waiting)
    s = base; s.version = "1.1.0"; s.updating = true
    #expect(UpdatePoll.outcome(startVersion: "1.0.0", s) == .waiting)
    s = base; s.version = "1.1.0"
    #expect(UpdatePoll.outcome(startVersion: "1.0.0", s) == .done)
    s = base; s.failed = "boom"
    #expect(UpdatePoll.outcome(startVersion: "1.0.0", s) == .failed("boom"))
  }

  @Test func readsTheDatesInsideASignedProfile() throws {
    // A profile is a signed blob with the plist inside; invented dates.
    let plist = """
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0"><dict>
      <key>CreationDate</key><date>2026-01-04T10:00:00Z</date>
      <key>ExpirationDate</key><date>2026-01-11T10:00:00Z</date>
      <key>Name</key><string>Sample Profile</string>
      </dict></plist>
      """
    var blob = Data([0x30, 0x82, 0x01, 0x00, 0xFF, 0x00])
    blob.append(Data(plist.utf8))
    blob.append(Data([0x00, 0xA0, 0x82]))
    let p = try #require(Provisioning.parse(blob))
    #expect(p.created == ISO8601DateFormatter().date(from: "2026-01-04T10:00:00Z"))
    #expect(p.expires == ISO8601DateFormatter().date(from: "2026-01-11T10:00:00Z"))
    #expect(Provisioning.parse(Data("no plist here".utf8)) == nil)
  }
}

extension StubbedNetworkTests {
  @Suite(.serialized)
  @MainActor
  struct UpdateStoreTests {
    let base = URL(string: "http://budget-mac.local:3000")!

    func status(_ version: String, updating: Bool = false, failed: String? = nil) -> (Int, Data) {
      let failedJSON = failed.map { "\"\($0)\"" } ?? "null"
      return (200, Data(#"{"version":"\#(version)","latest":"1.1.0","available":true,"canUpdate":true,"updating":\#(updating),"failed":\#(failedJSON),"checkedAt":""}"#.utf8))
    }

    @Test func loadAsksWithoutForcingACheck() async {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { _ in status("1.0.0") })
      let store = UpdateStore { c }
      await store.load()
      #expect(store.status?.version == "1.0.0")
      #expect(StubURLProtocol.requests.first?.url?.query == nil)
    }

    @Test func aFailedLoadHidesTheRow() async {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { _ in throw URLError(.timedOut) })
      let store = UpdateStore { c }
      await store.load()
      #expect(store.status == nil)
    }

    @Test func installPostsAnEmptyBodyThenPollsUntilTheNewVersion() async throws {
      var gets = 0
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (202, Data(#"{"ok":true}"#.utf8)) }
        gets += 1
        switch gets {
        case 1: return status("1.0.0")                   // load
        case 2: return status("1.0.0", updating: true)   // first poll
        case 3: throw URLError(.cannotConnectToHost)     // server stopped
        default: return status("1.1.0")
        }
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      await store.load()
      await store.install()
      #expect(store.phase == .updated(to: "1.1.0"))
      #expect(store.status?.version == "1.1.0")
      let post = try #require(StubURLProtocol.requests.first { $0.httpMethod == "POST" })
      #expect(post.url?.path == "/api/update")
      #expect(StubURLProtocol.body(of: post) == Data("{}".utf8))
    }

    @Test func aRefusedInstallSaysWhy() async {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        r.httpMethod == "POST" ? (409, Data(#"{"error":"Budget is already up to date."}"#.utf8)) : status("1.0.0")
      })
      let store = UpdateStore { c }
      await store.load()
      await store.install()
      #expect(store.phase == .failed("Budget is already up to date."))
    }

    @Test func aFailedUpdateShowsTheLog() async {
      var gets = 0
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        if r.httpMethod == "POST" { return (202, Data(#"{"ok":true}"#.utf8)) }
        gets += 1
        return gets == 1 ? status("1.0.0") : status("1.0.0", failed: "Build failed")
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      await store.load()
      await store.install()
      #expect(store.phase == .failed("Build failed"))
    }

    @Test func givesUpAfterTheLimit() async {
      let c = APIClient(baseURL: base, session: StubURLProtocol.session { r in
        r.httpMethod == "POST" ? (202, Data(#"{"ok":true}"#.utf8)) : status("1.0.0", updating: true)
      })
      let store = UpdateStore { c }
      store.pollInterval = .milliseconds(10)
      store.pollLimit = .milliseconds(60)
      await store.load()
      await store.install()
      #expect(store.phase == .stillNotBack)
    }
  }
}
```

- [ ] **Step 2: Run to verify they fail**

Run (from `ios/`): the iOS test command.
Expected: build errors — types don't exist yet.

- [ ] **Step 3: Implement.**

`ios/BudgetPhone/Models/UpdateModels.swift`:

```swift
import Foundation

/// GET /api/update — `UpdateStatusDTO` in ../src/types/index.ts.
struct UpdateStatus: Codable, Equatable, Sendable {
  var version: String
  var latest: String?
  var available: Bool
  var canUpdate: Bool
  var updating: Bool
  var failed: String?
  var checkedAt: String
}

/// Where an Install stands after one poll — `pollOutcome` in ../src/lib/update-poll.ts.
enum UpdatePoll: Equatable {
  case waiting, done, failed(String)

  static func outcome(startVersion: String, _ s: UpdateStatus?) -> UpdatePoll {
    guard let s else { return .waiting }
    if let failed = s.failed { return .failed(failed) }
    if !s.updating && s.version != startVersion { return .done }
    return .waiting
  }
}
```

`ios/BudgetPhone/Support/AppVersion.swift`:

```swift
import Foundation

enum AppVersion {
  /// This app's version (MARKETING_VERSION, which equals the web release's).
  static var current: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
  }

  /// "0.12.0" is newer than "0.11.0", part by part as numbers; a missing part is 0.
  static func isNewer(_ a: String, than b: String) -> Bool {
    let x = a.split(separator: ".").map { Int($0) ?? 0 }
    let y = b.split(separator: ".").map { Int($0) ?? 0 }
    for i in 0..<max(x.count, y.count) {
      let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
      if l != r { return l > r }
    }
    return false
  }
}
```

`ios/BudgetPhone/Support/Provisioning.swift`:

```swift
import Foundation

/// When this install was signed and when the signature runs out, from the
/// app's own embedded.mobileprovision: a signed blob with a plist inside.
/// A free Apple ID signs for 7 days. Absent in the simulator.
struct Provisioning: Equatable {
  let created: Date
  let expires: Date

  static func current() -> Provisioning? {
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url)
    else { return nil }
    return parse(data)
  }

  static func parse(_ data: Data) -> Provisioning? {
    guard let start = data.range(of: Data("<?xml".utf8)),
      let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
      let plist = try? PropertyListSerialization.propertyList(
        from: data[start.lowerBound..<end.upperBound], format: nil) as? [String: Any],
      let created = plist["CreationDate"] as? Date,
      let expires = plist["ExpirationDate"] as? Date
    else { return nil }
    return Provisioning(created: created, expires: expires)
  }
}
```

Add to `APIClient+Settings.swift`:

```swift
  /// GET /api/update — this Mac's version and the published one. `check`
  /// asks the server to look again instead of using its hourly answer.
  func updateStatus(check: Bool = false) async throws(APIError) -> UpdateStatus {
    try await get(
      "api/update", query: check ? [URLQueryItem(name: "check", value: "1")] : [], timeout: 40)
  }

  /// POST /api/update — `{}`; the Mac updates itself and restarts Budget.
  func startUpdate() async throws(APIError) {
    _ = try await send("POST", "api/update", body: Data("{}".utf8), timeout: 15)
  }
```

`ios/BudgetPhone/Settings/UpdateStore.swift`:

```swift
import Foundation
import Observation

/// Settings → About's Mac row: the Mac's version, and Install, which starts
/// the update and waits for Budget to come back (SettingsUpdates.tsx on the web).
@MainActor
@Observable
final class UpdateStore {
  enum Phase: Equatable {
    case idle
    case updating
    case updated(to: String)
    case failed(String)
    case stillNotBack
  }

  private(set) var status: UpdateStatus?
  private(set) var phase: Phase = .idle
  var pollInterval: Duration = .seconds(3)
  var pollLimit: Duration = .seconds(600)

  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  /// A failure hides the row: Settings' server form covers connection trouble.
  func load() async {
    guard let client = client() else { return }
    do throws(APIError) {
      status = try await client.updateStatus()
    } catch {
      if error != .cancelled { status = nil }
    }
  }

  func install() async {
    guard let client = client(), let start = status?.version, phase != .updating else { return }
    do throws(APIError) {
      try await client.startUpdate()
    } catch {
      if error != .cancelled { phase = .failed(error.message) }
      return
    }
    phase = .updating
    let clock = ContinuousClock()
    let deadline = clock.now + pollLimit
    while clock.now < deadline {
      do { try await Task.sleep(for: pollInterval) } catch { return }
      let s: UpdateStatus?
      do throws(APIError) { s = try await client.updateStatus() } catch { s = nil }
      switch UpdatePoll.outcome(startVersion: start, s) {
      case .waiting: continue
      case .done:
        status = s
        phase = .updated(to: s?.version ?? "")
        return
      case .failed(let log):
        status = s
        phase = .failed(log)
        return
      }
    }
    phase = .stillNotBack
  }
}
```

`SettingsView.swift`: add `@State private var update = UpdateStore(client: RootView.client)`, `@State private var provisioning = Provisioning.current()`, `@State private var confirmingInstall = false`; replace the private `version` property's body with `AppVersion.current`; replace the About section with:

```swift
        Section {
          LabeledContent("Version", value: version)
          if let s = update.status { macRow(s) }
          if let p = provisioning {
            LabeledContent("Installed", value: p.created.formatted(.dateTime.month(.abbreviated).day()))
            LabeledContent("Stops Opening", value: p.expires.formatted(.dateTime.month(.abbreviated).day()))
          }
        } header: {
          Text("About")
        } footer: {
          if let s = update.status, AppVersion.isNewer(s.version, than: version) {
            Text("Your Mac has v\(s.version). This app updates the next time it's reinstalled from the Mac.")
          }
        }
```

and `.task { await update.load() }` on the `Form`, plus:

```swift
  @ViewBuilder private func macRow(_ s: UpdateStatus) -> some View {
    switch update.phase {
    case .updating:
      LabeledContent("Mac") {
        HStack(spacing: 6) { ProgressView(); Text("Updating…") }
      }
    case .updated(let v):
      LabeledContent("Mac", value: "Updated to v\(v)")
    case .stillNotBack:
      LabeledContent("Mac", value: "Not back yet")
      Text("Check that the Mac is awake and Budget is running.").font(.footnote).foregroundStyle(.secondary)
    case .failed(let message):
      LabeledContent("Mac", value: "Update didn't finish")
      Text(message).font(.footnote).foregroundStyle(.secondary)
    case .idle:
      if s.available, s.canUpdate, let latest = s.latest {
        LabeledContent("Mac", value: "v\(latest) available")
        Button("Install Update") { confirmingInstall = true }
          .confirmationDialog(
            "Budget will stop for about a minute while it updates.",
            isPresented: $confirmingInstall, titleVisibility: .visible
          ) {
            Button("Install Update") { Task { await update.install() } }
          }
      } else {
        LabeledContent("Mac", value: "v\(s.version)")
      }
    }
  }
```

`LabeledContent` values wrap like other Settings rows; at accessibility sizes system `LabeledContent` already stacks — leave it.

- [ ] **Step 4: Run the tests**

Run (from `ios/`): the iOS test command, then `bash ../scripts/test-scrub.sh | tail -1`.
Expected: all pass, `0 failed`.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = self-update && git add ios/BudgetPhone ios/BudgetPhoneTests && git commit -m "iPhone: Mac version and Install, install and expiry dates in About

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Installer question, README, changelog

**Files:**
- Modify: `scripts/install.sh` (`launch`), `scripts/test-install.sh`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `./Budget.command --login on` (Task 1).

- [ ] **Step 1: Write the failing tests** — in `scripts/test-install.sh`, after the "installer: arrives through curl | bash" section:

```bash
echo "installer: start at login"
mac=$(make_mac); touch "$mac/state/clt"; echo v24.0.0 > "$mac/state/node-version"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET" "")")
assert_has "$out" "Start Budget automatically when you log in?" "asks about starting at login"
assert_has "$out" "Would run: ./Budget.command --login on" "Return means yes"
mac=$(make_mac); touch "$mac/state/clt"; echo v24.0.0 > "$mac/state/node-version"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET" "n")")
assert_lacks "$out" "--login on" "n means no"
mac=$(make_mac); touch "$mac/state/clt"; echo v24.0.0 > "$mac/state/node-version"
mkdir -p "$mac/home/Library/LaunchAgents"; touch "$mac/home/Library/LaunchAgents/local.budget.server.plist"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
assert_lacks "$out" "when you log in?" "not asked when it's already on"
```

The existing fresh-install test feeds only two answers, so the question meets end of input: that must mean no (`assert_lacks "$out" "--login on"` there — add it).

- [ ] **Step 2: Run to verify they fail**

Run: `bash scripts/test-install.sh 2>&1 | grep -B1 -A1 FAIL`
Expected: the new assertions fail.

- [ ] **Step 3: Implement** in `scripts/install.sh`:

```bash
# Asked before the first start, while the person is still at the keyboard.
# Return means yes; no answer at all (end of input) means no. Not asked when
# the agent is already there.
ask_login() {
  [ -f "$HOME/Library/LaunchAgents/local.budget.server.plist" ] && return 1
  echo
  printf 'Start Budget automatically when you log in? It keeps running so your iPhone can reach it. [Y/n] '
  local a=""
  if ! read -r -u 3 a; then
    echo
    return 1
  fi
  case "$a" in ''|[Yy]*) return 0 ;; *) return 1 ;; esac
}
```

In `launch()`, first line: `local login=false; ask_login && login=true`. In the `BUDGET_INSTALL_SKIP_LAUNCH` branch, after `echo "Would run: ./Budget.command$args"` add `$login && echo "Would run: ./Budget.command --login on"`. In the real branch, run Budget as now, then (only if it exited 0) `$login && ./Budget.command --login on`:

```bash
  local rc
  if $EXISTING; then
    ./Budget.command --update <&3
  else
    ./Budget.command <&3
  fi
  rc=$?
  [ "$rc" -eq 0 ] && $login && ./Budget.command --login on
  return "$rc"
```

`README.md`: in the section that explains updating (search for `--update`), add one sentence: "You can also update from Budget itself: Settings → Updates on the web, or Settings → About on the iPhone, shows **Install** when a new version is out." Add a short section after the updating one:

```markdown
### Start Budget when you log in

The installer offers this. To turn it on or off yourself, paste one of these into Terminal from the Budget folder:

    ./Budget.command --login on
    ./Budget.command --login off

While it's on, Budget starts when you log in, starts again if it stops, and keeps the Mac from going to sleep on its own so your iPhone can reach it (the screen still turns off).
```

`CHANGELOG.md`, under the existing `## Unreleased`:

```markdown
- Updates from the app: Settings → Updates on the web and Settings → About on
  the iPhone show when a new version is out, with an Install button. Budget
  stops for about a minute and comes back on the new version.
- Budget can start when you log in: `./Budget.command --login on` (or `off`).
  The installer asks.
- iPhone app: Settings → About shows your Mac's version, says when the Mac is
  newer than the app, and shows when this install stops opening.
- The launcher numbers its steps and runs one launch or update at a time.
```

- [ ] **Step 4: Run everything**

Run: `npm test 2>&1 | tail -5` and the iOS test command.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = self-update && git add scripts/install.sh scripts/test-install.sh README.md CHANGELOG.md && git commit -m "Installer asks to start Budget at login; docs and changelog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
