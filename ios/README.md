# Budget for iPhone

The iPhone app shows the same accounts, purchases and charts as Budget on your
Mac. It has no data of its own: each screen asks your Mac. So your Mac has to
be on, with Budget running.

It isn't in the App Store. You put it on your phone yourself with **Xcode**,
Apple's free app for building iPhone apps, using your own Apple ID.


## Contents

1. [What you need](#what-you-need)
2. [Set it up](#set-it-up)
3. [Keeping it working](#keeping-it-working)
4. [If something goes wrong](#if-something-goes-wrong)
5. [Doing it by hand](#doing-it-by-hand)

## What you need

| What | Where to get it |
| --- | --- |
| **Budget working on your Mac** | Steps 1 to 7 of the [main guide](../README.md) |
| **Tailscale** on the Mac and the iPhone, plus your `https://…ts.net` address and access token | Step 8 of the [main guide](../README.md#step-8-open-budget-on-your-phone-or-another-computer-optional) |
| **Xcode 26 or newer** (free) | [Mac App Store](https://apps.apple.com/app/xcode/id497799835) |
| An **iPhone on iOS 26** | Check in **Settings → General → About → iOS Version** |
| A **cable** that connects your iPhone to your Mac | The one you charge with usually works |
| An **Apple ID** | The one you already use on your iPhone is fine. It doesn't have to be a paid developer account. |

Commands below go in **Terminal**. If you haven't used it, see
[How to use Terminal](../README.md#how-to-use-terminal) in the main guide.

> **The 7-day catch.** With a free Apple ID, the app stops opening 7 days
> after it was put on your phone. Nothing is lost: putting it on again wakes
> it up. [Setup](#set-it-up) makes your Mac do this
> for you automatically.

---

## Set it up

Paste these two lines into Terminal, one at a time:

```bash
cd ~/Documents/budget/ios
```

```bash
bash scripts/phone.sh setup
```

It goes through seven steps. When a step is already done it shows a ✓ and
moves on. When it needs you, it says exactly what to do, then waits: do it,
come back to Terminal and press **Return**. You can stop at any time with
**Control-C** and paste the second line again later; it picks up where it
stopped.

What it will ask you to do:

1. **Xcode.** If it isn't installed, the App Store opens on it: click
   **Get**, then **Install**. It's a very big download (often an hour). Your
   Mac's password may be needed once afterwards; nothing shows while you
   type.
2. **Apple ID.** If Xcode isn't signed in, Xcode opens and setup tells you
   where to click to sign in with your Apple ID.
3. **Team ID.** Nothing to do: setup finds it. If your Apple ID has more
   than one team, it asks which one, by number.
4. **iPhone.** Plug it in with a cable and unlock it. Tap **Trust** if the
   phone asks. Then turn on **Developer Mode** (setup says where); the phone
   restarts.
5. **Putting the app on.** Takes a few minutes the first time. Nothing to do.
6. **Connecting.** The first time, the phone says the developer isn't
   trusted. Setup tells you where to tap **Trust**. Then Budget opens on the
   phone with your Mac's address and access token already filled in.
7. **Wi-Fi.** Unplug the cable, keep the phone unlocked on the same Wi-Fi as
   the Mac. Setup checks the Mac can still see it, and turns on automatic
   reinstalls.

✅ **You should see**, at the end:

```
All set. Budget is on your iPhone and opens until Saturday, October 17.
```

(Your date will be 7 days from today.)

❌ **If setup stops with** `Budget isn't running` or `Tailscale isn't …`:
do what it says (it names the step of the [main guide](../README.md)), then
paste the second line again.

## Keeping it working

Every 3 hours your Mac checks, and once the app has fewer than 5 of its 7
days left, it puts a freshly signed copy on the phone. On the phone,
**Settings → About** shows when it was installed and when it stops opening.
For this to work:

- the Mac has to be **awake and logged in**, and
- the iPhone has to be on the **same Wi-Fi** as the Mac.

If it keeps failing and the app is close to its 7 days, the Mac shows a
notification. Then paste `bash scripts/phone.sh install` (in
`~/Documents/budget/ios`).

| To… | Paste into Terminal (after `cd ~/Documents/budget/ios`) |
| --- | --- |
| Set up from the start, or check everything | `bash scripts/phone.sh setup` |
| Put the app on the phone right now | `bash scripts/phone.sh install` |
| Turn automatic reinstalls off | `bash scripts/phone.sh schedule off` |
| Turn them back on (also after moving the `budget` folder) | `bash scripts/phone.sh schedule on` |
| See what happened on each try | `open -e build/phone/log` |

- The schedule is one small file in `~/Library/LaunchAgents`, the only thing
  Budget keeps outside its folder. `schedule off` deletes it. It installs the
  code that's in your `budget` folder and never downloads anything itself.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| The app won't open at all | The 7 days ran out. Paste `cd ~/Documents/budget/ios && bash scripts/phone.sh install`, or plug in and press ▶ in Xcode. Nothing is lost. |
| "Untrusted Developer" | iPhone **Settings → General → VPN & Device Management** → your Apple ID → **Trust** (setup's step 6). |
| No Developer Mode in Settings | Plug the phone in, unlock it, open Xcode, wait a minute, look again (setup's step 4). |
| The app can't reach the server | Tailscale on in the phone's Tailscale app? Mac on with Budget running? Address starts with `https://` and ends in `.ts.net`? |
| The app asks for the access token again | Someone pressed **Reset Token** on the Mac. Copy the new one from Budget → **Settings → Remote Access**. |


## Try it on the Mac first (optional)

Xcode can show a pretend iPhone on your Mac, called the **Simulator**. It's a
quick way to look around, and it needs no Team ID, cable or Tailscale.

1. Paste into Terminal:

   ```bash
   cd ~/Documents/budget/ios && open BudgetPhone.xcodeproj
   ```

2. At the top of Xcode, click the device name next to **BudgetPhone** and
   choose any iPhone under **iOS Simulators**. Press **▶**.
3. When the app asks for the server, enter `http://localhost:3000`.

✅ **You should see** a pretend iPhone on your screen showing your accounts.

## Doing it by hand

Setup does all of this for you. These are the same steps by hand, in case
you'd rather, or setup can't finish.

### Step 1: Install Xcode

1. Open [Xcode in the Mac App Store](https://apps.apple.com/app/xcode/id497799835)
   and click **Get**, then **Install**. It's a very big download: it can take
   an hour or more.
2. When it's done, open **Xcode** (from **Finder → Applications**).
3. If it asks to install more components, make sure **iOS** is ticked, click
   **Install** or **Download & Install**, and wait.

✅ **You should see** a "Welcome to Xcode" window. You can close it.

❌ **If the App Store says** your macOS is too old for this Xcode: update
your Mac first in **System Settings → General → Software Update**.

### Step 2: Add your Apple ID to Xcode

1. With Xcode open, click **Xcode** in the menu bar at the very top of the
   screen, then **Settings…**
2. Click the **Accounts** tab.
3. Click the **+** at the bottom left, choose **Apple ID**, click
   **Continue**, and sign in.

✅ **You should see** your Apple ID in the list, and on the right a team
called **"Your Name (Personal Team)"**.

4. **Find your Team ID** (10 letters and numbers, like `A1B2C3D4E5`). Write it
   down; you need it in Step 3. It may be shown when you click your Personal
   Team. If it isn't:
   1. Click **Manage Certificates…**, then **+** at the bottom left, then
      **Apple Development**, then **Done**.
   2. Open the **Keychain Access** app (press **⌘ Space**, type `Keychain
      Access`, press **Return**).
   3. Click **My Certificates** at the top, and double-click the one named
      **Apple Development: your name**.
   4. Your Team ID is next to **Organizational Unit**.
5. **Quit Xcode (⌘ Q).** Step 3 must happen while the project is closed.

### Step 3: Tell the project who you are

This puts your Team ID in a small settings file that only you have.

1. Paste into Terminal:

   ```bash
   cd ~/Documents/budget/ios
   ```

   ❌ **If you see** `no such file or directory`: Budget isn't in your
   Documents folder. Do Step 4 of the [main guide](../README.md#step-4-download-budget) first.

2. Paste into Terminal:

   ```bash
   cp Config/Local.example.xcconfig Config/Local.xcconfig
   ```

   ✅ **You should see** nothing new except a fresh line ending in `%`.

3. Paste into Terminal to open the file in TextEdit:

   ```bash
   open -e Config/Local.xcconfig
   ```

4. In TextEdit, find the line `DEVELOPMENT_TEAM =` and type your Team ID after
   the `=`:

   ```
   DEVELOPMENT_TEAM = A1B2C3D4E5
   ```

   (Use your own Team ID.) Don't change anything else. Press **⌘ S** to save
   and close TextEdit.

> **Why this way?** If you choose your team inside Xcode instead (under
> "Signing & Capabilities"), Xcode writes your Team ID into a project file
> that's shared publicly. This way it stays in your own file.

### Step 4: Get the iPhone ready

1. Plug the iPhone into the Mac with the cable.
2. Unlock the iPhone. If it asks **"Trust This Computer?"**, tap **Trust** and
   enter your passcode.
3. Paste into Terminal to open the project in Xcode:

   ```bash
   open BudgetPhone.xcodeproj
   ```

   ✅ **You should see** Xcode open with **BudgetPhone** at the top of the
   window.

4. **Turn on Developer Mode** on the iPhone: **Settings → Privacy & Security**,
   scroll to the bottom, tap **Developer Mode**, switch it on, and tap
   **Restart**. After the phone restarts and you unlock it, tap **Turn On**
   and enter your passcode.

❌ **If there's no Developer Mode** in Privacy & Security: keep the phone
plugged in and unlocked with Xcode open for a minute, then look again.

### Step 5: Put the app on your iPhone

1. At the top of the Xcode window, next to **BudgetPhone**, click the device
   name (it may say "iPhone 17 Pro" or "Any iOS Device") and choose **your
   iPhone** from the list, under "iOS Devices".
2. Click the **▶** button at the top left (or press **⌘ R**).
3. Wait. **The first time takes a few minutes.** The bar at the top of Xcode
   shows progress.

✅ **You should see** "Build Succeeded" briefly, and the Budget icon appears on
your iPhone.

🪟 **The first time, the iPhone says "Untrusted Developer".** That's expected:
1. On the iPhone, open **Settings → General → VPN & Device Management**.
2. Under **Developer App**, tap your Apple ID, then **Trust**, then **Trust**
   again.
3. Back in Xcode, press **▶** again.

❌ **If Xcode says** "Failed Registering Bundle Identifier" or that the bundle
identifier isn't available: someone else already uses the app's name.
1. Paste `open -e Config/Local.xcconfig` into Terminal.
2. Change `BUNDLE_ID_PREFIX = local.budget` to something only you would use,
   like `BUNDLE_ID_PREFIX = local.budget.yourname`.
3. Save, and press **▶** again.

❌ **If Xcode says** "Signing for BudgetPhone requires a development team":
Xcode didn't read your Team ID. Quit Xcode, check Step 3, sub-step 4 (no typos,
saved), then open the project again.

❌ **If Xcode says** the iPhone "is busy" or "is not available": unplug and
replug the cable, unlock the phone, and wait a minute.

### Step 6: Connect the app to your Mac

1. On the iPhone, open the **Tailscale** app and make sure it's switched
   **on** (Connected).
2. Open **Budget** on the iPhone. The first time, it asks for your server.
   - **Server**: your `https://…ts.net` address from Step 8 of the main guide.
     If it ends in `:3000`, leave that part out.
   - **Access token**: in Budget on your Mac, open **Settings → Remote
     Access** and copy the token.
3. Tap to continue.

✅ **You should see** your accounts.

❌ **If it can't reach the server**: check that Tailscale is switched on in
the phone's Tailscale app, that your Mac is on with Budget running, and that
the address starts with `https://` and ends in `.ts.net`.

You can change these later in the app under **Settings → Server**.

> **Keep Tailscale on** on the phone. The app always reaches your Mac through
> Tailscale, even at home on the same Wi-Fi.

### Step 7: Keep it working past 7 days

Your Mac can put the app on your phone again by itself every few days, over
Wi-Fi, without a cable.

1. **Once, with the cable plugged in**, put the app on with ▶ in Xcode
   (Step 5). That pairs the phone. Then unplug the cable: current Xcode
   reaches a paired phone over Wi-Fi by itself.
2. **Check the Mac can do it on its own.** Unlock the iPhone and keep it on
   the same Wi-Fi as the Mac. Paste into Terminal:

   ```bash
   cd ~/Documents/budget/ios
   ```

   ```bash
   bash scripts/phone.sh install
   ```

   ✅ **You should see** `Building for the iPhone…`, then `Installing…`, and
   after a minute or two:

   ```
   Installed. The app opens until Wednesday, October 14.
   ```

   (Your date will be 7 days from today.)

   ❌ **If you see** `Install failed. Is the iPhone unlocked and on the same
   Wi-Fi as the Mac?`: unlock the phone, check it's on the same Wi-Fi as the
   Mac, and check you did sub-step 1 once with the cable. Then paste the
   `install` line again.

   ❌ **If you see** `No paired iPhone`: plug the phone in, unlock it, and press
   ▶ in Xcode once.

   ❌ **If you see** `Build failed`: paste `open -e build/phone/log` and look
   near the bottom. Usually it's the same signing problem as in Step 5; fix
   it there, then try again.

   ❌ **If you see** `More than one paired iPhone`: paste
   `open -e Config/Local.xcconfig`, type your phone's name after
   `PHONE_DEVICE =` (as shown in **Settings → General → About → Name**), save,
   and try again.

3. **Turn on the automatic schedule.** Paste into Terminal:

   ```bash
   bash scripts/phone.sh schedule on
   ```

   ✅ **You should see** `Scheduled. Every 3 hours the Mac reinstalls the app
   once fewer than 5 days of its 7 are left.`

- Without the schedule, put the app on again yourself at least once a week.

---

## For developers

### Screens

- **Accounts** — net worth, balances, due dates; refresh from Plaid; rename a
  card or set its due day and limit; hide an account from the totals (this
  iPhone only).
- **Activity** (Transactions) — the ledger with search, filters, sort and Sync; each
  row's category, link to a purchase, splits (Pro), refunds and Venmo
  breakdown; the Venmo and Zelle categorizers, with Venmo CSV import.
- **Analytics** — summary cards over 3, 6 or 12 months, spending by category,
  and monthly spending against income; in Pro mode, the cumulative Spending
  graph with an editable monthly limit. A Subscriptions card opens the list of
  recurring charges: pull down to detect from banks, + to add, swipe to delete.
- **Benefits** — Best card: for each bonus category, the card that earns most
  and the next two, with your card images.
- **Settings** — the Pro Mode switch, Categories (add, rename, merge, delete,
  Plaid labels, subcategories), Rules (add, on/off, category, delete, Apply
  Now, Use Rule for These), Connections (debit cards; connected banks, with
  disconnect — connecting stays on the Mac), and the server address.

Designs: `../docs/superpowers/specs/2026-09-26-ios-accounts-design.md`,
`../docs/superpowers/specs/2026-09-26-ios-transactions-design.md`,
`../docs/superpowers/specs/2026-09-27-ios-settings-mode-design.md`,
`../docs/superpowers/specs/2026-09-30-ios-analytics-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-subscriptions-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-benefits-best-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-settings-categories-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-settings-rules-design.md`,
`../docs/superpowers/specs/2026-10-01-ios-settings-connections-design.md`.

### Tests

⌘U in Xcode, or

```bash
xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData
```

### Signing and the public repo

If your Team ID ever ends up in the tracked
`BudgetPhone.xcodeproj/project.pbxproj` (from picking the team in Signing &
Capabilities), run `git checkout -- BudgetPhone.xcodeproj/project.pbxproj`
before committing. `scripts/test-scrub.sh` also fails if a Team ID slips into
the project file.

### Why Tailscale and https

The server listens on the Mac only, so the phone can't reach it over Wi-Fi.
iOS also blocks plain `http` to a Tailscale IP (`100.x.y.z`), so the app needs
an `https` address; `tailscale serve --bg 3000` provides one at
`https://<mac-name>.<tailnet>.ts.net` and keeps running across restarts.
