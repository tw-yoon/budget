# Disconnecting a bank keeps its history

Web, server and iPhone. Owner's decision, 2026-10-02: "if it's recorded, it
should stay."

## Today

`DELETE /api/plaid/items/:itemId` revokes the Plaid Item, then deletes the
bank's transactions (splits cascade; links pointing at them are cleared), its
accounts, sync logs, the PlaidItem row and the stored access token. The web
and phone both call it "Disconnect".

## Decisions

| Question | Answer |
|---|---|
| What does Disconnect do? | Stops the bank for good, keeps everything recorded. Revoke the Plaid Item (best effort, as today), delete the stored access token, set `PlaidItem.disconnectedAt`. Accounts, transactions, splits, links and sync logs stay. |
| Disconnected accounts in totals | **Left out.** They stay listed, greyed and marked "Disconnected · as of <date>" (their last `balanceFetchedAt`), but count toward no total: not Net Worth, assets, liabilities, a group subtotal, or the account count used for totals. |
| A full delete | **Kept, as a separate action**, with a strong warning. It does what today's DELETE does. A connected bank offers it as "Delete…" alongside "Disconnect", and deletes in one step (disconnecting first). A disconnected bank offers "Delete History…" only. |
| Transactions | Unchanged everywhere: ledger, Venmo/Zelle, analytics, rules, links, splits all keep working on a disconnected bank's rows. Editing categories, splits and links on them still works. |

## Server

- **Schema:** `PlaidItem.disconnectedAt DateTime?` (nullable; additive
  migration, no backfill). `prisma migrate deploy` runs it when
  `Budget.command` rebuilds, after its pre-migrate DB snapshot.
- **`DELETE /api/plaid/items/:itemId`** becomes the disconnect: 404 if
  unknown; if already disconnected, 200 and no change (idempotent). Otherwise
  best-effort `itemRemove`, delete the access token (best effort), set
  `disconnectedAt = now`. Response `{ ok, institution, disconnectedAt }`.
- **New `DELETE /api/plaid/items/:itemId/history`**: the old full cleanup.
  404 if unknown. For a connected bank it first does the disconnect steps
  (best-effort `itemRemove`, delete the access token, best effort); for an
  already-disconnected bank it skips them. Then the FK-safe delete of
  transactions, accounts, sync logs and the PlaidItem, in a transaction.
  Response `{ ok, institution, removedAccounts, removedTransactions }`.
- **Every Plaid caller skips disconnected items** (`where: { disconnectedAt:
  null }`): `/api/plaid/sync`, `/api/plaid/refresh-balances` (including when
  called with a specific `item_id`: return a clear 409 instead of trying),
  `subscriptions.service`, `liabilities.service`, `create-link-token` update
  mode (409), and anything else that calls `getAccessToken`.
- **`GET /api/accounts`:** each account gains `disconnected: boolean` (and the
  existing `balanceFetchedAt` serves as "as of"). `summary` totals and
  `accountCount` exclude disconnected accounts; group subtotals likewise.
  `banks[]` gains `disconnectedAt: string | null`. `lastRefreshed` ignores
  disconnected accounts.
- `exchange-token` (connecting a bank) is unchanged. Known consequence, out of
  scope: reconnecting the same bank creates a new Item with new account and
  transaction ids, so overlapping history appears twice. A later spec can
  match and merge.

## Web

- Accounts page: disconnected accounts greyed with "Disconnected · as of
  <date>", excluded from totals and subtotals (the server does the math;
  match it client-side if the page recomputes anything).
- Wherever banks are listed with a Disconnect action (Settings /
  connections): a connected bank offers both "Disconnect" (its confirm now
  says history is kept) and "Delete…" (destructive; its confirm names the
  account and transaction counts, says it removes everything this bank
  recorded in the app, and cannot be undone). A disconnected bank shows
  "Disconnected <date>" and offers "Delete History…" only, with the same
  kind of confirm.
- The balance refresh / sync buttons ignore disconnected banks (the server
  already skips them).

## iPhone

- `AccountDTO.disconnected` (default false when absent), `BankSummary.disconnectedAt`.
- Accounts tab: disconnected rows greyed, subtitle gains "Disconnected · as of
  <date>"; `AccountTotals` excludes them from Net Worth, assets, liabilities
  and group subtotals (mirror the server). Hiding still works.
- Settings → Connections: a connected bank offers "Disconnect" (confirm now
  says history is kept) and "Delete…" (destructive, confirm naming the
  counts, says it removes everything this bank recorded and cannot be
  undone). A disconnected bank shows "Disconnected <date>" and offers
  "Delete History…" only (same kind of confirm). Both deletes call the new
  route. `ConnectionWrite` gains `.deleteHistory(itemId)`. After either write, `disconnectCount` bumps so
  Accounts/Activity/Analytics reload (already wired).
- Every request body/route has a test (CLAUDE.md rule).

## Tests

- Server: node test scripts alongside `scripts/test-*.mjs` covering disconnect
  keeps rows and sets the flag, idempotence, history delete on a disconnected bank and in one step on a
  connected bank (revoking it first), totals exclude disconnected accounts, sync and
  refresh skip them.
- iPhone: model decoding, totals exclusion, Connections writes and confirms.
