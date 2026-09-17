# Editable categories and a Settings page

The category list is a hardcoded constant today. This makes it data the user
owns: a `/settings` page where categories can be added, renamed, merged,
remapped and deleted, with every surface that offers or resolves a category
reading the stored list instead of the constant.

## Why

Two lists exist and neither can be changed without editing source. The ledger
and the Rules page offer `RULE_CATEGORIES` — the union of a P2P list and Plaid's
sixteen personal-finance-category primaries, humanized. The Venmo and Zelle
pages offer their own shorter lists, which they also validate against.

Because those lists were assembled from two different vocabularies, they contain
duplicates that mean the same thing. `Dining` (from the P2P list) and
`Food and Drink` (Plaid's `FOOD_AND_DRINK`, humanized) both appear in analytics
as separate categories, and no amount of re-categorizing by hand collapses them,
because most transactions carry no user category at all and fall back to Plaid's
wording. The taxonomy has to become editable, and it has to govern the fallback,
or the duplicate cannot be removed.

## Decisions taken before design

- **Renaming migrates the data; deleting is blocked while a category is in use.**
  A delete offers to reassign the affected transactions first.
- **One unified list, used everywhere** — ledger, Rules, Venmo and Zelle. The
  P2P dropdowns grow; the duplicate becomes fixable.
- **Plaid's primaries map onto the user's categories**, and analytics resolves
  through that mapping. Without this the feature governs only what can be
  assigned, and Plaid's wording keeps appearing for every transaction the user
  has not touched by hand.

## Data model

```prisma
// A spending category the user can assign. Seeded from the lists that used to
// be hardcoded, and editable from /settings.
model Category {
  id        String   @id @default(cuid())
  name      String   @unique
  createdAt DateTime @default(now())

  plaidMappings CategoryMapping[]
}

// Which of Plaid's personal-finance-category primaries resolve to this
// category. A primary resolves to exactly one category; the unique constraint
// makes that structural rather than a convention the API has to remember.
model CategoryMapping {
  id         String @id @default(cuid())
  pfcPrimary String @unique // e.g. FOOD_AND_DRINK
  categoryId String

  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@index([categoryId])
}
```

There is no `sortOrder`. The lists are alphabetical today and nobody asked for
manual ordering; adding a column and the UI to drive it can wait until someone
does.

**A transaction still stores its category as text, not a foreign key.**
`Transaction.userCategory` keeps holding `"Dining"` or `"Home Improvement >
Furniture"`, and `CategoryRule.category` keeps holding a plain name. Converting
those to relations would mean migrating every row and rebuilding the
`"Parent > Sub"` convention on top of a join, for no gain the user can see. The
consequence is that a category is a *name*, not an identity — which is exactly
why renaming has to rewrite the text and deleting has to be refused while text
still references it.

## Seeding, and why day one changes nothing

The migration seeds `Category` from the union of today's `RULE_CATEGORIES` and
every distinct parent category already present in `Transaction.userCategory` —
the second half defensively, so a category in use can never be absent from the
list that governs it.

It then seeds `CategoryMapping` with one row per Plaid primary, pointing at the
category whose name equals that primary humanized. Those names all exist by
construction, because `RULE_CATEGORIES` was built from them.

That makes the seed **behaviour-preserving**: resolving a Plaid row through the
mapping returns `humanizePfc(primary)`, which is exactly what the code returns
today. Nothing shifts until the user edits something, and that property is worth
asserting in a test rather than assuming.

## Renaming, merging, deleting

Renaming rewrites every stored reference: `Transaction.userCategory` and
`CategoryRule.category`. Subcategories have to survive it — renaming
`Home Improvement` to `Home` must turn `"Home Improvement > Furniture"` into
`"Home > Furniture"`, not leave it orphaned. That rewrite is the one piece of
genuinely error-prone logic here, so it lives in a pure function and is unit
tested.

**Renaming onto a name that already exists is a merge, not an error.** This is
the operation the whole feature exists to enable: renaming `Food and Drink` to
`Dining` should fold the one transaction, any rules, and Plaid's
`FOOD_AND_DRINK` mapping into `Dining`, then drop the now-empty category. The
UI states what will move before doing it. Treating this as a unique-constraint
violation would block the only path to the problem that prompted the feature.

Because `Category.name` is unique, the rename endpoint looks for an existing
category with the target name before it writes anything. Finding one is what
selects the merge path — references are rewritten to the target, the source's
Plaid mappings move across, and the source row is deleted — so the constraint is
never violated rather than being caught as an error.

Deleting is refused while a category is in use, reporting how many transactions
and rules reference it, and offering to reassign them to another category first.
"In use" counts subcategorized rows as well: `"Home Improvement > Furniture"`
uses `Home Improvement`, and a delete that ignored it would strand the row under
a category that no longer exists. It also counts being the target of a Plaid
mapping, since deleting a category that `FOOD_AND_DRINK` resolves to would
silently strand that primary.

## API

`GET /api/categories` returns the list with, for each category, the Plaid
primaries mapped to it and the number of transactions and rules using it. The
counts are what let the UI disable a delete and explain why.

`POST /api/categories` creates one from a name.

`PATCH /api/categories/:id` renames (migrating references, merging when the name
is taken) and sets which Plaid primaries resolve to it. Reassigning a primary
moves it off whichever category previously held it, which the unique constraint
enforces.

`DELETE /api/categories/:id` takes an optional `reassignTo`. Without it, a
category in use is refused with the counts that explain the refusal.

## What changes elsewhere

Everything that names a category stops reading a constant:

- `TransactionTable.tsx` — the ledger's category picker. The list is fetched
  once by `TransactionLedger`, which already owns the page's fetching, and
  passed down.
- `RulesDashboard.tsx` — the rule category select.
- `api/venmo/route.ts` and `api/zelle/route.ts` — the `categories` they return.
- `api/venmo/[id]/route.ts` and `api/zelle/[id]/route.ts` — the validation of an
  incoming category, which currently rejects anything outside the hardcoded
  list and would otherwise reject the user's own new categories.
- `analytics.service.ts` — `fetchTxInputs` resolves an uncategorized row's
  primary through the mapping instead of humanizing it, and does the same when
  resolving a linked row's inherited category.
- `api/transactions/route.ts` — the same resolution for the DTO's category
  fields.

`RULE_CATEGORIES` and the P2P constants stay in the source as the seed's input,
and stop being read at runtime.

## Settings page

`/settings`, added to the sidebar under Income. One table: the category name,
inline editable; how many transactions and rules use it; and the Plaid labels
that resolve to it, editable as a multi-select over the sixteen primaries.
Adding takes a name. Deleting is a button that explains itself when it is
refused.

## Known limitations

A category is identified by its name, so two names differing only in case or in
surrounding whitespace are different categories. Names are trimmed on save and
compared case-sensitively, matching how the stored text already behaves.

Subcategories stay free text with the existing suggestions. They are not part of
the managed list, so nothing stops a subcategory existing under a category that
was later renamed — the rename rewrites it, but a subcategory typed fresh is
never validated.

## Testing

A category name may not contain `" > "`; that sequence separates a subcategory,
and allowing it in a name would make the stored text ambiguous. Both the create
and rename endpoints reject it.

`scripts/test-categories.mjs` on `node:test`, covering the pure rename rewriter:
an exact match, a parent carrying a subcategory, a non-match, a name that is a
prefix of another (`Home` must not rewrite `Home Improvement`), case
sensitivity, and a value holding more than one separator — only the first is the
parent boundary.

A seed assertion that every Plaid primary resolves, after migration, to the same
string the current code produces — the behaviour-preserving property above.

The pages are verified in the browser: renaming a category and seeing the ledger
and analytics follow it, a merge folding one category into another, a refused
delete, and a Plaid remap moving uncategorized spend between categories.
