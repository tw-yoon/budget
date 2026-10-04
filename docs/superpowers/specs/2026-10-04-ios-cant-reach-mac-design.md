# Friendly "can't reach your Mac" screen — design

Backlog item 6 (2026-10-04). Builds on the saved data from
`2026-10-04-ios-instant-launch-design.md`.

## Problem

When the phone can't reach Budget, every screen shows the generic
`ErrorView` with iOS's own wording ("The request timed out.", "A server
with the specified hostname could not be found."), and banners repeat that
wording. A non-technical friend can't tell what to do.

## Kinds of failure

`APIError` already separates the cases. The phone groups them for people:

| Kind | From | What the person should do |
|---|---|---|
| Can't reach your Mac | `.unreachable` (no answer, timeout, DNS, Tailscale off) and `.server` with status 502, 503 or 504 | Check Tailscale, the Mac, Budget |
| Access token | `.unauthorized` (401) | Re-enter the token in Settings → Server |
| Something went wrong | other `.server`, `.decoding` | Retry; the message says what failed |
| No server | `.notConfigured` | (first-launch setup already covers this) |

Budget itself never answers 502–504. Those come from Tailscale's proxy on
the Mac when Budget isn't running, so they count as "can't reach".

## Full-screen (nothing showing)

`ErrorView` moves to `Shared/ErrorView.swift` and draws a `ConnectionProblem`
(a small value with title, symbol, message and steps, unit-tested):

- **Can't Reach Your Mac** (`wifi.exclamationmark`): "Budget on this iPhone
  can't connect to your Mac. Check these, then tap Retry:"
  1. Tailscale is on — open the Tailscale app on this iPhone and turn it on.
  2. Your Mac is on and awake.
  3. Budget is running on your Mac.
  Then the server address in small grey text, and **Retry**.
- **Access Token Needed** (`key`): "Your Mac didn't accept this iPhone's
  access token. Go to Settings → Server and paste the current token. You'll
  find it on the Mac in Budget's Settings → Remote Access." **Retry**.
- **Something Went Wrong** (`exclamationmark.triangle`): the error's message,
  **Retry**.

Every screen that already uses `ErrorView` gets this.

## Banners (data showing)

A failed load over data that is showing (saved data from last launch, or
data loaded earlier) uses `APIError.loadBanner`:

- can't reach: "Showing saved data — can't reach your Mac."
- access token: "Showing saved data — access token not accepted. Re-enter it
  in Settings → Server."
- anything else: the error's message, as today.

Action failures (refresh balances, Sync, saves) keep their own wording, but
`APIError.message` for `.unreachable` becomes plain language too: "Can't
reach your Mac. Check that Tailscale is on and the Mac is awake with Budget
running." The system's own text is kept as `detail` for the full screen's
small print.

## Decisions to review

- 502/503/504 are treated as "Budget isn't running", not as a server error.
- The token screen explains where to go rather than jumping to Settings
  (a jump would need cross-tab navigation; easy to add later).
- The Settings → Server "Save and Test Connection" result also shows the new
  plain wording.
- The banner says "Showing saved data" whether the data on screen came from
  the last launch or from earlier in this one. Both are what the phone last
  got from the Mac, so stores don't track which.
