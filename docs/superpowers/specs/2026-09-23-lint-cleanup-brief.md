# Lint cleanup brief

Make `npm run lint` report zero problems, so lint works as a real signal again.
Today it reports 11,594 problems, and a genuine new warning is invisible in
that noise.

**This is written for an unattended overnight run.** Read the section of that
name before starting — it changes how you finish.

All paths below are relative to the app folder (the one holding `package.json`
and `AGENTS.md`).

## Before anything else

- Read `AGENTS.md`. This is Next.js 16.2.9 with breaking changes from what you
  may expect; read the relevant guide in `node_modules/next/dist/docs/` before
  writing code.
- The stack: React 19, Prisma 5 over SQLite, Tailwind 4.

## The diagnosis — already done, verify rather than redo

`npx eslint -f json .`, grouped by top-level directory:

| Where | Problems |
|---|---|
| `.next-preview/` | 11,593 (1,113 errors, 10,480 warnings) |
| `src/` | 1 |

**`.next-preview/` is generated build output.** The dev launcher config in
`.claude/launch.json` sets `NEXT_DIST_DIR=.next-preview`. It is already
gitignored, but `eslint.config.mjs` never ignores it: its `globalIgnores` lists
`.next/**`, `out/**`, `build/**` and `next-env.d.ts`, and nothing else. The
rules firing there — `no-unused-expressions`, `no-unused-vars`,
`no-require-imports` — are what minified bundles trip, which confirms it is
generated code rather than source.

**The one real problem** is `src/components/benefits/UserCardItem.tsx:42`,
rule `react-hooks/set-state-in-effect`:

```tsx
useEffect(() => {
  const saved = localStorage.getItem(storeKey);
  if (saved !== null) setShowCredits(saved === "1");
}, [storeKey]);
```

## The two fixes

**1. Add `.next-preview/**` to `globalIgnores` in `eslint.config.mjs`.**
Trivial. While there, check whether any other generated or build directory is
being linted that shouldn't be.

**2. Fix `UserCardItem.tsx:42` properly — this one is a trap.**
The obvious rewrite, reading `localStorage` in a lazy `useState` initializer, is
wrong in Next. `localStorage` does not exist during server rendering, so the
server would render one value and the browser another: a hydration mismatch.
That is almost certainly why the read sits in an effect in the first place.

Look at what React and the bundled Next docs recommend for reading
browser-only storage without a hydration mismatch — `useSyncExternalStore` is
the usual answer — and pick what is correct here. If you conclude the effect
genuinely is the right pattern, a narrowly scoped `eslint-disable-next-line`
with a comment explaining why is acceptable. Disabling the rule wholesale is
not.

Worth knowing, but **do not act on it**: `src/lib/ui-state.ts` provides a
shared cross-browser preference store (`loadSynced` / `pushSynced`, backed by
`data/ui-state.json`), and this codebase's convention sends small UI
preferences through it rather than raw `localStorage`. Moving the credits
toggle onto it would change behavior — the preference would start syncing
across browsers — so leave it, and mention it in your report as an option.

## Running unattended overnight

Nobody is watching. Work accordingly.

- **Do not stop to ask questions.** Make the judgment call, and record it in
  your final report as: *what you decided — why — what it costs if you were
  wrong.* A wrong call costs the owner a quick revert in the morning; a session
  parked on a question costs the whole night.
- **Stop only for these**, and say plainly in your report that you stopped and
  why:
  - anything that would write to `prisma/dev.db` or `data/ui-state.json`;
  - merging into `main`, or pushing anywhere;
  - a failure you cannot explain after a genuine attempt to diagnose it.
- **Finish on your branch. Do not merge.** The owner merges in the morning.
  Before you stop, dry-run the merge with `git merge-tree --write-tree main
  HEAD` and report whether it is clean — other sessions land work on `main`
  concurrently, so it may not be.
- **Do not run `bash Budget.command --no-open`.** It restarts the owner's live
  app on port 3000 from whatever checkout it runs in. That rebuild belongs
  after the merge, not before.
- **Commit after each fix.** If a usage limit cuts you off mid-run, the
  branch's commits are the only record of how far you got, and a later session
  resumes from them.

## Constraints

- **Work on a branch**, e.g. `lint-cleanup`. Never commit to `main` directly.
- **A fresh worktree has no `node_modules`.** Run `npm ci` first;
  `scripts/test-launcher.sh` refuses to run without
  `node_modules/.package-lock.json`.
- **Never commit an absolute path.** `npm test` runs `scripts/test-scrub.sh`
  first, and it fails on any home-directory path in a tracked file outside
  `docs/`. That includes `.claude/launch.json`: another session recently broke
  the whole suite by committing a worktree path into it. If you add a dev
  server config for your worktree, keep it out of your commits.
- **Run your dev server in the background, on a port other than 3000.** A
  foreground server never returns; port 3000 is the owner's live app.
- `prisma/dev.db` and `data/ui-state.json` hold the owner's real,
  irreplaceable financial data. This task has no reason to touch either.

## Done means

- `npx eslint .` reports **zero errors and zero warnings**, run in a checkout
  where `.next-preview/` actually exists. A fresh worktree has none until its
  dev server has run once, which would make a clean result meaningless — so run
  it once first. Report the before and after counts.
- The credits toggle in the card benefits view still remembers its state
  across a page reload, with **no hydration warning in the browser console**.
  Check it in a real browser, not by reading the code.
- `npx tsc --noEmit` and `npm test` both pass.

## The report to leave for the morning

End with a short message the owner can read in a minute:

- before and after lint counts;
- what you changed, and why the credits-toggle fix is hydration-safe;
- every judgment call you made, in the *decided — why — cost if wrong* form;
- the merge dry-run result, and whether it is ready to merge;
- whether lint is now worth adding to `npm test`. **Do not wire it in
  yourself** — recommend, and let the owner decide.

Commit this brief as the first commit on your branch, so the reasoning travels
with the change.
