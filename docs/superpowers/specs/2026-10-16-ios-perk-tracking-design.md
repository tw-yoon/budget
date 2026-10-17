# Perk tracking on the iPhone: proof, questions, reminders

## Why

The owner pays annual fees for cards whose value is mostly monthly,
semiannual and annual statement credits. Today a credit's progress is a
number: "$7 / $7". When the auto-match misses (as it did for a credit Plaid
tagged as a transfer, fixed in 0.14.x), the owner taps the window to mark it
captured, which records the full amount whether or not it was earned. The
goal is to know, without tapping, whether every perk was actually used, and
to be warned while there is still time to use one.

Success: opening a card shows each perk filled from real transactions, with
the credit and the purchase behind it; anything the app is unsure about is a
question, answered once; a perk about to lapse unused sends a notification a
week before its window closes.

## Goals

1. **Proof.** A perk's page lists, per window, the statement credits that
   count toward it and, for each, the purchase that triggered it.
2. **Ask, then learn.** An incoming credit the app cannot place is shown as
   a question ("Is this +$7.00 Sample Coffee your Coffee Credit?"). The
   answer is remembered so the next one is placed automatically.
3. **One window, one cap.** A perk earns at most its amount per window. A
   matching credit that arrives after the window is already full is not
   counted silently; it becomes a question (it may be an ordinary refund).
4. **Reminders.** A local notification when a perk's window closes in 7 days
   and the perk is not yet full.
5. **Manual stays.** Window overrides (tap a window, type a used amount)
   keep working and still win over everything automatic.

## Non-goals

- Spending-type perks with no credit transaction (in-app balances like a
  rideshare cash perk). They stay manual, though they do get reminders.
- Push notifications from the Mac. A free Apple ID cannot receive them;
  reminders are scheduled on the phone.
- New web UI. The server changes serve both clients, but the review list,
  the perk page's transaction list and the reminders are phone-only for
  now. This is a deliberate difference from the "match the web" rule; the
  web keeps its current behaviour, which the new data must not break.

## Anti-goals

- Counting a credit toward a perk without either a learned rule or the
  owner's yes. A wrong automatic match is worse than a question.
- Nagging: a question is asked once per transaction; a reminder fires once
  per perk per window.
- Changing ledger totals by surprise. Pairing a credit with its purchase
  nets the purchase (see below); that is intended, and only happens for
  pairs the app matched by rule or the owner confirmed.

## How it works

### Which transactions are credits

A **credit candidate** is a money-in row (amount < 0) on an account linked
to one of the owner's cards (`UserCard.accountId`), not pending, not a fee,
not a card payment (`pfcDetailed` ending `CREDIT_CARD_PAYMENT`, or
`LOAN_DISBURSEMENTS_*` as the issuer's "Payment Thank You" posts), and
**including** rows Plaid tagged as transfers.

### Placing a candidate

For each candidate, in date order:

1. **Owner's answer.** If the owner already said "this is perk X" or "not a
   perk", that stands.
2. **Learned rule.** If its name or merchant contains one of a perk's
   keywords (`UserBenefit.matchText`, which exists today) and that perk's
   window containing the credit is not yet full, it counts, as **auto**.
3. **Otherwise, a question,** when it looks like a credit: the name contains
   "credit", or its amount equals a perk's amount on that card, or a perk's
   keyword matches but the window is already full. Each question carries a
   suggested perk (keyword match first, then equal amount, then none).
   Candidates that look like nothing (a marketplace refund of an odd amount)
   are not asked about; the owner can still attach one by hand from the
   perk's page.

Answering **yes, perk X** records the decision and, unless X already has a
keyword the row matches, adds one learned from the row: the merchant name if
present, else the row's name with the issuer's prefix and trailing
reference numbers dropped. Builder's call how to derive it; the owner can
edit a perk's keywords in Edit Credit (exists today). Answering **not a
perk** records that and never asks again for that row.

Only rows from the last 90 days are asked about, so turning this on does not
open with a backlog of old questions. Older rows still count via learned
rules for the year strip.

### Used amount

A window's used amount = manual override if set (unchanged), else the sum of
credits placed in it (auto and confirmed), each window still capped at the
perk amount for display as today (`cappedUsed`). The cap rule above means a
credit that would overflow a full window is asked about rather than added.

### Pairing the purchase

When a credit is placed (auto or confirmed), the app looks for the purchase
it reimburses: a money-out row on the same card account, within 45 days
before the credit, not already linked, amount at least the credit. Ranked by
(a) the merchant matches one this perk was paired with before, (b) the
merchant contains one of the perk's keywords, (c) closest date.

- If there is exactly one strong match ((a) or (b) with a single row), it is
  paired automatically.
- Otherwise the perk page shows the credit as "purchase not picked" and
  offers the ranked list to choose from (the existing
  `/api/transactions/[id]/link-candidates` ranking is a fine base).

A pairing **is** the existing refund link (`Transaction.linkedToId`): the
credit becomes a refund of that purchase, so analytics net the purchase
(a $7 coffee with a $7 credit counts as $0 spent) and the credit stops
counting as income. Unlinking from the ledger or the perk page undoes it.
Remembered merchants per perk feed ranking (a) — store them alongside the
perk (builder's call: a JSON list like `matchText`).

### Data the server keeps

- Per transaction, the owner's decision: which perk it belongs to, or "not a
  perk". Builder's call whether this is columns on `Transaction` or a small
  table keyed by transaction id; it must survive a sync re-run and be
  cleared if the perk is deleted.
- Per perk, the learned keywords (existing `matchText`) and paired merchants
  (new).

### API (shape is the builder's call)

- `GET /api/user-cards`: each benefit gains, per year window, its placed
  credits (id, date, name, amount, how placed: auto / confirmed) and each
  credit's paired purchase if any. The top level gains the open questions
  (transaction, card, suggested perk id or null).
- Write routes: answer a question (perk id or "not a perk"); attach a
  transaction to a perk by hand; detach one; pick a credit's purchase.
  Every request body gets a test asserting its JSON, per the iOS rules.

### iPhone screens

Native iOS patterns per the phone's conventions, not the web's layout.

- **Benefits → Cards:** when there are open questions, a "To Review" row at
  the top with a count; it opens the question list. Each question: the
  transaction (name, date, amount, card) and buttons for the suggested
  perk, "Other Perk…" (a picker of the card's perks), and "Not a Perk".
- **Card page:** each Statement Credits row shows a small dot or count when
  that perk has an open question.
- **Credit page** (`CreditDetailView`): under the progress, a section per
  window this year (current first) listing its credits; each credit shows
  its paired purchase beneath it, or "Pick Purchase". Swipe to detach. An
  "Add Transaction…" button attaches one by hand. The year strip and manual
  override stay as they are.

### Reminders

- A Settings toggle, "Perk Reminders", off until the owner turns it on; turning it
  on asks iOS for notification permission.
- Each time Benefits data loads (app launch, pull to refresh, tab open),
  the app clears its pending perk reminders and schedules one per perk whose
  current window is not full: at 10:00 local time, 7 days before the window
  ends. "Coffee Credit: $7 left, ends Oct 31." Perks in flat-value perk mode
  (always full) are skipped.
- If the owner opens the app already inside the last 7 days and the perk is
  still not full, one reminder fires shortly after, once per perk per window
  (remember which windows fired, on the device).
- A perk that fills before its reminder simply drops it on the next load.
- Limitation, stated in the UI copy nowhere but here: reminders are only as
  fresh as the last time the app loaded data.

### Decisions made while writing this (author's calls)

- **Detach is sticky.** Detaching a credit from a perk records "not this
  perk" for that row, so a learned keyword never puts it back. The row may
  then be asked about again only if it suggests a *different* perk.
- **Unlinking a pairing is sticky.** If the owner unlinks a credit from its
  purchase (on the perk page or in the ledger), that credit is marked "no
  auto-pair" and is never paired automatically again; picking a purchase by
  hand still works.
- **Automatic pairing only reaches back 90 days**, the same window as
  questions. Older credits still count toward their windows via learned
  keywords, but are not linked to purchases unless the owner picks one, so
  shipping this does not rewrite past spending totals.
- **One set of numbers.** The web shows the new used amounts (same service);
  it only lacks the review list, perk transaction list and reminders.
- **Deleting a perk** clears its per-row decisions and undoes the pairings
  this feature created (record which links it made). Links the owner made
  from the ledger stay.
- **Overlap.** A credit counts toward one perk only. If it matches two,
  it's a question.

## Constraints

- iOS rules in `ios/CLAUDE.md` (store failure rules, typed throws, test
  isolation, no project-file edits). Server tests use the existing
  `node --test` scripts.
- The live server holds real data; nothing from it goes in code, fixtures,
  docs or commits. Use invented names (Sample Coffee, Example Bank).
- Migrations run on update for friends' installs: new columns/tables need
  defaults; existing benefits keep working with no data step.

## Left to the builder

Storage shape, API shapes, how a learned keyword is derived from a row,
exact copy, and whether placement runs on read (as `benefits.service.ts`
does today) or is cached.
