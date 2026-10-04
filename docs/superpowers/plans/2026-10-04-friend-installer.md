# One-paste installer for friends — plan

Spec: `docs/superpowers/specs/2026-10-04-friend-installer-design.md` (read it first).
Branch `friend-installer`, in its own worktree.

## Global Constraints

- **Never install anything on the Mac running the tests.** No real
  `xcode-select --install`, `sudo`, `installer`, Node.js download, or
  network clone. Tests stub every such command on `PATH` and clone from a
  local bare repo.
- **Never touch the live Budget** (port 3000, `prisma/dev.db`, `.env.local`
  of the real checkout). Tests use a fake `HOME` under a temp dir.
- Plain bash 3.2 (macOS `/bin/bash`): no `mapfile`, no `${var,,}`, no
  associative arrays.
- Messages are for non-technical people: short, plain, say what to click or
  paste. Use ✅ / ❌ sparingly in output only if it reads well in Terminal.
- Public repo: invented values only; never print or log the Plaid secret.
- Run `npm test` from budget-claude before committing (node_modules is
  installed in the worktree). Run `bash scripts/test-scrub.sh` too.
  Commit messages end with exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Match `Budget.command` / `scripts/test-launcher.sh` style (comments that
  explain why).

## Task 1: scripts/install.sh and its test

### `scripts/install.sh`

- `#!/bin/bash`, everything inside `main()`, last line `main "$@"; exit $?`
  (a cut-off `curl | bash` download then runs nothing). Doesn't rely on
  `$0` or its own location.
- Settings, each overridable by environment (tests set them; real users
  never need to):
  - `BUDGET_DIR` (default `$HOME/Documents/budget`)
  - `BUDGET_REPO` (default `https://github.com/tw-yoon/budget.git`)
  - `BUDGET_TTY` (default `/dev/tty`): where answers are read from, so
    questions work under `curl | bash`. If it can't be opened, stop with a
    message saying to paste the line into Terminal.
  - `BUDGET_NODE_MAJOR` (default `24`), `BUDGET_NODE_DIST`
    (default `https://nodejs.org/dist/latest-v24.x`), `BUDGET_NODE_BIN`
    (default `/usr/local/bin`, prepended to `PATH` after installing).
  - `BUDGET_CLT_WAIT_SECS` (default `1800`), `BUDGET_POLL_SECS` (default `5`).
  - `BUDGET_INSTALL_SKIP_LAUNCH=1`: print `Would run: ./Budget.command …`
    instead of running it (tests only).
- Steps, in order (spec "Steps the script takes"):
  1. `uname -s` must be `Darwin`, else a plain message and exit 1.
  2. Command Line Tools: `xcode-select -p >/dev/null 2>&1` → ok. Else run
     `xcode-select --install`, say "A window will ask to install the
     command line developer tools. Click Install (not Get Xcode), then
     Agree. This can take 5 to 15 minutes; this window waits for it.", then
     poll `xcode-select -p` every `BUDGET_POLL_SECS` up to
     `BUDGET_CLT_WAIT_SECS`. On timeout: say to finish that install and
     paste the line again; exit 1. Then require `git` to work.
  3. Node.js: ok if `node --version` gives major ≥ 20. Else:
     fetch `$BUDGET_NODE_DIST/SHASUMS256.txt` with `curl -fsSL`, pick the
     line ending in `.pkg` (`node-v24.x.y.pkg`), download that file with
     `curl -fsSL -o` into a `mktemp -d` dir, verify with
     `shasum -a 256`, then explain the password prompt ("Your Mac will ask
     for its password to install Node.js. Nothing shows while you type;
     that's normal.") and run `sudo installer -pkg <file> -target /`.
     Prepend `BUDGET_NODE_BIN` to `PATH`; check `node --version` again.
     Any failure (download, checksum, installer, still too old): say
     exactly "Download the LTS installer from https://nodejs.org, open it,
     click through it, then paste this line again." and exit 1. Delete the
     temp dir on exit.
  4. Clone: if `BUDGET_DIR` doesn't exist → `git clone "$BUDGET_REPO"
     "$BUDGET_DIR"` (create `Documents` if missing). If it exists and is a
     git work tree containing `Budget.command` → keep it, remember
     "existing". Otherwise stop: "There's already a folder at <dir> that
     isn't Budget. Rename or move it, then paste this line again." Exit 1,
     touching nothing.
  5. Plaid keys: if `$BUDGET_DIR/.env.local` is missing, run
     `./Budget.command --check-only` in `BUDGET_DIR` (it creates `.env`,
     `.env.local` and the encryption key, then exits 2 — expected; any other
     non-zero exit or a still-missing `.env.local` is an error), silencing
     its "paste them into .env.local" text. Then if `PLAID_CLIENT_ID=` and
     `PLAID_SECRET=` both have values, say they're kept. Otherwise explain
     where to find them (dashboard.plaid.com → Developers → Keys; the
     Sandbox secret, not Production), and ask for each (secret read with
     `read -s`, nothing echoed). Accept only letters and digits; up to 3
     tries each, then exit 1 with a message. Write both with a temp file in
     the same folder + `mv` (like `bootstrap_env`), replacing the
     `PLAID_CLIENT_ID=` / `PLAID_SECRET=` lines (append if absent),
     changing no other line. Never print the secret.
  6. Launch: `./Budget.command` (or `./Budget.command --update` for an
     existing clone), from `BUDGET_DIR`, as the last step; say first that the
     first start takes 3 to 5 minutes and the browser opens on its own, and
     that the next step is README Step 7 (add a pretend bank). With
     `BUDGET_INSTALL_SKIP_LAUNCH=1`, print `Would run: ./Budget.command`
     (with ` --update` when existing) and exit 0.

### `scripts/test-install.sh`

Self-contained bash test in the style of `scripts/test-launcher.sh`
(`pass`/`fail`/`assert_has` helpers, one `SUITE_TMP` removed on exit, a
`PASS/FAIL` summary line, non-zero exit on any failure). Fixture: a bare
origin seeded from `git ls-files` of this checkout (copy `make_fixture`'s
seeding), a fake `HOME`, and a stub bin dir first on `PATH` with:

- `xcode-select`: `-p` succeeds iff a marker file exists; `--install`
  records the call and (configurable) creates the marker.
- `node`: prints a version from a file (missing file → exit 127 as "not
  installed").
- `curl`: serves `SHASUMS256.txt` and a fake `node-v24.0.0.pkg` from a
  fixture dir (or fails, configurable); records URLs.
- `sudo`: runs its arguments. `installer`: records args and writes the
  version file to v24 (simulating an install).
- `uname`: prints `Darwin` (or `Linux` for that test).
- `open`: no-op.

Answers are fed through `BUDGET_TTY` pointing at a file.
`BUDGET_INSTALL_SKIP_LAUNCH=1` always.

Cases:
1. Fresh Mac: no tools, no node → `xcode-select --install` called, waits
   until marker appears (stub creates it), node installed via stub
   `installer` with a verified checksum, clone made, `.env.local` created
   with an encryption key, keys written exactly (`PLAID_CLIENT_ID=<id>`,
   `PLAID_SECRET=<secret>`), the secret not in the output, `Would run:
   ./Budget.command`.
2. Run again on the result: no `--install`, no `installer`, no new
   questions asked (empty tty file is fine), keys unchanged, `.env.local`
   otherwise byte-identical, `Would run: ./Budget.command --update`.
3. Node too old (v18) → installs; Node 20 present → no download.
4. Checksum mismatch → no `installer` call, message names nodejs.org,
   exit non-zero.
5. Tools never appear (wait 0–1 s) → message, exit non-zero, no clone.
6. Existing non-Budget folder at `BUDGET_DIR` → exit non-zero, folder
   untouched.
7. Invalid key input (with a space) three times → exit non-zero, keys still
   empty.
8. Not macOS → exit non-zero with a message.
9. `BUDGET_TTY` unreadable → message to paste the line in Terminal.
10. Script ends with `main "$@"; exit $?` and defines everything in
    functions (grep the file).

Add `bash scripts/test-install.sh` to the `test` script in `package.json`
right after `bash scripts/test-launcher.sh`.

Commit: "Add a one-paste installer for friends".

## Task 2: README and changelog

- `README.md`: add a section **before** "Step 1: Install Node.js" (after
  the `---` that follows "How to use Terminal"): `## Quick install (one
  paste)`. Same plain style as the rest (where to click, what to paste,
  ✅ "You should see", ❌ "If you see"). Content:
  - First get the Plaid keys (link to Step 3, which stays where it is);
    the installer asks for them.
  - The one grey box: `curl -fsSL https://raw.githubusercontent.com/tw-yoon/budget/main/scripts/install.sh | bash`
  - What happens: may ask to install the command line developer tools
    (click Install, wait), may ask for the Mac password for Node.js
    (nothing shows while typing), asks for client_id and Sandbox secret,
    then starts Budget (3 to 5 minutes the first time).
  - ✅ You should see `Budget v… is ready at http://localhost:3000` and the
    browser opens. Then go to Step 7.
  - ❌ lines for: the developer tools wait timing out; a Node.js download
    message (do Step 1 by hand, then paste again); "already a folder at …
    that isn't Budget"; a wrong Plaid key later (Step 7's existing ❌ covers
    it; point there); safe to paste again any time.
  - "Prefer to do it by hand? Steps 1 to 6 below do the same thing."
- Update the Contents list (add the new section before Step 1; renumber).
- Leave Steps 1–6 as they are, apart from one line at the top of Step 1:
  "Used the quick install? Skip to Step 7."
- `CHANGELOG.md`: under `## Unreleased`, add a plain line, e.g. "New
  one-paste installer for friends: it installs what Budget needs, downloads
  it, asks for the Plaid keys and starts it. The README offers it first;
  the step-by-step guide is still there."

Run `npm test` and `bash scripts/test-scrub.sh`.

Commit: "README: offer the one-paste installer first".
