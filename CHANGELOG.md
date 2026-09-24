# Changelog

Versions are `MAJOR.MINOR.PATCH`. The middle number moves for new features,
the last for fixes alone. Still `0.x`: the database schema changes between
releases (migrations run on update), so nothing here is a stability promise.

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
