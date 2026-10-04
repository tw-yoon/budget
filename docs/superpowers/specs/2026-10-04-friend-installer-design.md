# One-paste installer for friends — design

Backlog item 9 (2026-10-04). Today a friend follows README Steps 1–6 by
hand: install Node.js, get the Command Line Tools through `git --version`,
get Plaid keys, `git clone`, run `./Budget.command`, and paste the keys into
`.env.local` in TextEdit.

## What changes

`scripts/install.sh` does Steps 1, 2, 4, 5 and 6 in one paste:

```bash
curl -fsSL https://raw.githubusercontent.com/tw-yoon/budget/main/scripts/install.sh | bash
```

Getting the Plaid keys (Step 3) still happens in the browser; the installer
asks for them.

## Steps the script takes

Each step checks first and does nothing if it's already done, so running it
twice is safe.

1. **Mac check.** Stops with a plain message on anything but macOS.
2. **Command Line Tools** (they bring Git). If `xcode-select -p` fails, runs
   `xcode-select --install`, tells the person to click **Install** in the
   window that appears, and waits (checking every few seconds, up to 30
   minutes) until the tools are there.
3. **Node.js 20 or newer.** If `node` is missing or older, downloads the
   official Node.js 24 LTS installer (`node-v24.*.pkg` from
   `https://nodejs.org/dist/latest-v24.x/`), checks it against that folder's
   `SHASUMS256.txt`, and installs it with `sudo installer` (the Mac asks for
   its password). If any of that fails, it says exactly what to download
   from nodejs.org and to paste the line again.
4. **Download Budget** into `~/Documents/budget`. If that folder is already a
   Budget clone, it is kept (Budget.command `--update` brings it up to date
   in step 6). A folder by that name that isn't a Budget clone stops the
   script without touching it.
5. **Plaid keys.** Lets `./Budget.command --check-only` create `.env.local`
   (and its encryption key) the way it always does, then asks for the
   client_id and the Sandbox secret (hidden while typing) and writes them
   into `.env.local`. Keys already there are kept.
6. **Start Budget**: `./Budget.command` (`./Budget.command --update` for an
   existing clone).

Questions are read from the keyboard (`/dev/tty`), so they work when the
script arrives through `curl | bash`. The whole script is one function called
on the last line, so a download cut short runs nothing.

## Testing

`scripts/test-install.sh`, in `npm test`, runs the installer against
throwaway clones (a local bare repo seeded from tracked files, like
`test-launcher.sh`) with a fake `HOME` and stub `xcode-select`, `node`,
`curl`, `sudo`, `installer` and `open` on `PATH`. Nothing is installed on the
Mac running the tests. Test-only settings (`BUDGET_REPO`, `BUDGET_DIR`,
`BUDGET_TTY`, a shorter wait, and skipping the final launch) are environment
variables.

## README

Before Step 1, a new "Quick install (one paste)" section with the curl line,
what it asks, ✅ / ❌ lines, and "then go to Step 7". Steps 1–6 stay as the
step-by-step fallback.

## Decisions to review

- **Node.js 24 LTS** is what gets installed (Budget needs 20 or newer).
- The installer uses `sudo installer` for Node.js, which asks for the Mac
  password in Terminal rather than opening the graphical installer.
- An existing clone is updated with `Budget.command --update` (git pull plus
  migrations), the same as the README's update steps.
- The curl line pulls from `main` on GitHub, so it only works after this is
  pushed and published.
