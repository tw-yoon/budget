# Public distribution and self-update — design

**Date:** 2026-09-10
**Status:** Approved, not yet implemented
**Scope:** Publish Budget Claude as an open-source project for technical users,
with a launcher-driven update path.

---

## Goal

Let another developer clone this project, run it on their own machine against
their own data, and pull later versions without hand-holding. Their financial
data never leaves their device, and no cost or liability transfers to the
maintainer.

Explicitly *not* a goal: non-technical installation, hosted multi-user service,
or Windows support.

## Audience

Developers. We assume `git`, `node`, and `npm` are present and that the user can
sign up for a Plaid account. We do not assume they have Plaid *production*
access, and the design works without it.

---

## Constraints discovered

1. **Plaid credentials cannot be shared.** Every user needs their own
   `PLAID_CLIENT_ID` / `PLAID_SECRET`. Shipping the maintainer's keys would bill
   the maintainer and violate Plaid's terms. Sandbox keys are free and
   self-serve; production access requires a per-account application. Most users
   will only ever run sandbox, and the README must say so plainly.
2. **The launcher is macOS-only.** `Budget.command` relies on `open`, `lsof`,
   `stat -f`, and `.command` double-click semantics.
3. **The project lives in a private monorepo.** `budget-claude/` is a subfolder
   of that repository, alongside other projects that hold personal data and must
   stay private.
4. **No secret file was ever committed.** No `.env`, `.db`, or token file
   appears anywhere in the history, and `scripts/.venmo-parsed.json` was never committed.
   Two tracked files carry local detail: `scripts/venmo-categorize.mjs`, which
   hardcodes absolute `~/Downloads` paths, and `.claude/settings.local.json`,
   which carries machine-local detail. The latter is machine-local by
   convention and should be untracked rather than scrubbed.
5. **A fresh clone does not currently boot.** `Budget.command` never runs
   `prisma migrate deploy`, so a clone with no `dev.db` has no schema. It also
   assumes `.env.local` already exists.

---

## Decisions

### Repository

A new public repo, `tw-yoon/budget`, created once by extracting the subfolder
with history.

**Superseded 2026-09-11: the public repo is created by squash, not by
preserving history.** The original procedure grafted the pre-merge history onto
the subtree split to recover all 47 commits, and it worked. It was abandoned for
a reason found only at the final review: scrubbing the working tree does not
scrub the history. The removed local settings file stays readable in earlier
commits, the personal category rules stay in the Venmo library until this
session, the maintainer's home-directory username appears in six commits and the
private sibling projects in two. The publish-step audit greps only the branch
tip, so it would have passed every one of them without complaint.

Rewriting with a history-filtering tool was considered and rejected: every commit
id changes, the tool is not installed here, and missing a single blob produces
exactly the failure it was meant to prevent -- with no way to take it back, since
a pushed commit can be cloned and cached regardless of what happens to it later.

The public repo therefore starts from a single `Initial commit` holding the
current, scrubbed tree. Nothing personal is recoverable because no prior state
exists to recover. The full history stays intact and private in the monorepo,
which is where it was always going to be read from anyway.

Ongoing publication is a deliberate sequence run from the private monorepo.

**Superseded 2026-09-16: `git subtree push` cannot publish this repo.** The
command recorded here was `git subtree push --prefix=budget-claude budget main`,
and it was never actually run. It cannot work, for the same reason the squash
was chosen in the first place: `git subtree split --prefix=budget-claude`
rebuilds the subfolder's *full* private history and roots it at that history's
first commit. The public repo is rooted at the squashed `Initial commit`, which
exists nowhere in the monorepo. The two histories are unrelated, so the push is
rejected -- and forcing it would replace the public repo with the entire private
history, which is precisely what squashing existed to prevent.

A release instead replays the new commits onto the published tip, one public
commit per private commit, with the `budget-claude/` prefix stripped. Begin by
finding which monorepo commit the public tip actually holds, rather than
trusting a guess -- run this from the monorepo:

```bash
PUB=$(mktemp -d)
git clone https://github.com/tw-yoon/budget.git "$PUB"
pub_tree=$(git -C "$PUB" rev-parse HEAD^{tree})
git log --format='%H' -- budget-claude | while read -r c; do
  [ "$(git rev-parse "$c:budget-claude")" = "$pub_tree" ] && echo "$c" && break
done
```

Call that commit `LAST`. Cut the patches, stripping the prefix as they are cut,
and apply them:

```bash
git format-patch --relative=budget-claude -o "$PUB/patches" LAST..HEAD -- budget-claude
git -C "$PUB" am "$PUB/patches"/*.patch
```

`--relative` is what makes the patches apply at the public repo's root, and
`git am` preserves each commit's message, author and author date -- so the
public history reads as the same commits, not as a re-dated import.

Confirm the applied result is identical to what is meant to be published before
anything leaves the machine. These two must print the same tree:

```bash
git rev-parse HEAD:budget-claude
git -C "$PUB" rev-parse HEAD^{tree}
```

**Superseded 2026-09-24: two things this replay does not handle on its own.**

*Versions.* Releases are numbered (`MAJOR.MINOR.PATCH`), and the numbers count
**releases, not commits**.

**Superseded 2026-09-24: bump at release, not at merge.** Numbering every merge
put six versions on one day's work, of which exactly one was ever published —
two of them were passes at the same unfinished change, and one shipped a bug the
next fixed. None of it was installable, and the changelog dated them all as if
they had shipped. Work now lands under a `## Unreleased` heading and is given a
number here, at the moment it is published: rename that heading to the version
with today's date, and set `version` in `package.json` to match. A release
carrying new features moves the middle number; one carrying fixes and small
changes moves the last. `scripts/test-version.mjs` fails if `package.json` and
the newest dated entry disagree, if `Unreleased` is dated, or if it is not at
the top.

Between releases `package.json` therefore names the last *published* version,
not what main contains — which is also what the launcher wants, since it
compares that field against the published one to say *what* is waiting rather
than how many commits.

*Merges.* `format-patch` omits merge commits, so a branch that was merged after
main had moved (and whose conflicts were resolved by hand) cannot be replayed
as a straight line — `git am` stops on the first conflicted file. Rebuild the
shape instead: apply the branch's own patches on the public commit matching its
real base, apply main's patches in merge order, then `git merge` in the public
clone and take the conflicted files verbatim from the private merge
(`git show <merge>:budget-claude/<path>`). After every step, compare
`git rev-parse HEAD^{tree}` in the clone against
`git rev-parse <private commit>:budget-claude`; they must be equal. Never add
the monorepo as a remote of the public clone — copy file contents, not objects.
Use `git am -3 --keep-cr`: `-3` for the merges, `--keep-cr` because a Venmo
test fixture deliberately uses CRLF line endings.

Scrub every commit, not only the tip — each private commit becomes a public
one, so run the checks over each patch's added lines *and* its message,
including merge messages, which carry no patch.

Then run `npm test` in the monorepo, and only once it is green:

```bash
git -C "$PUB" push origin main
```

The monorepo stays private and the day-to-day workflow is unchanged. Nothing
reaches the public repo except by running that sequence.

### Card presets ship

`src/data/card-presets.ts` is a curated static snapshot of publicly published
issuer terms for popular cards. It is generic reference data, useful to every
user, and contains nothing personal. The maintainer's own card selection lives in
`prisma/dev.db`, which is gitignored and was never committed, so no separate
scrub is needed.

### Update model: check on launch, update on request

`Budget.command` checks for updates on every launch but never applies them
without being asked. Silent auto-update was rejected: one bad commit would break
every user simultaneously, and changing someone's finance app underneath them
without consent is the wrong default.

---

## Work

### 1. Pre-publication scrub

Complete all of this *before* the first push; the point is to avoid publishing
something that then has to be rewritten out of history.

- `scripts/venmo-categorize.mjs` — read CSV paths from `process.argv` instead of
  the hardcoded `~/Downloads` list. Print usage when called with no arguments.
- Add `LICENSE` (MIT).
- Add `.env.example` carrying all five variables with explanatory comments.
  These currently exist only as prose in the README.
- Rewrite `README.md` for a stranger rather than for the maintainer. It must
  cover: what the app does, a screenshot, quickstart, where data is stored, and
  an honest statement that connecting real banks requires the reader's own Plaid
  production approval.
- Secret-scan the `public-budget` branch before pushing, not after.

### 2. First-run bootstrap

`Budget.command` gains a bootstrap step that runs before the existing
build-and-start logic.

- **Missing `.env.local`** — copy `.env.example`, generate `TOKEN_STORE_KEY` with
  `openssl rand -hex 32`, write it in, then stop with a message telling the user
  to paste their Plaid sandbox keys. Stopping is correct here: the app cannot do
  anything useful without them.
- **Missing or empty `prisma/dev.db`** — run `npx prisma migrate deploy`. This
  also runs on every `--update`, since a pulled migration must be applied before
  the new build starts.
- **Empty database** — the README directs the user to the existing
  `/api/plaid/sandbox-seed` route so the first screen shows populated accounts
  and transactions instead of an empty shell.

### 3. Update mechanism

Two additions to `Budget.command`.

**On every launch**, after bootstrap and before the build check: `git fetch` with
a short timeout. Skip silently when the directory is not a git clone, when there
is no `origin`, or when the network is unavailable — an offline launch must still
start the app. When `HEAD` is behind `origin/<branch>`, print the count and the
exact command to run, then continue starting the current version.

**With `--update`**: `git pull --ff-only`, then `npx prisma migrate deploy`, then
fall through to the existing `needs_install` and `needs_build` checks. No new
build logic is required — `needs_build()` compares source mtimes against
`.next/BUILD_ID`, and a pull makes pulled files newer, so the rebuild triggers on
its own.

A dirty working tree aborts the update with an explanation and a suggested
`git stash`, rather than surfacing a raw git error. Users are expected to edit
files like card presets locally, so this path will be hit in practice and should
read as a normal outcome, not a failure.

### 4. Platform support

The launcher stays macOS-only. The README documents
`npm install && npm run build && npm start` as the universal fallback, which
already works on any platform — Linux users simply do not get the launcher, and
Windows users need WSL. This is stated directly rather than left to be
discovered.

---

## Verification

Both rehearsals run against a clone in `/tmp`, not against the working copy.

**Cold start.** Clone the public repo fresh, with no `.env.local` and no
`dev.db`. Confirm the launcher generates the env file and halts with a clear
message; add sandbox keys; confirm the second launch migrates, builds, starts,
and serves a usable app. This is the only check that proves the first-run gap is
actually closed.

**Update.** In that same clone, `git reset --hard HEAD~2`, then run
`./Budget.command`. Confirm it reports updates available and still starts. Then
run `./Budget.command --update` and confirm it pulls, migrates, rebuilds, and
restarts. Then dirty a tracked file and confirm `--update` aborts with the
readable message rather than a git error.

Implementation must consult `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`
before changing anything about how the app is built or started. This project
tracks a Next.js version whose conventions differ from common knowledge.

---

## Out of scope

Docker, npm publishing, packaged installers, automatic updates, an in-app update
button, a hosted version, Windows support, and CI. Each is a reasonable future
step; none is needed to let a developer run this today.

## Risks

**Plaid approval is a wall.** Most visitors will only ever see sandbox data. If
the README implies otherwise, people will feel baited after investing setup time.
The limitation belongs near the top of the README, not in a footnote.

**Support burden.** Issues from strangers about an app that touches real bank
accounts carry a different weight than issues about a typical side project.
Consider leaving GitHub Issues disabled at first, or stating the support posture
in the README before turning them on.
