# Changelog

Versions are `MAJOR.MINOR.PATCH`. The middle number moves for new features,
the last for fixes alone. Still `0.x`: the database schema changes between
releases (migrations run on update), so nothing here is a stability promise.

## 0.5.5 — 2026-09-24

- Fixes the cash-flow bar introduced over 0.5.3–0.5.4: the outgoing side had
  gone grey again, and each colour bled halfway into its neighbour, so a tall
  income band read as if it ran well past where it ends.

## 0.5.4 — 2026-09-24

- The middle of Cash flow over time no longer looks like a bar laid over the
  diagram. It keeps its gradient but drops the rounded corners and takes the
  same opacity as the ribbons either side, so the flows read as running
  through it. Hovering that stretch still reports the month's total.

## 0.5.3 — 2026-09-24

- The bar in the middle of Cash flow over time is no longer flat grey. It
  carries the colours it joins: what arrives, down its left edge, fading
  across to what leaves, down its right. The legend shows it as an outline
  now, since it has no colour of its own to key.

## 0.5.2 — 2026-09-24

- Hovering any band in Cash flow over time names it — month, category, and the
  subcategory when there is one — with its amount. The thin bands are the ones
  that needed it, since there is no room to label them, so every band also
  carries a hit area tall enough to point at. Only in the one- and two-month
  views: wider than that, a month is a few pixels across and its bands are too
  tightly stacked to point at the one you meant.

## 0.5.1 — 2026-09-24

- Light, Dark and System under Settings > Mode. The choice follows you between
  browsers like every other setting, and is applied before the first paint, so
  there is no flash of the wrong palette on load. System is the default and
  tracks the device.
- The spending-by-category donut fits inside its card again. Its radius was a
  fixed 88px against a box that is 169px across, so it overhung the edges.

## 0.5.0 — 2026-09-24

- The income and tax organizer is part of Pro. Normal leaves it out of the
  sidebar, and `/income` says where the switch is rather than redirecting.
  Nothing you entered is touched — turning Pro back on shows it unchanged.
- The mode switch now reaches the sidebar immediately. Every reader of the
  mode shared one stored value but kept its own copy of it, which only showed
  as a bug once something mounted for the whole session rather than per page.

## 0.4.1 — 2026-09-24

- The version is shown on the home page too, not only at the foot of the
  sidebar, so it is visible without expanding the nav.

## 0.4.0 — 2026-09-24

- Payment splits: carve one transaction into several categories, with the
  remainder derived rather than stored. Splits count toward analytics,
  rewards and category totals.
- Subcategories, added and listed under Settings > Categories, usable as
  split targets and rule targets.
- Rules show what each one matched, can set subcategories, and can take over
  transactions you had categorized by hand.
- Pro is an app-wide mode rather than an Analytics-only toggle.
- First and Last page buttons in the ledger.
- Zelle payments described the way Chase writes them are recognized, not just
  U.S. Bank's wording.
- Subscriptions charged twice a month are their own cadence instead of being
  counted as every-two-weeks, which overstated their monthly cost by ~8%.
- Tests for reward earnings, Venmo statement parsing, Zelle, subscriptions and
  the shared UI-state store; `npm test` now fails on lint problems.
- This changelog, and a version number shown in the sidebar.

## 0.3.0 — 2026-09-18

- Settings gains its own section: categories, rules, banks and debit cards
  move underneath it.
- Analytics has a Normal and a Pro detail mode.
- Categories can be renamed, merged and deleted.

## 0.2.0 — 2026-09-17

- Every transaction carries a permanent number.
- A refund or payback can be connected to the purchase it covers: it takes
  that purchase's category and nets against it instead of inflating income.
- Venmo and Zelle paybacks can be connected the same way.

## 0.1.1 — 2026-09-16

- Reconnecting a bank stores the accounts it adds instead of dropping them.
- The server is told which port to listen on.
- The documented release command is one that can actually run.

## 0.1.0 — 2026-09-12

First public release.
