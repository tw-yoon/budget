# Budget

Budget is a money app that runs on your own Mac. It connects to your bank and
credit card accounts and shows you, in one place:

- how much money you have, and what you owe
- every purchase, with search
- where your money goes each month (food, rent, shopping…)
- which credit card earns the most for each kind of purchase

Everything is kept **on your Mac**. Your bank data isn't sent to anyone
else's servers, except Plaid, the service that talks to your banks for you.

```
  Your banks  ──►  Plaid  ──►  Budget on your Mac  ──►  your browser / iPhone
```

- **Plaid** is a company many money apps use to read bank accounts. You make a
  free Plaid account and give Budget its keys.
- **Your Mac** is the brain. It stores everything, so it has to be on for
  Budget to work.
- **Your iPhone** (optional) is a window into your Mac. It reaches your Mac
  through a free app called Tailscale, even when you're away from home.

## Contents

1. [What you need](#what-you-need)
2. [How to use Terminal](#how-to-use-terminal)
3. [Quick install (one paste)](#quick-install-one-paste)
4. [Step 1: Install Node.js](#step-1-install-nodejs)
5. [Step 2: Install Git](#step-2-install-git)
6. [Step 3: Get your Plaid keys](#step-3-get-your-plaid-keys)
7. [Step 4: Download Budget](#step-4-download-budget)
8. [Step 5: Add your Plaid keys](#step-5-add-your-plaid-keys)
9. [Step 6: Start Budget](#step-6-start-budget)
10. [Step 7: Add a pretend bank](#step-7-add-a-pretend-bank)
11. [Step 8: Open Budget on your phone or another computer](#step-8-open-budget-on-your-phone-or-another-computer-optional)
12. [Step 9: The iPhone app](#step-9-the-iphone-app-optional)
13. [Everyday use](#everyday-use)
14. [Where your data is kept](#where-your-data-is-kept)

## What you need

| What | Where to get it | Cost | Needed for |
| --- | --- | --- | --- |
| A Mac | — | — | Everything |
| **Node.js**: lets the Mac run Budget | [nodejs.org](https://nodejs.org) ([Step 1](#step-1-install-nodejs)) | Free | Everything |
| **Git**: downloads Budget and its updates | Comes with the Mac; you switch it on ([Step 2](#step-2-install-git)) | Free | Everything |
| A **Plaid** account | [dashboard.plaid.com](https://dashboard.plaid.com) ([Step 3](#step-3-get-your-plaid-keys)) | Free to try | Everything |
| **Tailscale**, on the Mac and on your phone | [tailscale.com/download](https://tailscale.com/download) | Free | Opening Budget away from the Mac ([Step 8](#step-8-open-budget-on-your-phone-or-another-computer-optional)) |
| **Xcode**: Apple's app for building iPhone apps | [Mac App Store](https://apps.apple.com/app/xcode/id497799835) | Free | The iPhone app ([Step 9](#step-9-the-iphone-app-optional)) |
| An iPhone on iOS 26, a cable, an Apple ID | — | Free Apple ID is fine | The iPhone app |

Plan on about **30 minutes** for Steps 1 to 7.

> **About real banks.** A new Plaid account comes with "sandbox" keys. They
> connect only to *pretend* banks with *made-up* money, which is enough to see
> everything Budget does. To connect your *real* banks, you apply to Plaid for
> "production" access. Plaid reviews the application and charges for each bank
> you connect. Start with pretend banks.

## How to use Terminal

Some steps say **Paste into Terminal**. Terminal is an app that comes with
every Mac. You type (or paste) a line into it, and the Mac does it.

**To open Terminal**, either:

- press **⌘ Command + Space**, type `Terminal`, and press **Return**, or
- open **Finder → Applications → Utilities → Terminal**.

A window opens with a line ending in `%`. That's where you paste.

**To run a command:**

1. On this page, click the copy button at the top right of the grey box (or
   select the text and press **⌘ C**).
2. Click inside the Terminal window and press **⌘ V**.
3. Press **Return**.
4. Wait until a new line ending in `%` appears. That means it's finished.

Paste **one grey box at a time**, in order. Leave Terminal open between steps.

---

## Quick install (one paste)

This does Steps 1, 2, 4, 5 and 6 below for you with one paste. Prefer to do it
by hand? Steps 1 to 6 below do the same thing.

1. Get your Plaid keys first. The installer asks for them. Do
   [Step 3](#step-3-get-your-plaid-keys) now, and keep that page open.
2. Open Terminal (see above) and paste:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/tw-yoon/budget/main/scripts/install.sh | bash
   ```

3. Answer what it asks, as it goes:
   - A window may ask to install the **command line developer tools**. Click
     **Install** (not "Get Xcode"), then **Agree**, and wait. It can take 5 to
     15 minutes; Terminal waits too.
   - Your Mac may ask for its **password** to install Node.js. Nothing shows
     while you type; that's normal. Press **Return** when done.
   - It asks you to paste your **client_id**, then your **Sandbox secret**.
     Paste each one and press **Return**. The secret stays hidden.
4. It then starts Budget. The first time takes **3 to 5 minutes**.

✅ **You should see** `Budget v… is ready at http://localhost:3000`, and your
browser opens Budget. Go to [Step 7](#step-7-add-a-pretend-bank).

You can paste the line again at any time. It skips what's already done.

❌ **If you see** `The command line tools aren't installed yet`: the wait for
the developer tools ran out. Finish that install (or paste
`xcode-select --install` to open the window again), then paste the quick
install line again.

❌ **If you see** `Download the LTS installer from https://nodejs.org, open it,
click through it, then paste this line again`: the installer couldn't set up
Node.js. Do [Step 1](#step-1-install-nodejs) by hand, then paste the quick
install line again.

❌ **If you see** `There's already a folder at … that isn't Budget`: a folder
named `budget` is already in your Documents folder. Rename or move it, then
paste the quick install line again.

❌ **If you see** `INVALID_API_KEYS` or `invalid client_id or secret` later,
when you add the pretend bank: a Plaid key is wrong. See the first ❌ in
[Step 7](#step-7-add-a-pretend-bank).

---

## Step 1: Install Node.js

Used the quick install? Skip to [Step 7](#step-7-add-a-pretend-bank).

1. Go to [nodejs.org](https://nodejs.org) and click the big **Download** button
   (the **LTS** version).
2. Open your **Downloads** folder and double-click the file that ends in
   `.pkg`.
3. Click **Continue** and **Agree** through the installer, enter your Mac
   password when asked, and click **Close** at the end.
4. **Quit Terminal (⌘ Q) and open it again**, so it notices Node.js.
5. Paste into Terminal:

   ```bash
   node --version
   ```

✅ **You should see** a version number starting with `v20`, `v22` or higher,
like `v22.12.0`.

❌ **If you see** `zsh: command not found: node`: Node.js isn't installed yet,
or Terminal was opened before it was. Do sub-steps 1 to 4 again, making sure
you quit and reopen Terminal.

❌ **If you see** a number lower than `v20` (like `v18.17.0`): you have an old
Node.js. Install the new one from [nodejs.org](https://nodejs.org) over it.

## Step 2: Install Git

1. Paste into Terminal:

   ```bash
   git --version
   ```

✅ **You should see** something like `git version 2.39.5`. Git is ready; go to
Step 3.

🪟 **Or a window pops up** saying the `git` command requires the "command line
developer tools". This is normal on a new Mac:

1. Click **Install** (not "Get Xcode"), then **Agree**.
2. Wait for it to finish. It can take 5 to 15 minutes.
3. Click **Done**, then paste `git --version` again. You should now see a
   version number.

❌ **If it says** "can't install the software because it is not currently
available": check your internet connection and try again later.

## Step 3: Get your Plaid keys

1. Go to [dashboard.plaid.com](https://dashboard.plaid.com) and click **Sign
   up**. Fill in the form and confirm your email.
2. Once you're signed in, open **Developers → Keys** (in the menu on the
   left, or under your account at the top right).
3. You'll see two things you need. Keep this page open for Step 5:
   - **client_id**: a long line of letters and numbers.
   - **Sandbox** secret: click to reveal it, then copy. Use the **Sandbox**
     one, not "Production".

## Step 4: Download Budget

This puts Budget in a folder called `budget` inside your **Documents** folder.

1. Paste into Terminal:

   ```bash
   cd ~/Documents
   ```

   ✅ **You should see** nothing new except a fresh line ending in `%`.
   That's correct: it just moved Terminal into your Documents folder.

2. Paste into Terminal:

   ```bash
   git clone https://github.com/tw-yoon/budget.git
   ```

   ✅ **You should see** `Cloning into 'budget'...` and a few lines ending in
   `done.`

   ❌ **If you see** `fatal: destination path 'budget' already exists`: you
   already downloaded it. Skip to sub-step 3.

   ❌ **If you see** `Could not resolve host`: you're offline. Connect to the
   internet and paste it again.

3. Paste into Terminal:

   ```bash
   cd ~/Documents/budget
   ```

   ✅ **You should see** the line before `%` now ends in `budget`.

## Step 5: Add your Plaid keys

1. Paste into Terminal:

   ```bash
   ./Budget.command
   ```

   ✅ **You should see:**

   ```
   Created .env.local and generated your encryption key.

   One thing left — Budget needs Plaid credentials to fetch bank data:
   ```

   …and a few more lines. This is expected. Budget made its settings file and
   now needs your Plaid keys.

   ❌ **If you see** `no such file or directory: ./Budget.command`: Terminal is
   in the wrong folder. Paste `cd ~/Documents/budget` and try again.

2. Paste into Terminal to open the settings file in TextEdit:

   ```bash
   open -e .env.local
   ```

   ✅ **You should see** a TextEdit window with lines of text.

3. In TextEdit, find these two lines:

   ```
   PLAID_CLIENT_ID=
   PLAID_SECRET=
   ```

   Click right after the first `=` and paste your **client_id**. Click right
   after the second `=` and paste your **Sandbox secret**. When you're done
   they look like this, with your own keys:

   ```
   PLAID_CLIENT_ID=6501a2b3c4d5e6f7a8b9c0d1
   PLAID_SECRET=0123456789abcdef0123456789abcd
   ```

   - No spaces, no quote marks, nothing else on those lines.
   - Don't change any other line.

4. Press **⌘ S** to save, then close TextEdit.

## Step 6: Start Budget

1. Paste into Terminal:

   ```bash
   ./Budget.command
   ```

2. Wait. **The first time takes 3 to 5 minutes**, and lots of text scrolls by.
   That's normal.

✅ **You should see**, at the end:

```
Budget v0.9.1 is ready at http://localhost:3000
```

(Your version number may be different.) Your web browser opens Budget by
itself. It's empty for now; Step 7 fills it.

❌ **If you see** `Build failed` or `Server didn't start`: paste
`open -e .server.log` to open the error log. The problem is usually described
near the bottom. Make sure Step 1 worked, then paste `./Budget.command` again.

❌ **If you see** `Database setup failed`: paste `./Budget.command` again. If
it fails the same way, open the log with `open -e .server.log`.

🪟 **If macOS says** "Budget.command can't be opened because it is from an
unidentified developer" (this can happen when you double-click it later): open
your `budget` folder in Finder, **right-click** `Budget.command`, choose
**Open**, then **Open** again. You only do this once.

## Step 7: Add a pretend bank

A new Budget has no banks. Add Plaid's pretend bank to see how it all looks.

1. Paste into Terminal:

   ```bash
   curl -X POST http://localhost:3000/api/plaid/sandbox-seed
   ```

   ✅ **You should see** one long line that includes
   `"institution":"First Platypus Bank (Sandbox)"`. The pretend bank and its
   accounts are added.

   ❌ **If you see** `INVALID_API_KEYS` or `invalid client_id or secret`: a Plaid
   key is wrong. Do Step 5 again (sub-steps 2 to 4), checking you used the
   **Sandbox** secret. Then restart Budget so it reads the new keys:

   ```bash
   lsof -ti:3000 | xargs kill; ./Budget.command
   ```

   …and paste the `curl` line above again.

   ❌ **If you see** `Failed to connect to localhost port 3000`: Budget isn't
   running. Paste `./Budget.command`, wait for "ready", then try again.

2. **Wait one minute.** Plaid needs a moment to make the pretend purchases.
3. Paste into Terminal:

   ```bash
   curl -X POST http://localhost:3000/api/plaid/sync
   ```

   ✅ **You should see** a line starting with `{"summary":`.

4. Go back to Budget in your browser and refresh the page (**⌘ R**).

✅ **You should see** accounts on the Accounts page, and a few dozen purchases
under Transactions.

❌ **If there are accounts but no purchases**: Plaid wasn't finished yet. Wait
another minute and paste the `sync` line again. Doing it more than once never
adds anything twice.

**That's it — Budget is set up.** Steps 8 and 9 are optional.

## Step 8: Open Budget on your phone or another computer (optional)

Budget only answers the Mac it runs on, so other devices can't open it, even
on your home Wi-Fi. **Tailscale** connects your own devices privately and
securely, from anywhere.

1. **Install Tailscale on the Mac:** go to
   [tailscale.com/download](https://tailscale.com/download), choose **macOS**,
   and install it. Open it, then sign in (with Google, Apple, or another
   account).
   ✅ A Tailscale icon appears in the menu bar at the top right of the screen.
2. **Install Tailscale on the phone:** on the iPhone, open the **App Store**,
   search **Tailscale**, install it, and sign in with the **same** account as
   on the Mac. Allow the VPN setup when asked.
3. **Turn on two settings:** on the Mac, go to
   [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns).
   Make sure **MagicDNS** is on, then scroll down and click **Enable HTTPS**.
4. **Give Budget an address:** paste into Terminal:

   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 3000
   ```

   ✅ **You should see** an address like
   `https://your-mac.tail1234.ts.net`. **Copy it and keep it**; you'll use it
   on every device. It keeps working after restarts, so you only do this
   once.

   🪟 **If instead it prints a link and says Serve isn't enabled**: open the
   link, click to allow it, then paste the command again.

   ❌ **If you see** `no such file or directory`: Tailscale isn't in your
   Applications folder. Install it (sub-step 1) and try again.

5. **Copy your access token:** in Budget on your Mac, open **Settings →
   Remote Access** and copy the token. This is the password other devices use.
6. **Open Budget on the other device:** make sure Tailscale is on there, open
   the web browser, and go to your `https://…ts.net` address. Paste the access
   token when asked. It only asks once per device.

❌ **If the page won't load on the other device**: check that Tailscale is
switched on there, and that Budget is running on the Mac.

> **Reset Token** (under Settings → Remote Access) makes a new token. Every
> other device then needs the new one. Use it if you think someone else has
> your token.

## Step 9: The iPhone app (optional)

The iPhone app isn't in the App Store. You put it on your phone yourself with
Xcode, using your own free Apple ID. Do Step 8 first, since the app reaches
your Mac through Tailscale.

**Follow the steps in [ios/README.md](ios/README.md).**

---

## Everyday use

| To… | Do this |
| --- | --- |
| **Start Budget** (also after restarting the Mac) | In Finder, open **Documents → budget** and double-click **Budget.command** |
| **Open Budget** on the Mac | Go to `http://localhost:3000` in your browser |
| **Stop Budget** | Paste `lsof -ti:3000 \| xargs kill` into Terminal. You don't have to: leaving it on is fine and uses little memory. |
| **Update Budget** | Paste `cd ~/Documents/budget && ./Budget.command --update` into Terminal |

**When there's an update**, starting Budget prints something like:

```
v0.10.0 available (you have v0.9.1) — run ./Budget.command --update
```

[CHANGELOG.md](CHANGELOG.md) says what changed in each version. Your version
is shown at the bottom of Budget's sidebar.

**Stopping Budget never loses data.** Everything stays on your Mac and is
there next time.

### If an update goes wrong

❌ **If you see** `You have uncommitted changes, so the update stopped`: some
files in the `budget` folder were changed. Paste these one at a time:

```bash
git stash
```

```bash
./Budget.command --update
```

```bash
git stash pop
```

❌ **If you see** `Could not update`: open the log with `open -e .server.log`
to see why.

### Other problems

| What you see | What to do |
| --- | --- |
| A bank shows an error in Budget | Go to **Settings → Connections** and click **Reconnect** next to that bank. |
| Budget won't open after a restart | It isn't running. Double-click **Budget.command** (see the table above). |
| The window closes too fast to read an error | Paste `cd ~/Documents/budget && open -e .server.log`. The error is near the bottom. |
| The log mentions port 3000 being in use | Another app is using that spot. Paste `cd ~/Documents/budget && BUDGET_PORT=3001 ./Budget.command`, then use `3001` instead of `3000` everywhere. |

## Where your data is kept

All inside **Documents → budget**, on your Mac only:

- `prisma/dev.db`: your accounts, purchases and balances.
- `prisma/backups/`: a copy of that file saved each day you start Budget, kept
  for 30 days. Updating also saves a copy first.
- `data/tokens.enc`: the keys Plaid gives Budget to read your banks, locked
  with encryption.
- `data/access-token`: the access token for your other devices (Step 8).
  Delete it to make a new one.

None of this is uploaded anywhere. Budget doesn't report back to any server;
it only talks to Plaid, which you connected yourself.

---

## For developers

The rest of this page is for people who want to change Budget's code.

### Other platforms

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

### The launcher in detail

`./Budget.command --update` fast-forwards your clone to the latest commit,
applies any new database migrations, rebuilds, and restarts the server. It
refuses to run if:

- this folder isn't a git clone (including being a subfolder of a larger one)
- the clone has no `origin` remote to update from
- this folder is a linked git worktree rather than the main checkout — run
  `--update` from the main checkout instead
- you have uncommitted local changes (`git stash` them first)

It can also fail partway through if history has diverged because you have
commits of your own — that's reported separately, after the pull is attempted.
A release published without a version bump is reported as a count of commits
instead of a version.

`./Budget.command --check-only` reports setup and update status without
building or starting the app. It can't be combined with `--update`. It isn't
perfectly side-effect-free: setup runs before the flag is consulted, so a
first run still writes `.env` and `.env.local` (and generates your encryption
key), and if dependencies are installed but the database hasn't been created
yet, it creates and migrates that too.

Server logs go to `.server.log`. Set `BUDGET_PORT` to run on a port other than
3000.

### Two ways to run

| Command | When to use |
| --- | --- |
| `Budget.command` | **Everyday use** — checks for updates, rebuilds when code changed, runs the built app in the background. |
| `npm run dev` | While making changes — auto-reloads on edits (a little slower). Listens on the Mac only, like the built app. |

### Tests

```bash
npm test
```

No test framework is installed. `scripts/test-scrub.sh` checks that no personal
data or absolute home path is about to be published,
`scripts/test-launcher.sh` drives `Budget.command` against throwaway clones to
cover setup, updating, and the cases where it must refuse, and
`scripts/test-phone-reinstall.sh` covers `ios/scripts/phone.sh` — all plain
Bash. The `scripts/test-*.mjs` suites cover pure logic — refund linking, the
wording of a failed sync, category renaming, the version and changelog, the
analytics detail mode, payment splits, reward earnings and the best-card
rates, Venmo statement parsing, Zelle detection, subscription costs, the
shared UI-state store — on Node's built-in test runner, importing the
TypeScript directly (Node 22.18+ strips the types, and
`scripts/resolve-alias.mjs` resolves the app's `@/` imports), so they need no
build step and no dependency. Run them before sending a change.

### Pages

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

Every transaction carries a permanent number. Money that comes in but isn't
really income — a refund, or a friend paying you back — can be connected to
the purchase it covers by that number. It then takes on that purchase's
category and nets against it, instead of inflating your income and leaving the
spending overstated.

### Configuration

Settings live in **`.env.local`** (kept on your machine, never committed):

- `PLAID_CLIENT_ID` / `PLAID_SECRET` — your Plaid keys (the secret must match the
  environment below)
- `PLAID_ENV` — `sandbox` (test data) or `production` (real banks)
- `DATABASE_URL` — the local SQLite file (`dev.db`)
- `TOKEN_STORE_KEY` — encryption key for stored bank tokens

Bank access tokens are stored **encrypted** in `data/tokens.enc`, never in plaintext
or in git. See `.env.example` for optional overrides (`TOKEN_STORE_PATH`,
`VENMO_STATEMENT_DIR`).

### If you change the database schema

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
