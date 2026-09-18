# Settings sections, relocated configuration, and an analytics detail mode

Five changes that share one idea: configuration belongs in one place, and a page
you read should not be cluttered with the controls you set once.

1. Settings holds four collapsible sections rather than one editor.
2. The category editor becomes one of them.
3. Rules becomes another, leaving the top-level menu.
4. Bank and debit-card management moves off Accounts to become a third.
5. Analytics gains a Normal/Pro detail mode, whose switch is the fourth.

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

**The sidebar does not change.** It keeps one flat `Settings` entry, exactly as
now. Nesting configuration inside the sidebar would put four rarely-used items
permanently in a list you scan constantly, and it would need a collapsed-mode
answer for children that have no three-letter codes.

Instead `/settings` is a single page holding four sections, each of which opens
and closes like a dropdown:

| Section | Contents |
|---|---|
| Categories | the existing category editor |
| Rules | the existing rules editor |
| Connections | connect/disconnect banks, and debit cards |
| Analytics | the Normal/Pro switch |

**A closed section does not mount its component.** This is the decision that
makes the page viable rather than merely possible. The rules editor is ~350
lines and the category editor ~280, and each fetches on mount — the category
editor's list endpoint runs up to three count queries per category. Rendering
all four eagerly would fire four independent fetches and build the whole page to
show you four headers. Mounting a section the first time it opens means opening
Connections costs nothing in the other three.

Sections open independently rather than one at a time. This is a settings page,
not a wizard; having Categories collapse because you opened Analytics would be
irritating and serves nothing. Categories starts open and the rest closed, so
the page is useful on arrival rather than four headers and nothing else.

Each section has a stable id, and the page reads `location.hash` on mount to
open a matching one. That gives every section an address — `/settings#rules`,
`/settings#connections` — and is what lets an existing `/rules` bookmark keep
working.

`/rules` is a route that exists today and may be bookmarked, so it answers with
a permanent redirect to `/settings#rules`, landing on the rules editor open and
ready. It uses `permanentRedirect` from `next/navigation` in a server component,
which the bundled Next documentation confirms is current for this version.

Note that a URL fragment is not sent to the server, so the redirect target
carries it for the browser to apply and the page does the rest on mount. Nothing
server-side reads it.

## What moves, and what does not

The components themselves do not change. `SettingsCategories`, `RulesDashboard`,
`PlaidLink`, `ConnectedBanks` and `DebitCards` are lifted as they are; only what
renders them changes. This is a relocation, and treating it as one keeps the
diff readable and the risk low.

`AccountsDashboard` loses the two `PlaidLink` buttons, `DebitCards` and
`ConnectedBanks`. It keeps `NetWorthCard` and the grouped account list with
balances and due dates — the split is between what you read and what you
administer. It still fetches `/api/accounts`; the Connections section fetches
the same endpoint when it opens, since it needs the `banks` and `debitCards`
that response already carries.

The `/rules` page becomes the redirect; the top-level `Rules` entry leaves the
sidebar.

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

Three new components. `SettingsSection` is the dropdown itself — a header that
toggles, and children rendered only once opened, so the lazy-mount rule lives in
one place rather than being re-implemented four times. `SettingsConnections`
composes the three lifted blocks and owns the `/api/accounts` fetch they need.
`SettingsAnalytics` renders the switch. All follow the existing idiom, with the
same light/dark Tailwind pairings and banner styling as their siblings.

`src/app/settings/page.tsx` composes the four sections and owns which are open,
including reading the hash on mount.

## Testing

`scripts/test-analytics-mode.mjs` on `node:test` covers the one piece with real
logic: that a stored `"pro"` is honoured, that `"normal"`, an unknown string,
`null` and `undefined` all resolve to Normal, and that the resolver never throws
on a value the store might hold from an older version.

Everything else is relocation, and its verification is behavioural: every moved
surface still works inside its section, a closed section performs no fetch,
Accounts still shows balances and due dates, `/rules` lands on Settings with the
rules section open, and each Analytics mode renders the blocks it should and
none it should not.

## Known limitations

Which sections are open is not remembered between visits. Categories opens, the
rest do not, every time — unless a hash says otherwise. Persisting it would mean
another `ui-state` key for something a single click already solves.

A section's component stays mounted once opened, even if the section is closed
again. Closing hides it rather than tearing it down, so its in-progress state —
a half-typed rule, an open category editor — survives a stray click on the
header. The cost is that the fetch it performed is not released until the page
is left, which for four small editors is not worth managing.
