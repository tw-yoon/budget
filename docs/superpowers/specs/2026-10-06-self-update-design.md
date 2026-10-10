# Updates From the App, Auto-Start at Login — Design

**Status:** Approved in chat, 2026-10-06. Branch `self-update`, cut from `main`.

**Goal:** Friends run Budget on their own Mac and mostly use the iPhone app.
Today an update means opening Terminal and running `./Budget.command --update`,
and Budget only runs after someone double-clicks it. Make updating a button
(web and iPhone), make starting at login an official, optional feature, make
the launcher say which step it is on, and let the phone say how current it and
the Mac are.

Backlog items 10–13 (2026-10-04).

---

## Decisions already made

| Question | Decision |
|---|---|
| Where the Install button lives | Web Settings → Updates and iPhone Settings → About. |
| Phone after a Mac update | Left to `phone.sh schedule` (if on). The phone says the Mac is newer until then. |
| Auto-start in the friend installer | `install.sh` asks `[Y/n]`; also `./Budget.command --login on/off` any time. |
| Who can update from the app | Only a clone `--update` already accepts (whole clone, main checkout, has `origin`). The maintainer's monorepo subfolder never shows the button. |
| A build that fails after the update stopped the server | Same as `--update` in Terminal today: the server stays down and the phone shows its can't-reach screen. Not fixed here. |

---

## 10. Launcher: steps and a lock (`Budget.command`)

**Steps.** A launch that does work prints numbered steps, only those that run:

```
Fetching the latest version…                              (--update only, unnumbered, as today)
Step 1 of 3: Installing dependencies…
Step 2 of 3: Code changed since the last build — building (~30–60s)…
Step 3 of 3: Starting Budget…
```

The total is counted after any pull (what a pull brings decides whether a
build is needed) from the same checks the steps use (`needs_install`,
`needs_build`, `server_running`). A launch with nothing to do prints no steps
(today's "already running and up to date").

Doc-only changes already skip the build (`needs_build` watches only app
inputs). A test pins that: touching `README.md` after a build does not make
`needs_build` true.

**Lock.** Auto-start (13) restarts Budget by running `Budget.command
--no-open` whenever the server stops — which an update does on purpose. Without
a lock that second run starts its own build in the middle of the update's. So
every run that can build, migrate or start (everything except `--check-only`,
`--update-status` and `--login`) first takes `.budget.lock` (a directory
holding the owner's pid):

- Held by a live process: print `Another Budget launch or update is running —
  waiting…`, poll every second up to 15 minutes, then exit 1 with a message
  that names the `.budget.lock` folder to delete if nothing else is running.
- Stale: take it over. Stale is a pid that no longer answers, a pid whose
  process isn't a `Budget.command` (pids are reused after a restart or power
  cut), or a pid file still empty after 10 seconds (a launch that died between
  creating the lock and writing its pid).
- Released on exit (`trap`), including failures.

`.budget.lock` is gitignored.

## 11. Install button

### Launcher: `--update-status`

Read-only. Fetches like `check_updates` (same 10s cap, same no-prompt git
settings), then prints one JSON line and exits 0:

```json
{"version":"0.11.0","latest":"0.12.0","behind":4,"blocker":""}
```

- `latest`: `version` of `origin/<branch>:package.json`, or `null` when it
  can't be read (offline, no upstream).
- `behind`: commits in `HEAD..origin/<branch>`; 0 when unknown.
- `blocker`: `update_blocker`'s answer (`""`, `subfolder`, `worktree`,
  `no-origin`, `not-a-clone`). With a blocker, no fetch is made, `latest` is
  `null` and `behind` is 0.

It never builds, migrates, starts, or takes the lock.

### Server: `/api/update`

`src/lib/updater.ts` holds the logic with its process calls injected, so it is
tested without git or a real launcher. The route is thin.

**GET** → `UpdateStatusDTO`:

```ts
{
  version: string;          // this server's package.json version
  latest: string | null;
  available: boolean;       // behind > 0
  canUpdate: boolean;       // blocker === ""
  updating: boolean;        // an update started by POST is still running
  failed: string | null;    // last lines of .update.log when the last
                            // app-started update exited non-zero
  checkedAt: string;        // ISO time of the --update-status run used
}
```

The `--update-status` result is cached in memory for an hour; `?check=1`
forces a new run. `updating` and `failed` are read fresh from disk every time.
While `updating` is true and a cached result exists, the cache is served even
for `?check=1`: `--update-status`'s `git fetch` would race the update's
`git pull` for the same refs. (POST checks status first, so the server that
started an update always has one.)
Wrapped in `withServerTiming` like the other screen routes.

**POST** (body `{}`) → `202 { ok: true }`, or `409 { error }` when
`canUpdate` is false, nothing is available, or an update is already running.
It starts, detached (`spawn(..., { detached: true, stdio: "ignore" })`,
`unref()`, so it is its own process group and outlives the server being
stopped, including under launchd):

```
bash -c './Budget.command --update --no-open > .update.log 2>&1; echo $? > .update-exit'
```

after writing `.update-started` (the time). The child gets the server's
environment minus `NODE_ENV`, `PORT`, `NEXT_*`, `__NEXT_*` and `npm_*`
(`updateEnv`): under `next start`'s `NODE_ENV=production`, `npm install` would
drop the build tools, and `__NEXT_PROCESSED_ENV` would make the new build skip
`.env`. `Budget.command` also unsets `NODE_ENV` and `__NEXT_PROCESSED_ENV`
itself. State on disk, all gitignored:

| File | Meaning |
|---|---|
| `.update-started` | An app-started update began at this time. |
| `.update-exit` | It finished, with this exit code. |
| `.update.log` | Its output. |

`updating` = `.update-started` exists and `.update-exit` is missing or older,
and the start is under 15 minutes old. `failed` = `.update-exit` is newer than
`.update-started` and non-zero: the last 5 non-empty lines of `.update.log`.
A successful update leaves `failed` null. Any `--update` that ends with the
server ready (from the app or from Terminal) deletes `.update-started` and
`.update-exit`, so an earlier failure doesn't stay on screen after a later run
fixed it; the app's wrapper then writes `.update-exit` (0), which with no
`.update-started` reads as neither updating nor failed. The cross-site write guard and the
access token already cover POST (`src/proxy.ts`).

### Web: Settings → Updates

A new page `src/app/settings/updates/page.tsx`, linked in SideNav after Mode.

- `canUpdate` false: "Budget v0.11.0." and "This copy is updated from its
  repository, not from here." No button.
- Nothing available: "Budget v0.11.0 is up to date." and a "Check Now" button
  (`?check=1`). With `failed` set, the failure and Check Now (no "up to date").
- Available: "v0.12.0 is available (you have v0.11.0)." and **Install**, which
  asks to confirm ("Budget will stop for about a minute while it updates.").
- After Install: "Updating… Budget will be back in about a minute." It polls
  GET every 3s, ignoring failed requests while the server is down, until an
  answer has `updating` false and no `failed` (done: reloads the page; a
  release may ship without a version bump, so the version isn't compared;
  POST wrote the state files before answering, so every poll before the end
  sees `updating`) or `failed` is set (shows it) or 10 minutes pass ("Still
  not back. Check the Mac.").
- `failed` set on load: shows it, with the Terminal command as the fallback.
- `updating` set on load (an update started elsewhere): shows "Updating…" and
  polls the same way instead of offering Install.

## 12. iPhone: Settings → About

**Mac row** (from GET `/api/update`, loaded with Settings):

- Available and `canUpdate`: "Mac" · "v0.12.0 available", and an **Install**
  button with the same confirmation as the web. Then "Updating your Mac…" with
  a spinner, polling every 3s exactly as the web does; on success "Mac updated
  to v0.12.0". A load that finds `updating` set does the same, without Install.
- Up to date: "Mac" · "v0.11.0".
- Load failure: the row is hidden (Settings already has the server form for
  connection problems).

**Version mismatch.** When the Mac's `version` is newer than the app's
(numeric compare per part), a footer under About: "Your Mac has v0.12.0. This
app updates the next time it's reinstalled from the Mac."

**Installed / Stops Opening.** Read from the app's own
`embedded.mobileprovision` (the plist inside its signature): `CreationDate`
and `ExpirationDate`, shown as "Installed" · "Oct 4" and "Stops Opening" ·
"Oct 11". Hidden when the file is absent (the simulator).

Native rows (`LabeledContent`), no explanatory blurbs beyond the footer.
`APIClient+Settings.swift` gets `updateStatus(check:)` and `startUpdate()`;
the POST body is `{}` with a test asserting it.

## 13. Auto-start at login

`./Budget.command --login on` writes `~/Library/LaunchAgents/local.budget.server.plist`
and loads it with `launchctl bootstrap gui/<uid>`; `--login off` boots it out
and deletes it. Both say what they did. Same pattern as `phone.sh schedule`.
`LAUNCHCTL` and `LAUNCH_AGENTS_DIR` can be overridden, for tests.

The agent (same behaviour as the hand-made one on the maintainer's Mac, which
`--login on` replaces):

- `caffeinate -i` (the Mac doesn't idle-sleep while Budget runs, so the phone
  can reach it; the display still sleeps),
- `bash -c 'cd "$0" && ./Budget.command --no-open || exit 0; while <port listening>; do sleep 30; done; exit 1' <folder>`
  — the folder is passed as an argument, so no quoting inside the command,
  and is XML-escaped in the plist,
- `RunAtLoad`, `KeepAlive` `{ SuccessfulExit: false }`, `ThrottleInterval` 30,
  log to `.launchd.log`. A server that ran and stopped ends the job with 1 and
  launchd starts it again; a launch that failed (a broken build) ends it with
  0, so it isn't retried every 30 seconds forever; the next login or a manual
  launch tries again.
- If `launchctl bootstrap` fails, the plist is removed again, so the
  installer asks next time.

`scripts/install.sh` asks "Start Budget automatically when you log in? [Y/n]"
just before the first start (read from `BUDGET_TTY` like its other questions;
Return means yes, no answer at all means no; not asked when the agent already
exists). Yes runs `--login on` once Budget has started. The README's setup and update sections
mention `--login on/off` and the Install button.

---

## Testing

- `scripts/test-launcher.sh`: steps printed for an update and a plain build;
  none when up to date; README-only change doesn't rebuild; lock waits for a
  live holder and takes over a dead one, a reused pid and an old empty pid
  file; an `--update` run with the server's environment never shows the build
  `NODE_ENV` and clears the state files; `--update-status` JSON for an
  up-to-date clone, one behind, and a subfolder; `--login on/off` writes and
  removes the plist with a fake `launchctl`, and the folder survives a space
  in its path; the agent's command exits 0 for a failed launch and 1 once the
  server stops; a refused bootstrap leaves no plist.
- `scripts/test-updater.mjs`: status parsing and caching, `?check=1`,
  `updating`/`failed` from the state files, POST refusals (409), the spawned
  command and its environment, no launcher run while updating, and
  `pollOutcome`.
- `scripts/test-install.sh`: the login question, yes and no.
- iOS: `UpdateStatusDTO` decoding, the POST body, version compare, the
  provisioning-profile parser (a fixture with invented dates), and the store's
  install-then-poll flow, and following an update found running on load,
  against `StubURLProtocol`.
- Never against the live server except GETs.
