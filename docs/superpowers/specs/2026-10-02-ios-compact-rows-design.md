# iPhone Activity: compact rows

Phone-only; the web has no equivalent.

## What

Activity's three lists (Ledger, Venmo, Zelle) get a second, one-line row
density. Pinch in on a list for compact rows; pinch out to return to the
full rows. One setting, shared by all three segments, kept per device
(`@AppStorage("transactions.compactRows")`).

## Rows

- **Ledger, compact:** ledger number ("#752"), short date ("Sep 29"),
  title, amount on one line.
  Pending rows stay greyed. Badges, the detail line and the category line
  drop out; the row still opens the transaction's detail screen.
- **Venmo / Zelle, compact:** number, short date, counterparty, amount. Tapping a
  compact row expands just that row to the full layout (category menu,
  Connect…); tapping its header line collapses it again.
- **Accessibility sizes:** the title gets its own line and the date and
  amount sit under it; amounts never wrap mid-number.

## Switching

- A pinch switches only once it passes 15% (scale below 0.85 → compact,
  above 1.15 → full), so it snaps between the two densities and a stray
  two-finger touch does nothing. Recognised alongside scrolling.
- The list keeps its place: the topmost visible row stays at the top
  after the switch.
- iOS 26 holds list rows at a 52 pt minimum and ignores listRowInsets and
  defaultMinListRowHeight on these rows, so a compact row is 52 pt: about
  12 per screen instead of 4–5.
- Not gesture-only: the ledger's filter menu has a **Compact Rows** toggle,
  and each list carries an accessibility action to switch.

## Motion (2026-10-02)

Each list draws its density from its own `@State`, changed inside a soft
spring (`CompactRows.motion`); `CompactRowsSync` keeps it and the saved
`@AppStorage` setting in step. (Drawn straight from `@AppStorage`, a switch
arrived outside any animation and snapped in one frame.) Ledger rows are one
view for both densities (`TransactionRow(compact:)`), so a switch morphs each
row: title and amount glide, number and date slide in at the leading edge,
the lower lines fade, and the row's height animates.

The list follows a pinch while it is under way (`CompactRows.liveScale`, at
most 10% either way) and settles on release in the same spring. The ledger is
drawn as an inset-grouped list with a lazy stack rather than a List, because a
List snaps rows to their new height; the pinch is a high-priority gesture so
its two fingers never press a row. (This supersedes the 52 pt List-row note
above for the ledger: its rows keep a 52 pt minimum by their own frame.)

