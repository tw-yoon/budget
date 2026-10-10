# One-command release — design

## Goal

Replace the hand-run release procedure in
`2026-09-10-public-distribution-design.md` (find `LAST`, `format-patch`,
`git am`, rebuild hand-resolved merges, scrub every commit) with one script,
`scripts/release.sh`, that a maintainer can run without knowing git.

## Decision: one public commit per release

**Supersedes the commit-by-commit replay.** Each release becomes a single
public commit, `Release X.Y.Z`, whose tree is exactly the private
`budget-claude/` tree at the release commit and whose parent is the current
public tip. Reasons:

- The replay broke on every hand-resolved merge and needed manual
  reconstruction each time.
- Scrubbing one commit (its diff and its message) replaces scrubbing every
  private commit and every merge message.
- Friends update with `git pull --ff-only`; a commit on top of the public tip
  is still a fast-forward, so nothing changes for them.

The public history now reads one commit per release. The full history stays in
the private monorepo.

## Commands

All run from anywhere inside the private monorepo. Each refuses with a plain
message when `git rev-parse --show-prefix` of the script's folder is not
`budget-claude/scripts/` (for example in a friend's public clone).

### `release.sh prepare <minor|patch|X.Y.Z>`

Run by an agent or by a front end. Never pushes.

1. **Preconditions.** The monorepo checkout is on `main` with no tracked
   changes. `## Unreleased` in `CHANGELOG.md` has at least one entry.
2. **Version.** Read the public version (see *Public clone*). If a prepared
   release's public commit is already the public tip (an earlier `publish`
   pushed it but stopped before the end), keep the state, print `Ready`, and
   stop here so `publish` can finish it. If `package.json` already names a
   version newer than the public one, a bump is pending from an earlier
   `prepare`: reuse it and skip step 3. If, in that case, `## Unreleased` also
   has entries, fold them in: move them to the top of the pending
   `## X.Y.Z — date` section (Unreleased left empty), commit that on `main`
   as `Release X.Y.Z: add later changes`, and print
   `Added N later changes to X.Y.Z.` Otherwise compute the new version from
   the argument (`minor`: middle number up, last to 0; `patch`: last number
   up; an exact `X.Y.Z` must be greater than the public one).
3. **Bump.** On a branch `release-X.Y.Z`: rename `## Unreleased` to
   `## X.Y.Z — YYYY-MM-DD` and add a fresh empty `## Unreleased` above it, set
   `version` in `package.json`, set `MARKETING_VERSION` in
   `ios/Config/Shared.xcconfig`. Check that all three files now name
   `X.Y.Z`; if one doesn't, undo everything (back on `main`, branch deleted,
   nothing merged) and stop: "Couldn't update the version in <file>. Nothing
   was changed." Commit `Release X.Y.Z`, then `git merge --no-ff` into `main`
   as `Merge release-X.Y.Z`, delete the branch.
4. **Tests.** `npm test`, then the iPhone tests (the `xcodebuild test` line
   in `ios/CLAUDE.md`). Any failure stops here.
5. **Public commit.** In the public clone, check out the public tip, remove
   every tracked file, extract `git archive <release>:budget-claude` into it,
   `git add -A`, and commit with message `Release X.Y.Z` followed by a blank
   line and that version's changelog entries. Author and committer are the
   public identity (`PUBLIC_NAME` / `PUBLIC_EMAIL` near the top of the
   script). File contents are copied; private objects never enter the clone.
6. **Checks.** Every one must pass or the step stops:
   - `HEAD^{tree}` in the clone equals `git rev-parse <release>:budget-claude`.
   - The new commit's parent is the public tip (fast-forward for friends).
   - The diff's added lines and the commit message contain no home-folder path
     (including `docs/`, which `test-scrub.sh` skips for this check).
   - `test-scrub.sh` passed as part of `npm test` on the same tree.
7. **Record.** Write the state file (version, private release commit, public
   base, public commit) and print `Ready: run scripts/release.sh publish`.

Running `prepare` again before publishing rebuilds the public commit from
scratch on the same version; it never bumps twice.

### `release.sh scan`

Read-only check of the prepared release against the owner's real data, run by
the owner (agents may not read `prisma/dev.db`). Opens the database with
`sqlite3 -readonly` and collects distinctive strings: transaction names,
merchant names and personal notes, Venmo/Zelle counterparties and notes,
account and institution names, account masks, card names and last four
digits, benefit names, notes and match keywords (each string of the JSON
array), category rule patterns, subscription names. A column the database
doesn't have is skipped. Ignores strings shorter than 4 characters and any
that already appear in the public base tree. Searches the release diff's
added lines and the commit message case-insensitively, whole words only (so
last four digits inside a longer number don't match). Prints `file:line` for
each hit **without the matched text**, and exits non-zero on any hit.

Only text lines are searched: file names, images and other binary files are
not scanned (git's diff shows no lines for them).

### `release.sh publish [--yes]`

Run by the owner.

1. Requires the state file. Refuses if `main` no longer contains the release
   commit. If the public tip is already the prepared public commit (an
   earlier run pushed it and stopped before the end), skips to step 5 for the
   private copy only: no scan, no question, no public push. Otherwise refuses
   if the public tip moved since `prepare` (`git ls-remote`) — "Run prepare
   again."
2. Runs `scan`. Any hit stops it; nothing is pushed.
3. Prints the summary — version, files changed, changelog entries — and asks
   to type `yes`. `--yes` skips the question for a front end that asks its own.
4. `git push origin main` in the monorepo, then `git push origin main` in the
   public clone.
5. Verifies with `git ls-remote` that each remote's `main` is the commit just
   pushed; says which one did not arrive if not.
6. Removes the state file and prints `Published X.Y.Z. Friends can update
   now.`

### `release.sh status --json`

For a front end. Read-only; network steps time out after 10 s and report
`null` rather than failing. Prints one JSON object:

- `unreleased`: the entries under `## Unreleased`.
- `history`: `[{version, date, entries}]` from the dated changelog headings.
- `localVersion`: `package.json` version. `publicVersion`: the public
  `package.json` version. `prepared`: the state file's version or `null`.
- `notBackedUp`: commits on `main` not on `origin/main` (after a fetch).
- `macVersion`: the version the running Mac build was made from.
- `phone`: `{version, installedAt, expiresAt, lastFailure}` from
  `ios/build/phone/` (`last-success`, `expires`, and the newest failed run
  in `log` newer than the last success). `phone.sh install` records the
  installed version in `ios/build/phone/version`.

### Work folder and lock

Everything the script keeps lives in `budget-release/` inside the
repository's git folder (`git rev-parse --git-common-dir`), never inside the
app: a copy of the public tree under the app folder would be compiled by
`next build` (tsconfig includes `**/*.ts`) and breaks it once the two differ.
It holds `public/` (the public clone), `state` (the prepared release), `lock`
and the scan's temporary files.

`prepare`, `scan` and `publish` each take the lock (`mkdir lock`, removed on
exit). If it is held: "Another release step is running. Try again in a
minute." A lock older than two hours is left from a killed step and is
broken. `publish` runs the scan under its own lock. `status` takes no lock.

### Public clone

Cloned once. `prepare` refreshes it with `git fetch` + `git reset --hard
origin/main`. `status` only fetches and reads the version with `git show
origin/main:package.json`, so it never disturbs a prepared commit.

## Testing

`scripts/test-release.sh`, added to `npm test`, runs every command against a
throwaway private monorepo and a local bare "public" repo in a temp folder —
never GitHub, never the real database (the scan reads a fixture SQLite file
through a `RELEASE_DB` override). It covers: one commit with the exact tree;
fast-forward parent; `minor`/`patch`/exact versions in all three files;
second `prepare` reuses the version; new Unreleased entries over a pending
bump are folded into it; a version file the bump can't edit stops it cleanly;
refusal on a dirty tree or a branch other than `main`; a planted home-folder
path in a doc blocks `prepare`; planted fixture strings from each scanned
column block `publish` and are not printed; a moved public tip blocks
`publish`; a half-finished publish is finished; the lock; `status` leaves the
clone alone; `status --json` shape.

## Docs

The distribution design doc gets a "Superseded 2026-10-09" note pointing
here. `README`/`AGENTS.md` mention `scripts/release.sh` where they describe
releasing.
