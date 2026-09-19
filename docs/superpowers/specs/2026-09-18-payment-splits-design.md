# Payment splits

One payment, several categories. A $100 Target charge that was really $30 of
groceries and $70 of furniture stays a single transaction — one row, one label,
one `externalId` — but reports itself to Analytics as two amounts under two
categories.

Splitting is carving, not dividing. You name the parts you care about; whatever
is left over stays where it already was.

## Why

Category is currently a property of a whole transaction: one `userCategory`, or
Plaid's `pfcPrimary` when there is none. That is right for almost every row and
wrong for the ones that matter most — the big-box run, the Costco trip, the
Amazon order that was half household and half a gift. Those are exactly the
transactions large enough to distort a month's category totals, and today the
only options are to mislabel the whole thing or to leave it under General
Merchandise and know the number is a lie.

The existing refund-linking feature already established that a transaction's
effective category can be *derived* rather than stored (`resolveLinkedCategory`
in `src/lib/links.ts`). Splits extend the same idea from one derived category
per row to several.

## What a split is

A new table holding only the carve-outs:

```prisma
model TransactionSplit {
  id            String   @id @default(cuid())
  transactionId String
  amount        Float    // positive, Plaid's outflow convention
  userCategory  String   // full category; "Parent > Sub" allowed
  note          String?
  createdAt     DateTime @default(now())

  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@index([transactionId])
}
```

A part carries a full, independent category drawn from the same picker the row
itself uses. `Food` and `Food > Groceries` are both valid, and a subcategorized
part rolls up to its parent in Analytics exactly as a subcategorized row does
today — `splitCategory` already does that work and needs no change.

`onDelete: Cascade` is what keeps a retracted Plaid transaction from leaving
parts behind. `sync.service.ts` deletes removed rows outright, so the parts have
to go with them.

### Validation

Enforced when a part is written, in an import-free `src/lib/splits.ts` so
`node:test` can load it directly — the same constraint that governs `links.ts`,
`labels.ts` and `analytics-mode.ts`:

- The amount must be greater than zero. A zero part says nothing; a negative one
  would be a refund, which is a different feature.
- The transaction must be money out (`amount > 0`). Splitting income or a refund
  has no meaning under this model and is refused rather than half-supported.
- The transaction must not be pending. Plaid retires a pending row by *removing*
  it and adding the posted one under a fresh `transaction_id`
  (`sync.service.ts`), so parts attached to a pending row would vanish without a
  trace when it posts. `validateLink` refuses pending rows for this same reason.
- The parts must not sum to more than the transaction's amount *at the time of
  writing*. Drift is handled below and is a different situation from asking for
  an impossible split outright.

## The derived remainder

The remainder is never stored. It is computed:

```
remainder = transaction.amount - sum(parts.amount)
```

and it wears whatever the row's effective category resolves to *right now* —
`userCategory` if the user or a rule set one, otherwise the Plaid primary
through the user's own mapping. This is the single decision the rest of the
design hangs off, and it buys three things:

**Amount drift costs nothing.** When a pending $100 posts as $103.47, the $30
Food part stays $30 — that is the figure the user typed, and they meant dollars,
not a percentage — and the remainder becomes $73.47 on its own. No sync-time
maintenance, no stale copy to rewrite in the `modifiedTxs` loop.

**Recategorizing the row moves the remainder with it.** Retagging the Target
charge from General Merchandise to Home Improvement moves the $70 and leaves the
$30 Food alone, which is what the words mean.

**The common case needs no category at all.** The motivating example has *no*
`userCategory` — "general spending" is `GENERAL_MERCHANDISE` falling through
`pfcPrimary`. A stored remainder would have had to materialize a category that
the user never chose.

The remainder is omitted entirely when it rounds to zero, so a transaction split
exhaustively reports only its parts.

### When the remainder goes negative

A Plaid revision can drop a total below the sum of its parts. Rather than
clamping a part the user typed or silently dropping one, the remainder is
allowed to go negative and the row is flagged in the ledger as needing
attention. Analytics counts it as it stands: the totals stay arithmetically
consistent with the transaction, and the flag says the split needs a human.

Clamping would be worse than either. It edits a number the user entered, in
response to an event they never saw.

## Where splits surface

Both consumers want the same thing: a money-out row turned into the list of
(amount, category) slices it actually represents. `src/lib/splits.ts` owns that
as `sliceTransaction`, returning one slice per part plus the derived remainder.
Both callers below consume it rather than each deriving the remainder for
themselves, which is what keeps Analytics and the rewards math from ever
disagreeing about what a transaction was.

**Analytics.** `fetchTxInputs` already ends in a `flatMap`, so a split row emits
one `TxInput` per slice instead of a single entry.
Each carries the part's own category and the row's date, merchant and source.
Parts are slices of a money-out row, so `isOffset` is false on all of them; the
offset path stays reserved for genuine money-in.

The existing "Transfer" exclusion has to reach parts too. A part tagged
`Transfer` or `Transfer > ...` is dropped the same way an inheriting row is
dropped today — in the `flatMap`, since the WHERE clause cannot see through the
relation.

**Card rewards.** `computeEarnings` in `benefits.service.ts` buckets each
transaction's whole amount under `rewardCategoryFor(t)`. It buckets slices
instead, so a split Target run earns the grocery rate on its $30 and the base
rate on the rest. `rewardCategoryFor` itself does not change — it already takes
nothing but a category and the two Plaid fallbacks, which is exactly what a
slice carries.

**Everything else is untouched.** `rules.service.ts` writes the row's base
category, which is simply the remainder's category — rules need no knowledge of
splits and no new guard. The `label` sequence is untouched: parts are not
transactions and are never assigned a serial. `nextLabel` does not change.

## The category cascade

This is the part that is a correctness requirement rather than a feature.
`TransactionSplit.userCategory` stores a category *name*, so every operation in
`categories.service.ts` that rewrites or guards those names must extend to
splits:

| Operation | Change |
|---|---|
| `renameCategory` | Rewrite matching `TransactionSplit.userCategory` in the same `$transaction`, reusing `renameCategoryIn`. |
| Merge (rename onto an existing name) | The same rewrite; the confirmation count must include affected parts. |
| `deleteCategory` | Count parts alongside transactions, rules and mappings. A category still referenced by a part must refuse deletion. |
| `MergeNotConfirmedError` / `CategoryInUseError` | Gain a `splitCount`, reported as its own figure rather than folded into the transaction count — one transaction can hold several parts, and a conflated number would be wrong in both directions. |

A `splitUsing(name)` WHERE fragment mirrors the existing `txUsing` and
`ruleUsing`, matching both the whole name and the `name + " > "` prefix.

Omitting any row of that table orphans carve-outs against a category that no
longer exists, which Analytics would then report under a name the user deleted.

## Pro becomes an app-wide mode

Splits are gated behind Pro. Today "Pro" is `AnalyticsMode` in
`src/lib/analytics-mode.ts` — a detail toggle documented as governing "how much
of the Analytics page to show", which gates the cash-flow Sankey and the
spending graph. Having the Transactions page read a preference named
`analytics-mode` would make that documentation false.

So the concept is promoted, not borrowed. `analytics-mode.ts` becomes
`pro-mode.ts`, `AnalyticsMode` becomes `ProMode`, and the stored key becomes
`pro-mode`. `resolveProMode` keeps the existing forgiving contract: anything not
exactly `"pro"` resolves to Normal rather than throwing, because the store is a
JSON file a user can edit by hand.

Migration is one read. `loadSynced("pro-mode")` returning null falls back to
reading `analytics-mode`, and pushes the result forward under the new key. The
old key is left in place rather than deleted — it is three bytes in a JSON file,
and removing it buys nothing while breaking any older build still running.

Settings → Analytics becomes Settings → Mode, at `/settings/mode`, describing
both what Pro adds to Analytics and that it enables splitting in the ledger.
`/settings/analytics` answers with a permanent redirect, the way `/rules` does
since the settings-sections work.

### Reverting to Normal

The switch gates controls, never data. In Normal, with splits already recorded:

- Analytics still reports $30 Food and $70 General Merchandise. A display
  preference must never move a financial total.
- The row still shows its Split badge and still expands, read-only, so the
  ledger can always account for a number Analytics is showing. Counting a split
  while hiding it would be the worst of both.
- No "Add part" control, and existing parts cannot be removed. A part is
  never edited in place anywhere — changing one is removing it and adding
  it back, which keeps the write surface to two operations.
- Nothing is deleted, ever. Switching back to Pro restores the controls over the
  same data.

Opening a split row in Normal shows a one-line link to Settings, reusing the
nudge already at the foot of `AnalyticsDashboard`.

## The ledger

A split transaction keeps its single line: one serial, one date, one full
amount. It gains a Split badge and a chevron. Expanding reveals the parts
indented beneath it — each with its amount and category — with the derived
remainder rendered as the last part among equals, distinguished only by being
the one you cannot delete.

Amounts are entered in dollars, matching how the parts were conceived. Adding a
part offers the remaining amount as its default, so splitting a row in two is
one category pick.

Rendering parts as expandable children rather than stacked inline badges keeps
the row height fixed no matter how many ways a transaction is split — the
problem the transaction-label-wrapping work already ran into once.

## Out of scope

**Refund part-picking.** A refund linked to a split purchase offsets the
*remainder*, inheriting its category, exactly as it does for an unsplit row
today. The accurate alternative — choosing which part a refund cancels, as an
extra step in `TransactionLinkPicker` — is the most expensive piece of this
feature and applies only to a refund against an already-split purchase. It is
deliberately deferred. `resolveLinkedCategory` needs no change to support this
choice; the remainder simply is the row's effective category.

**Splitting from the Venmo and Zelle categorizer pages.** Those surfaces assign
one category to one payment. Splits live in the ledger.

**Percentage entry, and splitting money-in rows.** Neither has a motivating
case.

## Testing

Pure logic goes in `src/lib/splits.ts` with no imports, tested directly under
`node:test`: remainder arithmetic including the negative case, the zero-remainder
elision, and each validation refusal.

Service-level tests cover the two places where being wrong is silent rather than
loud — that `fetchTxInputs` emits parts plus remainder with correct categories
and Transfer exclusion, and that renaming, merging and deleting a category all
account for parts.
