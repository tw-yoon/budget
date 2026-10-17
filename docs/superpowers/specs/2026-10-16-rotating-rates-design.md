# Rotating quarterly earning rates

## Why

Some cashback cards pay a bonus (usually 5%) on categories that change every
calendar quarter, up to a spending cap (usually $1,500), after the owner
activates them with the issuer. Today the app stores this as one placeholder
rate, "Rotating (quarterly) 5%", which no purchase ever matches. So those
cards' earnings are understated and the Best Card list can't recommend them
for the quarter's categories.

The owner wants to type in each quarter's categories on the phone. The
bonus should count only for purchases in that quarter, then move into the
past. The app should also remind them, inside the app, to set up the next
quarter. The owner keeps notifications off, so nothing here may depend on
them. For the same reason, perks about to lapse get an in-app equivalent of
the Perk Reminders notification shipped in 0.14.x.

## Goals

1. **Enter a quarter on the phone.** For a card with a rotating rate, add or
   edit the bonus for a calendar quarter (Jan–Mar, Apr–Jun, Jul–Sep,
   Oct–Dec): rate and unit (pre-filled from the card's placeholder rotating
   rate), the categories it covers, merchant names, a spending cap
   (pre-filled $1,500), and an "Activated" switch.
2. **Two nets.** A purchase earns the bonus if its reward category is one of
   the picked categories **or** its name or merchant contains a typed
   merchant name (case-insensitive).
3. **Counts only in its quarter, up to the cap.** Matching purchases dated
   inside the quarter earn the bonus rate in date order until the cap's
   worth of spend; the rest earns what it would have earned without the
   bonus. Earnings show the bonus as its own row.
4. **Past quarters move aside.** The card page shows the current quarter's
   bonus with the rotating rate; earlier quarters sit in a "Past Quarters"
   list (read-only view, still editable if the owner taps Edit).
5. **Best Card knows the quarter.** In Benefits → Best card, the current
   quarter's categories count at the bonus rate for that card (categories
   only; merchant names can't map to a category).
6. **In-app prompts, no notifications.** At the top of Benefits → Cards:
   - "Set Up Q4 Categories" for each card that has a rotating rate but no
     bonus entered for the current quarter, or one entered but not marked
     Activated. Tapping opens that quarter's form.
   - "Ending Soon" listing perks whose current window ends within 7 days and
     isn't full ("Dining Credit · $10 left · ends Oct 31"). Tapping opens the
     credit page. The existing Perk Reminders notification stays as an
     option.

## Non-goals

- Fetching quarterly categories from issuers. The owner types them.
- Non-calendar quarters or monthly rotations.
- Web UI for entering quarters. The web shares the server math (earnings
  and its Best Cards ranking must stay correct with bonuses present) but
  gets no new form.
- Changing how the placeholder rotating rate is entered or deleted.

## Anti-goals

- Counting bonus spend outside its quarter, past its cap, or twice (a
  purchase matching both a category and a merchant earns the bonus once).
- Any push notification for this feature.
- A reminder that keeps showing after the owner has entered and activated
  the quarter.

## How it works

### Data

New table `RotatingBonus`: `id`, `userCardId` (cascade on card delete),
`year Int`, `quarter Int` (1–4), `multiplier Float`, `unit String`,
`categories String` (JSON array of reward categories from
`src/lib/rewards.ts`, excluding `OTHER` and `ROTATING`), `merchants String`
(JSON array of names), `excludeMerchants String` (JSON array; a purchase whose name or merchant contains one never earns the bonus, e.g. "Excluding Walmart and Target"), `cap Float?` (spend cap per quarter; null = no cap),
`activated Boolean @default(false)`, `createdAt`. Unique on
`(userCardId, year, quarter)`. Migration additive only.

A card "has rotating" when it has a `ROTATING` reward rate (both presets
that need this already include one). That rate stays as the card's default
multiplier/unit for new quarters and still displays in Earning Rates.

### Earnings

`computeEarnings` (src/lib/earnings.ts) gains the card's bonuses. For each
purchase slice in date order: if its date falls in a quarter with a bonus,
and (its reward category is in `categories` or the row's name/merchant
contains a merchant), it earns the bonus rate on the part of the slice that
fits under the remaining cap; the rest goes to its normal category. Bonus
spend appears as one `byCategory` row per quarter, category key
`ROTATING`, label "Q4 2026 bonus" (builder's call on exact label), with
`isBonus: true` and the usual `vsBest` comparison (other cards' rate for the
slice's own category). Pure and tested like today.

### API

- `GET /api/user-cards`: each card gains `rotating: RotatingBonusDTO[]` (this
  year and last, newest first) and `hasRotating: boolean`.
- `PUT /api/user-cards/[id]/rotating/[year]/[quarter]` body
  `{ multiplier, unit, categories, merchants, excludeMerchants, cap, activated }` upserts;
  `DELETE` removes. Validation: quarter 1–4, multiplier > 0, unit X|PERCENT,
  categories from the allowed list, merchants trimmed non-empty deduped,
  cap null or > 0. Request bodies get Swift tests asserting their JSON.

### Best Card

Both rankings (web `BestCards.tsx`, phone `Rewards.bestByCategory`) use an
effective rate that, for a card with an activated-or-not bonus in the
current quarter covering the category, is the bonus rate. (Builder's call
whether to also show "Q4" next to it.) The placeholder `ROTATING` row in
Best Card stays as it is.

### iPhone screens

- **Card page, Earning Rates:** below the rates, when the card has rotating:
  a row "Q4 2026 · 5% on Gas, Groceries, Amazon" (or "Q4 2026 · Not set
  up"), tapping opens the quarter form; a "Past Quarters" row listing earlier
  quarters when any exist.
- **Quarter form** (sheet): Rate, Unit, Categories (multi-select list of
  reward categories), Merchants and Excluded Merchants (add/remove text rows), Cap (decimal, blank =
  none), Activated toggle; Save / Cancel; Delete for an existing quarter.
  Defaults when new: the card's rotating rate and unit, cap 1500, not
  activated.
- **Benefits → Cards top section:** the two prompt kinds from goal 6, above
  To Review. Native list rows, no blurbs.

### Decisions made while writing this (author's calls)

- `computeEarnings` input rows gain `name` and `merchantName` (benefits.service
  already selects both). Merchants match per row; categories per split slice.
- The bonus **replaces** the normal rate for matching spend, taking the higher
  of the two (a 5% bonus on a 3% category pays 5%, never 8%; a lower bonus
  never reduces earnings). Best Card uses the same max.
- The part of a purchase past the cap earns its own category's normal rate
  (or the card's base rate), exactly as without a bonus.
- **Activated never gates math.** Earnings and Best Card count an entered
  quarter whether or not it is marked activated; the flag only keeps the
  "Set Up" prompt showing (with "Not activated") until the owner confirms.
- The cap counts only spend inside the earnings window (the card's benefit
  year); bonuses are loaded for every quarter that overlaps that window.
- `GET /api/user-cards` returns the card's bonuses from the last 8 quarters;
  older ones aren't reachable from the phone.
- "Current quarter" is device-local on the phone and server-local on the
  server.
- Bonus earnings rows get a unique `key` field (e.g. `ROTATING-2026-Q4`);
  clients key rows by it. Other rows' `key` equals their category.
- Best Card ignores how much of the cap is used.

## Constraints

- iOS rules in `ios/CLAUDE.md`; AGENTS.md (read the Next.js docs in
  node_modules before route code).
- Real data stays out of code, fixtures, docs and commits.
- Migration ships to friends' installs via `migrate deploy`; additive only.
- A locally merged migration is not applied by `Budget.command`; apply it
  with a backup and `prisma migrate deploy` before rebuilding.

## Left to the builder

Exact labels and copy beyond what's above, the JSON shape of
`RotatingBonusDTO`, how the merchant list is edited, and how "Ending Soon"
computes window ends (reuse `PerkReminders.windowEnd`).
