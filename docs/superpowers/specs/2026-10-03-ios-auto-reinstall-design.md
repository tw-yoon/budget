# iPhone App — Automatic Reinstall Design

**Status:** Draft for review, 2026-10-03. Branch `ios-auto-reinstall`, cut from `main`.

**Goal:** A free Apple ID signs the iPhone app for 7 days; after that it stops
opening until it is installed again from the Mac. Make the Mac do that on its
own, over home Wi-Fi, so nobody has to plug in the phone and press Run each
week. The iPhone app is the main way to use Budget; the web app on each
person's Mac is its server and backup. Friends clone the repo and set up their
own Mac and phone.

---

## Decisions already made

| Question | Decision |
|---|---|
| Who runs it | Each person, on their own Mac, for their own phone. Nothing shared. |
| Paid developer account | Not required. Anyone who has one can skip this. |
| How the phone is reached | Directly over the home Wi-Fi network (Xcode's wireless pairing), or a cable. Not Tailscale. |
| Tailscale | Stays, unchanged, for the app reaching the server from anywhere. Out of scope here. |
| Schedule | A macOS LaunchAgent. It is the one file outside the app folder (`~/Library/LaunchAgents`), created and removed only by this script. |
| Alerts | A macOS notification only when the app is close to expiring and the last try failed. |
| Code it builds | Whatever is checked out on the Mac. No `git pull`. |

---

## The script: `ios/scripts/phone.sh`

Three subcommands, run from anywhere:

| Command | Does |
|---|---|
| `phone.sh install` | Builds and installs the app on the phone now. |
| `phone.sh schedule on` | Writes and loads the LaunchAgent. |
| `phone.sh schedule off` | Unloads and deletes the LaunchAgent. |

The LaunchAgent runs `phone.sh auto`, which is `install` behind a freshness
check (below). `auto` is not documented for people to run.

### Picking the phone

`Config/Local.xcconfig` (gitignored) gains an optional line:

```
// Name or identifier of the iPhone to install on. Leave empty to use the only paired iPhone.
PHONE_DEVICE =
```

Also added to `Local.example.xcconfig`. When empty, the script uses the one
paired iPhone. None or more than one: it stops with a message naming the
setting.

The phone has two identifiers, and each tool needs a different one:

| Identifier | Where it comes from | Used by |
|---|---|---|
| CoreDevice identifier | `identifier` | `devicectl … --device` |
| Hardware UDID | `hardwareProperties.udid` | `xcodebuild -destination id=` |

The script reads both from `xcrun devicectl list devices --json-output <file>`,
parsed with `osascript -l JavaScript` (ships with macOS; no `jq` or Node, which
launchd's minimal `PATH` may not find). `PHONE_DEVICE` matches a device's name,
CoreDevice identifier or UDID, and the script takes both identifiers from that
device's entry.

### `install`

1. `xcodebuild build -project BudgetPhone.xcodeproj -scheme BudgetPhone
   -configuration Debug -destination id=<udid> -derivedDataPath
   build/DerivedData-phone -allowProvisioningUpdates -quiet`. The flag lets
   Xcode renew the free profile from the command line, using the Apple ID
   already added in Xcode → Settings → Accounts.
2. `xcrun devicectl device install app --device <coredevice-id> <built .app>`. The
   bundle ID is unchanged, so the app keeps its data (server address, token).
3. On success, write the current time to `build/phone/last-success`.

Output of every run is appended to `build/phone/log`. A failed build leaves
the installed app alone and exits non-zero.

### `auto` (what the schedule runs)

1. If `last-success` is under 2 days old, exit quietly.
2. Otherwise run `install`.
3. If it failed and `last-success` is 5 or more days old (or missing), post a
   notification: **Budget: couldn't update the iPhone app** / "Unlock your
   iPhone on home Wi-Fi with the Mac awake. It stops opening in about N days."
   (N from 7 days after `last-success`; "soon" when missing.)

### The schedule

`schedule on` writes `~/Library/LaunchAgents/<BUNDLE_ID_PREFIX>.phone-reinstall.plist`
(`BUNDLE_ID_PREFIX` from `Local.xcconfig`, default `local.budget`):

- `ProgramArguments`: `/bin/bash`, the absolute path of `phone.sh`, `auto`.
- `StartInterval`: 10800 (every 3 hours). Runs missed while the Mac sleeps
  happen once on wake.
- `RunAtLoad`: true.
- Standard output and error to `build/phone/log`.

then `launchctl bootstrap gui/$(id -u) <plist>`. `schedule off` runs
`launchctl bootout` and deletes the file. Both are safe to repeat. The plist
holds a local path, so it is generated, never committed.

Every 3 hours with a 2-day skip means a real reinstall about every 2 days,
retried through the day if the phone is away or locked, with roughly 5 days of
buffer before expiry.

---

## Failure cases

| Case | Result |
|---|---|
| Phone away from home Wi-Fi | Install fails; retried in 3 hours. |
| Phone locked (if `devicectl` refuses) | Same. Confirm on the first real run whether install works while locked. |
| Mac asleep or logged out | Nothing runs; catches up on wake. Logged out means no access to signing keys, so the run fails and retries. |
| Apple ID session expired in Xcode | Build fails; the alert tells the person in time to open Xcode. |
| Repo moved | The plist points at the old path; run `schedule on` again. Noted in the README. |

---

## Testing

`scripts/test-phone-reinstall.sh`, matching `scripts/test-launcher.sh`. The
script reads `XCODEBUILD`, `DEVICECTL`, `OSASCRIPT`, `LAUNCHCTL`,
`LAUNCH_AGENTS_DIR` and `PHONE_STATE_DIR` from the environment (defaults: the
real tools and paths), so the test passes stubs that record their arguments
and succeed or fail on demand. Cases:

- `install` success writes `last-success`; build failure does not install.
- Device choice: setting wins; one paired iPhone used; zero or two stop with the message.
- Identifiers: the stub device list gives different CoreDevice and UDID values; `xcodebuild` gets the UDID, `devicectl install` gets the CoreDevice identifier.
- `auto` skips under 2 days; runs at 2+.
- Alert: failure at 5+ days or missing notifies; failure under 5 days does not; success never does.
- `schedule on` writes a plist with the right path and interval and bootstraps it; `schedule off` removes it; both repeatable.

No phone in the test. The first real install and schedule are checked by the
owner. `bash scripts/test-scrub.sh` must pass: no device names, identifiers or
home paths in committed files.

---

## Docs

`ios/README.md`, "Run on your iPhone": replace the "Every 7 days" paragraph
with:

1. In Xcode → Window → Devices and Simulators, select the phone and tick
   **Connect via network** (once, with the cable).
2. `bash scripts/phone.sh install` to check it works without Xcode open.
3. `bash scripts/phone.sh schedule on`.

Plus what the alert means, `schedule off`, and re-running `schedule on` after
moving the folder.

## Out of scope

Tailscale changes, offline data on the phone, pulling new code from GitHub,
anything for paid developer accounts.

---

## Amendment, 2026-10-07: renew the signature, go by its expiry

Reinstalling did not renew anything. Xcode keeps the free profile it made
(`~/Library/Developer/Xcode/UserData/Provisioning Profiles`) and signs every
build with it until it runs out, so the app stopped opening 7 days after the
*first* install however often it was reinstalled. Now:

- `install` first moves this app's saved profiles (matched by
  `Entitlements.application-identifier` ending in the bundle ID) into
  `build/phone/old-profiles`, so `-allowProvisioningUpdates` makes a fresh
  7-day one. A failed build moves them back; a good install deletes them.
- After installing it reads `ExpirationDate` from the installed app's
  `embedded.mobileprovision`, writes it to `build/phone/expires`, and says
  "The app opens until <day>". If the signature is over a day old it says
  Xcode reused an old one.
- `auto` goes by `expires`: it reinstalls once 5 days or fewer are left (no
  recorded expiry reinstalls at once), and notifies on failure with 2 days or
  fewer left. `last-success` is still written but no longer decides anything.
