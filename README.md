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

## Quick start

You need a Mac with [Node 20+](https://nodejs.org) and git, and a free
[Plaid](https://dashboard.plaid.com) account. The iPhone app also needs
Xcode 26 and an iPhone on iOS 26. Each step is covered in detail further down.

**Web app**

1. `git clone https://github.com/tw-yoon/budget.git`, then run
   `./Budget.command` in that folder. If macOS blocks it, right-click it →
   **Open** → **Open**.
2. The first run creates `.env.local` and stops. Sign up at
   [dashboard.plaid.com](https://dashboard.plaid.com) and paste your client
   ID and sandbox secret into it as `PLAID_CLIENT_ID` and `PLAID_SECRET`.
3. Run `./Budget.command` again. It installs everything, sets up the
   database, builds the app (a minute or two the first time) and opens it at
   `http://localhost:3000`.
4. For fake data, run
   `curl -X POST http://localhost:3000/api/plaid/sandbox-seed`, wait a
   moment, then `curl -X POST http://localhost:3000/api/plaid/sync`
   ([Seeing data](#seeing-data)). Sandbox connects only fake test banks; real
   banks need production access, which you apply to Plaid for.

Day to day, double-click `Budget.command` to start it, even after a reboot,
and run `./Budget.command --update` to update. Your data stays in files on the
Mac.

**From another device** ([details](#using-budget-from-another-device))

1. Install [Tailscale](https://tailscale.com) on the Mac and the other device,
   signed in to the same account.
2. In the Tailscale admin console, turn on MagicDNS and HTTPS certificates.
3. On the Mac, run `tailscale serve --bg 3000`. It prints an address ending
   in `.ts.net`.
4. Open that address on the other device. It asks once for the access token,
   which is under Budget → Settings → Remote Access.

**iPhone app** ([details](ios/README.md))

1. With the web app running, open `ios/BudgetPhone.xcodeproj` in Xcode.
2. Simulator: press Run and enter `http://localhost:3000` as the server.
3. Your own phone:
   1. `cp ios/Config/Local.example.xcconfig ios/Config/Local.xcconfig`.
   2. Add your Apple ID under Xcode → Settings → Accounts, and put your
      Personal Team's ID in `Local.xcconfig` as `DEVELOPMENT_TEAM`. Do this
      before opening the project; don't pick the team in Xcode's Signing
      screen.
   3. Connect the phone by cable and turn on Developer Mode (Settings →
      Privacy & Security).
   4. Choose the phone in Xcode and press Run. The first time, trust the
      developer on the phone under Settings → General → VPN & Device
      Management.
   5. In the app's Settings → Server, enter the `.ts.net` address and the
      access token.
4. With a free Apple ID the app stops opening every 7 days. Run
   `bash ios/scripts/phone.sh schedule on` once and the Mac reinstalls it over
   Wi-Fi on its own ([details](ios/README.md#reinstall-automatically)).

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
v0.5.0 available (you have v0.4.0) — run ./Budget.command --update
```

[CHANGELOG.md](CHANGELOG.md) says what each version changed. The version you
are running is shown at the bottom of the sidebar, and by
`./Budget.command --check-only`. (A release published without a version bump
is reported as a count of commits instead.)

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
- `data/access-token` — the access token other devices need (see Settings →
  Remote Access). Delete it to make a new one.
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

## Using Budget from another device

Budget listens on the Mac only, so devices on your Wi-Fi cannot reach it,
even at home. Reach it through [Tailscale](https://tailscale.com) instead:

1. Install Tailscale on the Mac and on the other device, and sign in to the
   same account on both.
2. In the Tailscale admin console, enable MagicDNS and HTTPS certificates
   (DNS page), and allow Serve when the CLI prints its link.
3. On the Mac, run `tailscale serve --bg 3000` (or your `BUDGET_PORT`). It
   prints `https://<mac-name>.<tailnet>.ts.net` and keeps running across
   restarts. The CLI is at
   `/Applications/Tailscale.app/Contents/MacOS/Tailscale`.
4. On the other device, open that address (no port).
5. It asks for the access token once. On the Mac, open Budget → Settings →
   Remote Access, copy the token, and paste it in.

Reset Token under Settings → Remote Access signs out every other device until
it gets the new token. The Mac's own browser at `localhost` needs no token.

## iPhone app

`ios/` holds a native iPhone app for the same server. There is no App Store
build: you build it with Xcode, on your own Apple ID. Setup, from the
simulator to your own phone, is in [ios/README.md](ios/README.md). It reaches
the Mac through Tailscale, as above, and needs the access token.

## Two ways to run

| Command | When to use |
| --- | --- |
| `Budget.command` | **Everyday use** — checks for updates, rebuilds when code changed, runs the built app in the background. |
| `npm run dev` | While making changes — auto-reloads on edits (a little slower). Listens on the Mac only, like the built app. |

## Tests

```bash
npm test
```

No test framework is installed. `scripts/test-scrub.sh` checks that no personal
data or absolute home path is about to be published, and
`scripts/test-launcher.sh` drives `Budget.command` against throwaway clones to
cover setup, updating, and the cases where it must refuse — both plain Bash.
The `scripts/test-*.mjs` suites cover pure logic — refund linking, the wording
of a failed sync, category renaming, the version and changelog, the analytics detail mode, payment
splits, reward earnings and the best-card rates, Venmo statement parsing, Zelle
detection, subscription costs, the shared UI-state store — on Node's built-in
test runner, importing the TypeScript directly (Node 22.18+ strips the types,
and `scripts/resolve-alias.mjs` resolves the app's `@/` imports), so they need
no build step and no dependency. Run them before sending a change.

## Pages

- `/` — home
- `/accounts` — balances, net worth, due dates
- `/transactions` — ledger with search & filters; connect a refund to the purchase it pays back
- `/transactions/venmo` — categorize Venmo payments, or connect a payback to what it covers; changes flow into Transactions & Analytics
- `/transactions/zelle` — categorize or connect Zelle payments from your bank feed the same way (recognizes U.S. Bank's and Chase's descriptions; other banks word Zelle differently — see `src/lib/zelle.ts`)
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
