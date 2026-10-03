# Reconnecting a bank merges its history

Server and web. Follow-up to
[disconnect-keeps-history](2026-10-02-disconnect-keeps-history-design.md),
whose "known consequence" this resolves.

## Today

Disconnect keeps a bank's accounts and transactions and stamps
`PlaidItem.disconnectedAt`. Connecting the same bank again goes through
`exchange-token` as a brand-new Plaid Item: new `itemId`, new
`account_id`s, new `transaction_id`s. Plaid ids never carry over between
Items, so nothing links the two. The result:

- Each account is listed twice: the old one greyed and out of totals, the new
  one live. Balances are not double-counted (the old account is already out of
  totals), but the owner's settings on the old account (display name, manual
  due day, credit limit, debit cards, the card linked to it on Benefits,
  phone-hidden state) do not apply to the new one.
- Every transaction in the period both connections cover appears twice, once
  per Item. Spending, cash flow and category totals count it twice. The old
  copy carries the owner's category, splits, links, note and label; the new
  copy carries none of that.

## Decisions

| Question | Answer |
|---|---|
| Automatic or confirmed? | **Suggested automatically, merged only on the owner's confirm.** Money data is never merged silently. A disconnected bank whose name matches a connected bank shows "Merge into <bank>…", which opens a review; nothing changes until the owner confirms it. |
| Which accounts match? | Same **type, subtype and mask** (last 4), between the disconnected bank and the chosen connected bank. A match is suggested only when it is unique on both sides. No mask, or two candidates on either side: left unmatched, and the owner picks the partner (any not-yet-paired account of the same type) or leaves it unmerged. |
| Which account survives? | **The old one** (its row and id). It takes over the new connection: the new account's Plaid id, item, name and balances move onto it, the new account's transactions move onto it, and the new account row is deleted. Keeping the old id is what keeps everything that points at an account by id: debit cards, the Benefits card link, subscriptions, the phone's hidden-accounts list, the ledger's account filter. |
| The owner's account settings | Display name, manual due day and manual credit limit: the old account's value, else the new one's. Debit cards, Benefits cards and subscriptions pointing at the new account are repointed to the survivor. |
| Which transactions are duplicates? | Same merged account, **amount equal to the cent**, **dates within 3 days**, and **similar names** (same merchant, or at least half the words of the description shared). The new row must be posted (a pending new row is skipped until it posts, because Plaid replaces a pending id with a new one). Only Plaid rows take part; Venmo rows never do. |
| Ambiguous pairs | A pair is **confident** when each row is the other's unique best candidate (closest date, then most similar name). Confident pairs are pre-ticked in the review. Everything else (two identical coffees on the same day, say) is listed unticked; the owner can tick a pair, and the server refuses any row used twice. Pairs are never merged without a tick. |
| Which transaction survives? | **The old row** (id, label, created date), so the label written down somewhere, the refunds and Venmo/Zelle breakdowns that point at it, and its splits all stay. It takes the new row's Plaid id and Plaid fields (amount, date, name, merchant, Plaid categories, pending, logo, transfer/fee flags), so the new connection's later updates and removals land on it. The new row is deleted; its label becomes a gap, as for any deleted row. |
| The owner's transaction fields | Category: the stronger of the two by source (a manual, Venmo or link category beats a rule's, which beats none); a tie keeps the old row's. Link to a purchase, Venmo cash-out link, counterparty: the old row's, else the new one's. Note: both kept (joined on a new line) when both exist and differ. Splits: the old row's; if it has none, the new row's move over. Refunds and Venmo inflows pointing at the new row are repointed to the survivor. |
| Totals | After a merge, the survivor belongs to the connected bank, so it counts in totals with the live balance, once. Collapsed duplicates count once in analytics. Old history from before the overlap stays on the survivor, unchanged. |
| The old bank | Accounts the owner did not merge stay on it, disconnected, as today. When every account has been merged, the empty disconnected bank drops off the Connections list. |
| Late-arriving history | Plaid can deliver a new Item's older history over several syncs, after the owner has already merged. The connected bank therefore keeps a "Review duplicates…" action for each bank merged into it, running the same review on the merged accounts (old-connection rows against new-connection rows). |
| Undo | **A full database snapshot before every merge**, and a merge record. The confirm writes `prisma/backups/pre-merge-<timestamp>.db` with SQLite's `VACUUM INTO` (consistent while the server runs) and refuses to merge if that copy cannot be written. Every merge writes a `ReconnectMerge` row whose `detail` holds the before-image of everything it changed: each survivor account's prior Plaid id, item and fields; the deleted account row; the moved transaction and repointed card ids; each survivor transaction's prior Plaid id and fields; each deleted duplicate row, with its splits and the ids of the rows that linked to it. In-app undo is out of scope for v1 (see below); the snapshot is the undo. |

## Data

Additive migration, no backfill:

- `Transaction.priorItemId String?` (indexed): the `itemId` of the earlier
  connection a row was recorded by, set on the old account's Plaid rows when
  their account is merged. Cleared when the row absorbs its duplicate (it then
  tracks the new connection). This is how a merged account tells old-connection
  rows from new ones for the late "Review duplicates" pass.
- `model ReconnectMerge { id, fromItemId, intoItemId, createdAt, snapshotFile
  String?, accountIds String (JSON array of survivor account ids), duplicates
  Int, detail String (JSON before-images) }`. One row per confirmed merge.

## Server

Pure rules in `src/lib/reconnect-merge.ts` (no Prisma import, tested with
fakes); Prisma, the snapshot and the transaction in
`src/services/reconnect-merge.service.ts`.

- **`GET /api/plaid/items/:itemId/merge?into=<itemId>[&pairs=old:new,…]`**
  previews merging disconnected bank `itemId` into connected bank `into`.
  Without `pairs`, the suggested account pairs are used; with `pairs` (even
  empty), exactly those. 404 for an unknown bank; 409 when `itemId` is not
  disconnected, `into` is disconnected, or they are the same; 400 for invalid
  pairs. Response: both banks, the old and new accounts (with transaction
  counts), the pairs, the accounts already merged earlier, and the duplicate
  candidates (`{ old, new, confident }`, each row with id, label, date, name,
  amount, pending and whether the owner has edited it).
- **`POST /api/plaid/items/:itemId/merge`** with
  `{ into, accounts: [{ from, to }], duplicates: [{ keep, drop }] }`. The
  server recomputes the candidates for those pairs and refuses (400) any pair
  that is not a candidate, any row used twice, and an empty request. Then the
  snapshot (500 and no change if it fails), then one database transaction:
  1. per account pair: mark the old account's Plaid rows `priorItemId`, move
     the new account's transactions, debit cards, Benefits cards and
     subscriptions to the survivor, delete the new account, give the survivor
     the new account's Plaid id, item and Plaid fields plus the merged
     settings;
  2. per duplicate pair: repoint refunds and Venmo inflows, move splits if the
     survivor has none, delete the new row, give the survivor its Plaid id and
     fields and the merged owner fields;
  3. write the `ReconnectMerge` record.

  Response `{ ok, mergedAccounts, mergedDuplicates, snapshot }`.
- **`GET /api/accounts`**: `banks[]` gains `mergeInto: [{ itemId,
  institution }]` (on a disconnected bank with accounts left: the connected
  banks of the same name, compared case-insensitively) and `mergedFrom:
  [{ itemId, institution, mergedAt }]` (on a connected bank: the banks merged
  into it). A disconnected bank with no accounts left and a merge record is
  left out of `banks[]`. Nothing else in the response changes.
- `exchange-token` and sync are unchanged: merging is a separate, confirmed
  step, never part of connecting.

## Web

Settings → Connections (`ConnectedBanks`):

- A disconnected bank with `mergeInto` shows "Merge into <bank>…" (one per
  candidate bank; the id suffix tells two same-named banks apart).
- A connected bank with `mergedFrom` shows "Review duplicates…".
- Both open the merge review under the bank list:
  - **Accounts**: each old account with a picker of the new bank's accounts of
    the same type ("Don't merge" first), pre-set to the suggestion. Accounts
    merged earlier are listed as merged. Changing a picker reloads the
    duplicates.
  - **Duplicates**: date, name and amount of each pair (old above new, with the
    old row's label), confident pairs ticked, the rest unticked under "Not
    sure — tick only if they are the same". Ticking a pair disables the other
    pairs that share one of its rows. A row the owner has edited is marked;
    its edits are kept.
  - **Merge**: its confirm names the counts and says a copy of the database
    is saved first. On success the panel says where the copy went, the bank
    list reloads and the review reloads with whatever is left.

## iPhone

Out of scope. The merge is a rare, review-heavy step done on the web. The
phone needs no change to stay correct: it decodes `banks[]` without the new
keys, a fully merged bank drops out of its list because the server leaves it
out, and phone-hidden accounts stay hidden because the survivor keeps the old
account id.

## Out of scope (v1)

- **In-app undo.** Restoring is: quit Budget, copy the `pre-merge-…` snapshot
  over `prisma/dev.db`, relaunch. That also discards anything after the merge.
  The `ReconnectMerge.detail` before-images are enough for a later in-app undo.
- Pre-merge snapshots are not rotated by `Budget.command`; they stay until the
  owner deletes them.
- Merging across differently named banks (a renamed institution). The routes
  accept any disconnected → connected pair, but the web only offers same-name
  banks.
- An old pending row whose amount changed when it posted (a tip added) is not
  a candidate (the amounts differ). It stays as a separate row.
- Duplicate auto-detected subscriptions: Plaid gives the new Item new
  recurring stream ids, so the Subscriptions page can list a stream twice.
- When both rows of a pair have splits, the old row's are kept and the new
  row's are recorded in the merge record only.
- An account the owner hid on the phone that was the *new* account (not the
  old) is unhidden after the merge, because that row is the one deleted.

## Tests

`scripts/test-reconnect-merge.mjs` (fakes, no database):

- account suggestions: unique type/subtype/mask match; missing mask and
  ambiguity left unmatched; owner pairs validated (type, one-to-one, already
  merged);
- duplicates: exact amount, ±3 days, name similarity, new pending skipped,
  Venmo skipped; confident vs ambiguous (identical twins stay unticked;
  nearest date wins); a confirm refuses non-candidates and reused rows;
- carry-over: category strength, notes joined, links and splits;
- preview/confirm statuses (404, 409, 400), snapshot failure leaves the data
  untouched, the plan handed to the store, late duplicate review on an already
  merged account;
- `mergeInto` / `mergedFrom` for `banks[]`.

The Prisma side is checked once by hand against a scratch database.
