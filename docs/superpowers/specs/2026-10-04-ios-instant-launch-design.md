# iPhone app opens instantly — design

Backlog item 1 (2026-10-04). Today the phone keeps nothing from the server
except card faces (`Benefits/CardArtCache.swift`), so every launch shows a
spinner on every tab until the Mac answers.

## What changes

The phone saves the last successful answer for each main screen's first
load and shows it at once the next time, then refreshes in the background.

Saved answers:

| Screen | Request | Saved when |
|---|---|---|
| Accounts | `GET api/accounts` | always |
| Ledger | `GET api/transactions`, page 1 | page 1 and an empty search (filters are part of the match) |
| Analytics | `GET api/analytics?months=` | only for the launch range (3 months); other ranges are never saved |
| Analytics | `GET api/analytics/cashflow`, `GET api/analytics/spending` | always |
| Analytics → Subscriptions | `GET api/subscriptions` | always |
| Benefits | `GET api/user-cards` | always |
| Normal / Pro | `GET api/ui-state?key=pro-mode` and the legacy key | the resolved mode, saved under `pro-mode` after a current load or an accepted choice (the GETs themselves save nothing) |

Venmo / Zelle, Settings lists, link candidates and the spending limit are
not saved: they are second-level screens and load quickly enough.

## How

- `ResponseCache` (`Networking/ResponseCache.swift`) keeps the raw bytes the
  server sent, after they decoded. It never re-encodes models, so models stay
  `Decodable` only.
- One entry per name (`accounts`, `ledger`, …). The file name carries a hash
  of the exact request (path + query), and a read only matches the same
  request, so a saved ledger page for other filters is never shown.
- Entries live in a folder named by a hash of the server address plus access
  token. Reads never cross folders; any read or write removes other
  folders. Saving a different address or token in Settings → Server also
  clears everything. So a changed server or token never shows the old one's
  data.
- Files are written with `.completeFileProtection` (unreadable while the
  phone is locked) under Caches, which is not backed up.
- `APIClient` gets `var cache: ResponseCache?` (nil by default, so every
  existing test is unaffected). `APIClient.saved()` uses the shared cache.

## Store rules

- At the start of a load, a store with nothing showing reads its saved
  answer synchronously and shows it before the network call.
- Saved data counts as "data showing" (ios/CLAUDE.md store rules): a failed
  refresh becomes a banner, not a full-screen error; a successful one
  replaces the data and clears the banner. `.cancelled` stays silent.
- A store that has data already never reads the cache again.

## Decisions to review

- **No "last updated" label.** Saved data looks the same as fresh data while
  the refresh runs (usually a second or two). If the refresh fails, the
  banner says so. A small "Updated 3 min ago" line could be added later.
- **Pull-to-refresh is unchanged.** It still calls Plaid on Accounts and the
  Ledger.
- **What isn't saved** (table above) could be added the same way.
