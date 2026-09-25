# Changelog

Versions are `MAJOR.MINOR.PATCH`, and they number **releases, not commits**: a
version is something you can install, so it changes when the published version
does, not every time main moves. Work lands under Unreleased and is given a
number at the moment it is published. A release carrying new features moves the
middle number; one carrying fixes and small changes moves the last.

Still `0.x`: the database schema changes between releases (migrations run on
update), so nothing here is a stability promise.

## Unreleased

- Flights under Benefits is part of Pro. In Normal it leaves the sidebar, and
  `/benefits/flights` says where the switch is rather than showing the
  comparison.
- Venmo and Zelle move under Transactions in the sidebar, beside the ledger,
  at `/transactions/venmo` and `/transactions/zelle`. Both are the ledger
  narrowed to one kind of payment, so they sit with it rather than as two more
  top-level pages. The old `/venmo` and `/zelle` addresses redirect.
- A card's "Linked" badge is capped in width, with the full account name on
  hover. The name is whatever the bank calls the account, and a long one —
  "American Express Gold Card" — pushed the card's arrows and Remove onto a
  row of their own.
- Cards start collapsed, opening on the chevron in their header. A card opened
  out is four sections tall, so a wallet's worth of them buried everything
  below the first; collapsed, each is one row and the whole list fits a screen.
  Which cards you left open is remembered, like the rest of your settings.
- Benefits splits into Cards, Best card and Flights, nested in the sidebar the
  way Settings is. It was one page holding every card's credits, rates and
  earnings plus two more tools, so anything below the first card was a long
  scroll away. `/benefits` lands on Cards.
- Card images get the card's rounded corners, cut into the image itself —
  18px on a 543-wide card, scaling with it — since the app squares off every
  border-radius in CSS. Images saved before this keep square corners until
  they are added again.
- The crop comes from the screenshot's size. A given phone puts the card in the
  same place every time, so the app matches the screen and stamps out its known
  rectangle — 543 x 342 at 30, 192 for an iPhone of this shape, held as
  fractions so one entry covers the full-resolution file too. A picture no
  preset covers falls back to reading its edges.
- The crop's sides land on the card rather than on the glow around it, and its
  bottom edge is worked out from the card's proportions rather than measured. The top and sides are where a card meets the backdrop cleanly; the
  bottom is where it sits over its own drop shadow, and measuring it either
  stopped short or ran down into the shadow. A bank card has a fixed shape, so
  the reliable width gives the height exactly.
- Saving is a button rather than a quiet link, with the preview marked "not
  saved yet" — it was too easy to judge a crop and never store it.
- Cards can carry their own image. Point it at a Wallet screenshot and it
  finds the card in the frame and crops to it — the status bar and any caption
  are left out — then shows what it decided before anything is saved. Images
  live in `data/card-art`, beside the rest of what the app writes, and a card
  can drop back to its placeholder at any time.
- Each card on Benefits shows its face on the left. No image is stored for a
  card yet, so every card gets a placeholder: a deterministic colour pair, cut
  to the proportions of a real card and carrying its issuer and last four, so
  two cards from the same issuer are still told apart at a glance.
- `npm test` runs the tests before the linter instead of after it. Linting
  first meant one unused variable stopped the suite before it checked anything
  that matters, so a session with work in progress lost every real signal over
  a cosmetic warning. The linter is still strict and still fails the run — it
  just no longer decides whether the tests get to speak.

## 0.5.5 — 2026-09-24

Developed as a series of changes and published together, so 0.5.0 through
0.5.4 were never releases of their own.

- The income and tax organizer is part of Pro. Normal leaves it out of the
  sidebar, and `/income` says where the switch is rather than redirecting.
  Nothing you entered is touched — turning Pro back on shows it unchanged.
- The mode switch now reaches the sidebar immediately. Every reader of the
  mode shared one stored value but kept its own copy of it, which only showed
  as a bug once something mounted for the whole session rather than per page.
- Light, Dark and System under Settings > Mode. The choice follows you between
  browsers like every other setting, and is applied before the first paint, so
  there is no flash of the wrong palette on load. System is the default and
  tracks the device.
- The spending-by-category donut fits inside its card again. Its radius was a
  fixed 88px against a box that is 169px across, so it overhung the edges.
- Hovering any band in Cash flow over time names it — month, category, and the
  subcategory when there is one — with its amount. The thin bands are the ones
  that needed it, since there is no room to label them, so every band also
  carries a hit area tall enough to point at. Only in the one- and two-month
  views: wider than that, a month is a few pixels across and its bands are too
  tightly stacked to point at the one you meant.
- The bar in the middle of Cash flow over time is no longer flat grey. It
  carries the colours it joins: what arrives, down its left edge, fading
  across to what leaves, down its right. The legend shows it as an outline
  now, since it has no colour of its own to key.
- The middle of Cash flow over time no longer looks like a bar laid over the
  diagram. It keeps its gradient but drops the rounded corners and takes the
  same opacity as the ribbons either side, so the flows read as running
  through it. Hovering that stretch still reports the month's total.
- Fixes the cash-flow bar introduced over 0.5.3–0.5.4: the outgoing side had
  gone grey again, and each colour bled halfway into its neighbour, so a tall
  income band read as if it ran well past where it ends. The bar is also wider
  than the end nodes now, so incoming colours turn into outgoing ones over a
  long enough stretch to read as a blend; the ribbons either side give back
  what it takes, leaving the diagram the same size.







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
