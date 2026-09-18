# Settings sections, relocated configuration, and an analytics detail mode

Four changes that share one idea: configuration belongs in one place, and a page
you read should not be cluttered with the controls you set once.

1. Settings becomes a parent with sub-sections rather than a single page.
2. Categories moves under it, as one of those sections.
3. Rules moves under it too, off the top-level menu.
4. Bank and debit-card management moves off Accounts and under it.
5. Analytics gains a Normal/Pro detail mode, whose switch lives under it.

## Why

`/settings` currently *is* the category editor, which only works while there is
exactly one thing to configure. There are already three more: rules, the bank
and debit-card connections buried at the bottom of Accounts, and now a display
preference for Analytics. Left alone, each would claim its own top-level menu
entry, and the sidebar would list configuration and daily-use pages at equal
weight.

Accounts has the same problem in miniature. It answers "what am I worth and what
did each account do", and then ends with three blocks about *administering*
connections — connect a bank, disconnect one, manage debit cards. Those are
things you do once and then never look at, occupying the bottom of a page you
open constantly.

## Navigation

`SideNav` holds a flat array today. Settings becomes the one entry with
children, each a real route:

| Route | Contents |
|---|---|
| `/settings` | redirects to `/settings/categories` |
| `/settings/categories` | the existing category editor |
| `/settings/rules` | the existing rules editor |
| `/settings/connections` | connect/disconnect banks, and debit cards |
| `/settings/analytics` | the Normal/Pro switch |

Children render indented under the parent when the sidebar is expanded. The
parent is highlighted whenever any child is active, so the sidebar still shows
where you are. Collapsed, the sidebar shows only the parent's `SET` code and
clicking it lands on the first child — the same behaviour every other entry has
when collapsed, and the reason children are not given their own codes.

`/rules` is a route that exists today and may be bookmarked, so it answers with
a permanent redirect to `/settings/rules`. `/settings` redirects to
`/settings/categories` as a default landing rather than a move, so it uses the
temporary form; making it an index page later should not require unwinding a
308 a browser has cached.

Both use `redirect`/`permanentRedirect` from `next/navigation` in a server
component, which the bundled Next documentation confirms is current for this
version.

## What moves, and what does not

The components themselves do not change. `SettingsCategories`, `RulesDashboard`,
`PlaidLink`, `ConnectedBanks` and `DebitCards` are lifted as they are; only the
page that renders them changes. This is a relocation, and treating it as one
keeps the diff readable and the risk low.

`AccountsDashboard` loses the two `PlaidLink` buttons, `DebitCards` and
`ConnectedBanks`. It keeps `NetWorthCard` and the grouped account list with
balances and due dates — the split is between what you read and what you
administer. It still fetches `/api/accounts`; the new connections page fetches
the same endpoint, since it needs the `banks` and `debitCards` that response
already carries.

## The analytics detail mode

Analytics renders five blocks. Normal mode shows the summary cards, the category
breakdown and the monthly trend. Pro adds the cash-flow Sankey and the
cumulative spending graph, which are the two dense, interactive ones.

The preference is a single value, `"normal"` or `"pro"`, in the existing
`data/ui-state.json` store, read and written through `loadSynced`/`pushSynced`
in `src/lib/ui-state.ts`. That store exists for exactly this — small
cross-browser preferences, with `localStorage` as a write-through cache and a
fallback when the server is unreachable — and the sidebar's collapsed state
already uses it. A database row for one enum would mean a migration for
something this store was built to hold.

Normal is the default, including when the stored value is missing or
unrecognised.

**Analytics says when it is hiding something.** In Normal mode the page carries
one quiet line noting that more views are available in Settings. Without it the
two charts simply vanish and the page reads as broken rather than simplified.

## Structure

The parsing and defaulting of the stored value lives in
`src/lib/analytics-mode.ts`, free of imports so `node:test` can load it directly
under Node's native type stripping — the same constraint that governs
`src/lib/links.ts`, `src/lib/plaid-errors.ts` and `src/lib/category-rename.ts`.
It exports the two mode values and a function that turns an unknown stored value
into a valid one.

Two new components: `SettingsConnections`, which composes the three lifted
blocks and owns the `/api/accounts` fetch they need, and `SettingsAnalytics`,
which renders the switch. Both follow the existing page idiom — a client
component under a `<main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">`
wrapper, with the same light/dark Tailwind pairings and banner styling as their
siblings.

## Testing

`scripts/test-analytics-mode.mjs` on `node:test` covers the one piece with real
logic: that a stored `"pro"` is honoured, that `"normal"`, an unknown string,
`null` and `undefined` all resolve to Normal, and that the resolver never throws
on a value the store might hold from an older version.

Everything else is relocation, and its verification is behavioural: every moved
surface still works where it now lives, Accounts still shows balances and due
dates, both old URLs still resolve, and each Analytics mode renders the blocks
it should and none it should not.

## Known limitation

The sidebar gains one level of nesting, and nothing here generalises it further.
A second parent with children would want the expand/collapse state persisted per
parent; this design gives Settings' children no collapse state of their own,
because with four leaf items there is nothing to gain by hiding them.
