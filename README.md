# Budget Claude

A local-first personal budgeting app. It connects to your bank accounts through
Plaid, and everything it stores — accounts, transactions, balances — lives in a
SQLite database on your own machine, not in someone else's cloud. It tracks
account balances and net worth, gives you a searchable transaction ledger,
shows spending analytics (by category, by month, by merchant), and works out
which of your credit cards earns the most for each kind of purchase.

Every transaction carries a permanent number. Money that comes in but isn't
really income — a refund, or a friend paying you back — can be connected to the
purchase it covers by that number. It then takes on that purchase's category and
nets against it, instead of inflating your income and leaving the spending
overstated.

## Before you start

You'll need:

- macOS (the launcher below is macOS-only — see [Other platforms](#other-platforms) if you're not)
- [Node 20+](https://nodejs.org)
- git
- A [Plaid](https://dashboard.plaid.com) account (free to sign up)

**Read this before you spend time on setup.** Plaid sandbox keys are free and
issued the moment you sign up — they connect to fake test banks with fake
data, which is enough to see everything this app does. Connecting your *real*
banks is a separate, gated step: you have to apply to Plaid for production
access, it's reviewed per account, and it's billed per connected institution.
Most people who try this out will only ever use sandbox, and that's fine — just
know going in that "real bank" isn't a checkbox, it's an application.

## Setup

```bash
git clone https://github.com/tw-yoon/budget.git
cd budget
./Budget.command
```

The first run writes `.env.local` (generating an encryption key for you) and
then stops, because it has nothing to connect to yet:

1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com) — sandbox keys are free and instant.
2. Copy your `client_id` and sandbox `secret`.
3. Paste them into `.env.local` as `PLAID_CLIENT_ID` and `PLAID_SECRET`.
4. Run `./Budget.command` again. This time it installs dependencies, sets up
   the database, builds the app (~1–2 min the first time), starts it, and
   opens your browser.

> First time you double-click `Budget.command` (or the first time you run it
> at all), macOS may warn it's from an unidentified developer. Right-click the
> file → **Open** → **Open** to allow it (only needed once).

## Seeing data

A fresh sandbox account has no accounts or transactions, so the app starts
empty. Populate it with fake data:

```bash
curl -X POST http://localhost:3000/api/plaid/sandbox-seed
```

(If you set `BUDGET_PORT`, use that port instead of 3000 — here and below.)

This mints a Plaid sandbox item (a fake bank called "First Platypus Bank")
and syncs it in. It only works while `PLAID_ENV=sandbox`, which is the
default.

Accounts show up immediately. Transactions usually don't — Plaid is still
generating them while the seed's own sync runs, so that first pass reports
`"added":0`. Pull them with a second call once it has caught up:

```bash
curl -X POST http://localhost:3000/api/plaid/sync
```

That brings in a few dozen transactions across the sandbox accounts. It's
idempotent, so running it again when nothing is new adds nothing.

## Turn it OFF

```bash
lsof -ti:3000 | xargs kill
```

(Or whichever port you set `BUDGET_PORT` to.)

(Leaving it running is fine too — it's a local server and uses little memory.)

## Updating

Every normal launch checks in the background for a newer published version and
tells you if one exists:

```
2 update(s) available — run ./Budget.command --update
```

To apply it:

```bash
./Budget.command --update
```

This fast-forwards your clone to the latest commit, applies any new database
migrations, rebuilds, and restarts the server. `--update` refuses to run if:

- this folder isn't a git clone (including being a subfolder of a larger one)
- the clone has no `origin` remote to update from
- this folder is a linked git worktree rather than the main checkout — run
  `--update` from the main checkout instead
- you have uncommitted local changes (`git stash` them first)

It can also fail partway through if history has diverged because you have
commits of your own — that's reported separately, after the pull is attempted.

To check setup and update status without building or starting the app:

```bash
./Budget.command --check-only
```

`--check-only` and `--update` can't be combined — one only reports, the other
changes things, and combining them is rejected outright.

`--check-only` isn't perfectly side-effect-free, though. Setup runs before the
flag is consulted, so a first run still writes `.env` and `.env.local` (and
generates your encryption key); and if dependencies are installed but the
database hasn't been created yet, it creates and migrates that too. What it
never does is build or start the app.

## Where your data lives

- `prisma/dev.db` — the SQLite database: accounts, transactions, balances.
- `data/tokens.enc` — your Plaid access tokens, encrypted at rest.
- `prisma/backups/` — a daily snapshot of `dev.db`, kept for 30 days, written
  automatically each time you launch. `--update` also writes its own
  `pre-update-*.db` snapshot right before running migrations, kept on the
  same 30-day schedule.

None of this is tracked in git, and none of it leaves your machine except to
talk to Plaid, which you connected yourself — there is no other server this
app reports back to.

## Other platforms

`Budget.command` is macOS-only. Elsewhere, the underlying app is a normal
Next.js project:

```bash
npm install
npm run build
npm start
```

This works anywhere Node runs, but you're on your own for what the launcher
otherwise automates: copy `.env.example` to `.env.local` and `.env`, fill in
your Plaid keys, generate a `TOKEN_STORE_KEY` (`openssl rand -hex 32`), and run
`npx prisma migrate deploy` before the first start. On Windows, do this inside
WSL — there's no native-Windows path.

## Good to know

- **Your data is safe across on/off.** Everything lives in `dev.db` on disk.
  Stopping the server never touches it — next start, it's all still there.
- **After a reboot**, just double-click `Budget.command` again.
- **Server logs** go to `.server.log` in this folder — check it if a launch
  fails silently (e.g. when double-clicked, where the window may close before
  you can read the error).
- **Port in use?** Set `BUDGET_PORT` before launching (e.g.
  `BUDGET_PORT=3001 ./Budget.command`) to run on something other than 3000.

## Two ways to run

| Command | When to use |
| --- | --- |
| `Budget.command` | **Everyday use** — checks for updates, rebuilds when code changed, runs the built app in the background. |
| `npm run dev` | While making changes — auto-reloads on edits (a little slower). |

## Tests

```bash
npm test
```

No test framework is installed. `scripts/test-scrub.sh` checks that no personal
data or absolute home path is about to be published, and
`scripts/test-launcher.sh` drives `Budget.command` against throwaway clones to
cover setup, updating, and the cases where it must refuse — both plain Bash.
The `scripts/test-*.mjs` suites cover pure logic — refund linking, the wording
of a failed sync, category renaming, the analytics detail mode — on Node's
built-in test runner, importing the TypeScript
directly (Node 22+ strips the types), so they need no build step and no
dependency. Run them before sending a change.

## Pages

- `/` — home
- `/accounts` — balances, net worth, due dates
- `/transactions` — ledger with search & filters; connect a refund to the purchase it pays back
- `/venmo` — categorize Venmo payments, or connect a payback to what it covers; changes flow into Transactions & Analytics
- `/zelle` — categorize or connect Zelle payments from your bank feed the same way
- `/analytics` — spending by category, monthly trend, top merchants
- `/benefits` — card earning rates + statement credits + "best card by category"
- `/subscriptions` — detected recurring subscriptions and their monthly total
- `/income` — income and tax organizer
- `/settings/categories` — rename, merge and delete categories
- `/settings/rules` — auto-assign a category when a transaction matches a rule
- `/settings/connections` — connect/disconnect banks, reconnect, manage debit cards
- `/settings/analytics` — how much detail the Analytics page shows

## Configuration

Settings live in **`.env.local`** (kept on your machine, never committed):

- `PLAID_CLIENT_ID` / `PLAID_SECRET` — your Plaid keys (the secret must match the
  environment below)
- `PLAID_ENV` — `sandbox` (test data) or `production` (real banks)
- `DATABASE_URL` — the local SQLite file (`dev.db`)
- `TOKEN_STORE_KEY` — encryption key for stored bank tokens

Bank access tokens are stored **encrypted** in `data/tokens.enc`, never in plaintext
or in git. See `.env.example` for optional overrides (`TOKEN_STORE_PATH`,
`VENMO_STATEMENT_DIR`).

## If you change the database schema

After editing `prisma/schema.prisma`:

```bash
DIR="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_change"   # UTC keeps order correct
mkdir -p "$DIR"
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$DIR/migration.sql"
npx prisma migrate deploy
npx prisma generate
```

Then restart `npm run dev`. (Use UTC timestamps for the folder name so migrations
stay in order.)

---

## A note on support

This is a personal project, shared as-is because it might be useful to someone
else. Issues and pull requests are open and I read them, but I may not respond,
and I make no promise to fix anything or keep it maintained.

If you find a security problem, please report it privately through GitHub's
security advisories rather than opening a public issue.
