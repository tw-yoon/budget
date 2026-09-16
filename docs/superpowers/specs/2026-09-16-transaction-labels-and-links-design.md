# Transaction labels and refund links

Three changes to the ledger, designed together because the second and third
depend on the first:

1. Every transaction gets a permanent display number, shown left of the date.
2. An inflow that is really a refund or payback can be connected to the
   purchase it offsets, by that number. The link supplies the category.
3. The same connection is available for Venmo and Zelle rows.

## Why

Analytics already knows how to treat a classified inflow as an offset rather
than income — `fetchTxInputs` sets `isOffset: amount < 0 && userCategory != null`,
and `aggregate` nets those against their category. What is missing is a way to
say *which purchase* an inflow offsets. Today you retype the category and hope
you remember what the refund was for; the relationship itself is not recorded.

A stable per-transaction number makes the relationship expressible: the refund
points at `#412`, and `#412` means the same row forever.

## Data model

```prisma
model Transaction {
  // ...
  label      Int?    @unique  // permanent display serial; oldest transaction = 1
  linkedToId String?          // refund/payback -> the outflow it offsets

  linkedTo Transaction?  @relation("TxRefunds", fields: [linkedToId], references: [id], onDelete: SetNull)
  refunds  Transaction[] @relation("TxRefunds")

  @@index([linkedToId])
}
```

Many refunds may point at one purchase; a purchase is never split across
several refunds with explicit amounts. A join table with per-link amounts would
allow that, at the cost of a join on every read, allocation inputs in the UI,
and apportioning in analytics. For personal spending a refund maps to one
purchase essentially always, so the foreign key wins.

`label` is nullable. SQLite cannot add a `NOT NULL UNIQUE` column to a
populated table without rebuilding it; a nullable column plus a backfill plus
unconditional assignment on insert gives the same practical guarantee with far
less migration risk. The UI renders `—` for a null that should never occur.

`onDelete: SetNull` matters because sync deletes transactions Plaid retracts.
A refund whose target disappears reverts to plain income rather than erroring.

## Migration

Back up `prisma/dev.db` into `prisma/backups/` first — the self-relation will
make Prisma rebuild the `Transaction` table.

Generate with `prisma migrate dev --create-only`, then append the backfill so
it runs after the rebuild:

```sql
UPDATE "Transaction" SET "label" = (SELECT rn FROM
  (SELECT id, ROW_NUMBER() OVER (ORDER BY "date" ASC, "createdAt" ASC) rn FROM "Transaction") s
  WHERE s.id = "Transaction"."id");
```

Oldest transaction is `#1`. Ordering by date then `createdAt` keeps the
numbering deterministic when several rows share a date.

## Assigning labels

New `src/lib/labels.ts`:

```ts
/** Next display serial. Syncs are serialized in a single-user app, so max+1 is safe. */
export async function nextLabel(): Promise<number>
```

Called from the `create` branch of both transaction upserts —
`sync.service.ts` and `venmo.service.ts`. Computing a label before an upsert
that turns out to be an update wastes a read but burns no number, since the
maximum is unchanged.

Deleted transactions leave gaps in the sequence. This is deliberate: reusing a
number would silently change what a number someone wrote down refers to.

## Linking

### `PATCH /api/transactions/:id`

Gains `linkedToLabel: number | null`. `null` unlinks.

Rejected: an unknown label, linking a row to itself, a target that is not an
outflow, a target that is itself linked (no chains), and a source row that is
not an inflow.

On success the row gets `linkedToId` and `userCategorySource = "LINK"`, and its
`userCategory` is cleared. The category is derived through the link rather than
copied, so it cannot drift and so linking works whether or not the purchase has
been categorized yet — which matters, because categorizing the purchase after
linking the refund is a normal order of operations.

Copying would have avoided every analytics change, but three write paths mutate
`userCategory` — the manual PATCH, the Zelle PATCH, and the rules engine — and
each would have to propagate to linked refunds. The Zelle PATCH currently
writes `userCategory` with no source guard at all, so a copy would go stale
immediately.

### `GET /api/transactions/:id/link-candidates`

Ranks outflows and returns the top 5, each with label, date, name, amount and
category. Signals: counterparty or merchant match, name-token overlap, recency
within 90 days, and `amount >= |refund|`. Server-side rather than filtered from
the loaded page, because the purchase behind a refund is often months back.

For a Venmo or Zelle inflow the counterparty is a person, so the merchant
signal rarely fires and the date and amount signals carry the ranking.

### `GET /api/transactions`

Each row gains `label`, `linkedTo`, `refunds[]` and `netAmount`. Two extra
queries per page: one for refunds of the rows on the page, one to resolve the
targets of rows that are themselves links.

Both P2P pages link through this endpoint rather than getting their own —
Venmo and Zelle rows are already `Transaction`s, so a second linking endpoint
would only duplicate the validation.

## Analytics

Every analytics view funnels through `fetchTxInputs`, so the change lands in
one function:

- The WHERE clause's first `OR` gains `{ linkedToId: { not: null } }`. Without
  it a linked Zelle payback — `isTransfer: true` with no `userCategory` — is
  filtered out before it can offset anything.
- The select pulls `linkedTo.userCategory` and `linkedTo.pfcPrimary`.
- Effective category resolves through the link when the row has no category of
  its own.
- `isOffset` becomes `amount < 0 && effectiveCategory != null`.
- Rows whose resolved category is `Transfer` are dropped in the mapper. The
  existing exclusion is a string match in the WHERE clause and cannot reach
  through a relation.

`hideInternal` in `api/transactions/route.ts` needs the same `linkedToId`
clause, for the same reason.

Over-refunding is allowed. The net goes negative and `clamp` in `aggregate`
already floors category totals at zero.

## Ledger UI

A `#` column sits left of Date on every row, mono and muted.

The expand affordance currently keys off "has a Venmo breakdown"; it widens to
"has a breakdown **or** has refunds". Expanding a purchase lists the refunds
linked to it. Its amount cell shows the gross with `net $30.00` beneath. A
refund row carries a `→ #412` chip.

`CategoryEditor` gains a third line, on inflows only: **Connect to a purchase**
— up to five one-click suggestions rendered as `#412 · Sep 3 · Amazon · $84.20`,
a `#` input for anything not suggested, and Unlink. While a row is linked its
category select and subcategory input are disabled and show the inherited
category. The link owns the category.

## Venmo and Zelle UI

`P2pCategorizer` gets the same `#` column, and inflow rows get the same picker
beneath the category dropdown. The picker is extracted as
`TransactionLinkPicker` and shared with the ledger's editor.

The dropdown disables while a row is linked, and the Zelle PATCH gains a
`linkedToId: null` guard so it cannot overwrite a linked row's derived
category.

`GET /api/venmo` and `GET /api/zelle` add `label` and `linkedTo` to their row
shape, and report the derived category in the existing `category` field. That
keeps the page's "Received (categorized)" and "Net spend" totals correct
without special-casing links — a linked row simply is not `Uncategorized`.

## Known limitation

When a pending transaction posts, Plaid retracts the pending row and sends a
new one with a different id. A link to a *pending* row is therefore dropped and
its label burned. Linking posted transactions, which is the normal case, is
unaffected.

An offset is counted in the month the refund falls in, not the month of the
purchase it pays back. Links may span up to 90 days, so on a one- or
three-month analytics view the purchase can fall outside the window while the
refund does not. The offset then subtracts from a category that shows no
matching spend, and `aggregate`'s clamp floors the category at zero, which
hides the discrepancy rather than surfacing it. This predates the branch, but
linking makes the gap far easier to reach than it was before.

## Testing

The repo has no JS test runner — `npm test` runs two bash suites. This adds
`scripts/test-links.mjs` on the built-in `node:test` runner, no new dependency,
wired into `npm test` alongside them.

Covered as pure functions, no database: candidate ranking, category resolution
through a link, and the `isOffset` decision. The ranking and offset logic are
exactly the kind of thing that breaks quietly later.

The UI is verified in the browser preview. The build finishes with
`bash Budget.command --no-open`.
