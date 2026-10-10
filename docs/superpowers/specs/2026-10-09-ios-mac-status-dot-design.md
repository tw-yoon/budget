# Mac connection dot on Accounts — design

Owner request (2026-10-09): know at a glance whether the phone and the Mac
are in sync, as a green circle on the Accounts screen. Builds on
`2026-10-04-ios-cant-reach-mac-design.md` (the failure kinds) and
`2026-10-04-ios-instant-launch-design.md` (saved data shown at launch).

## What it shows

A small filled circle in the Accounts navigation bar (trailing). Tapping it
opens a card at the top right, over the dot: the same coloured dot on the
left, the line on one line, a short grey line under it, and, when the Mac
can't be reached, a "Check that" section (Tailscale is on / Your Mac is
awake / Budget is running on it) with numbered icons in the dot's column,
so every line's text starts at the same place. One width for every state
(scaled with the text size). A tap anywhere closes it. Its top-right
corner sits on the dot's glass circle, measured from the dot's frame on
screen: fixed spacing (0.12.0) matched the simulator but sat a little low
and left on a real phone.

Accounts draws the card itself. Tried first and dropped:
- a popover: on a real phone it landed below and left of the dot, and its
  width (so its text's left edge) changed with each state;
- a menu: fixed width, so "Connected to Your Mac" wrapped once the dot sat
  beside it; it also drops colour from icons and inline images, and shows
  only two lines under a title.

| State | Colour | Line | Under it |
|---|---|---|---|
| Checking (no answer yet this launch) | grey | Checking Your Mac… | Last updated …, if any data |
| Connected | green | Connected to Your Mac | Updated just now / 2 minutes ago |
| Can't reach | red | Can't Reach Your Mac | Last updated … (then the Check that section) |
| Token refused (401) | orange | Access Token Not Accepted | Re-enter it in Settings → Server. |
| No server | red | No Server Set | Add your Mac in Settings → Server. |

"Synced" = connected plus how old the Accounts data on screen is: the time
of the last successful Accounts load, or, for data saved by an earlier
launch, when it was saved (the saved file's date).

With Differentiate Without Color on, the circle becomes a symbol
(checkmark / xmark / exclamation / ellipsis in a circle). VoiceOver reads
"Mac connection" with the line and the detail as its value.

## How it decides

`MacLinkStore` (`Shared/`) sends `GET api/update/phone`, which only reads a
few small files on the Mac (no database, no Plaid), with a 10 s timeout and
without recording a load time. It runs when Accounts appears, whenever the
app becomes active, every 30 s while Accounts is on screen and the app is
active, and on a server change (which resets it to Checking first).

Result mapping reuses `APIError`:

- any HTTP answer other than 401 and 502–504 → Connected (the Mac answered;
  a 500 from that route still means it is reachable),
- `isUnreachable` → Can't reach, `.unauthorized` → Token refused,
  `.notConfigured` → No server, `.cancelled` → no change.

A check in flight never changes the dot (no flicker back to grey);
overlapping checks are guarded by a generation counter.

## Decisions taken without the owner

- Toolbar dot + popover rather than a list row: it stays out of the way of
  the balances and is always visible at the top.
- A separate lightweight ping instead of reloading accounts every 30 s.
- Orange (not red) for a refused token: the Mac answered, the fix is on the phone.
