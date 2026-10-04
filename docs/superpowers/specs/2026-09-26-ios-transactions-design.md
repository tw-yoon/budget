# iPhone App — Transactions Design

**Status:** Approved in chat 2026-09-26. Branch `ios-transactions`, cut from `ios-accounts` at `39ee93a`.

**Goal:** Everything the web app's Transactions area does — the ledger, its row editor, and the Venmo and Zelle categorizers — as native SwiftUI screens in the iPhone app, calling the same API the web pages call.

**Builds on:** `2026-09-26-ios-accounts-design.md`. Everything there still holds: the server is the single source of truth, the app is a client, writes send only what changed, the app reloads on return to the foreground, nothing private is committed, and the phone's wording and rules match the web's.

**No server changes.** Every endpoint below exists and is used by the web today.

---

## Decisions already made

| Question | Decision |
|---|---|
| Native or embedded web pages | Native SwiftUI throughout |
| Scope | Full parity with the web Transactions area: Ledger, Venmo, Zelle |
| Row editing | A pushed detail screen, not an inline expand |
| Paging | Infinite scroll over the API's pages (50 per page) |
| Mode | The phone follows the shared Normal / Pro setting, as the web does |

Order of the remaining screens after this one: Analytics, Benefits, Subscriptions & Income, Settings (Categories, Rules, Connections, Mode). Connecting a bank (Plaid Link) needs Plaid's iOS SDK and is investigated when Settings → Connections is designed; until then it stays on the Mac.

---

## Navigation

- **Tabs.** `RootView` gains a Transactions tab (`list.bullet.rectangle`) between Accounts and Settings. Later screens add Analytics and Benefits tabs; iOS folds anything past five into its own **More** tab, which is where Subscriptions, Income and Settings end up. Nothing to build for that now beyond the tab order: Accounts · Transactions · Settings.
- **Inside Transactions,** a segmented control in the navigation bar switches **Ledger | Venmo | Zelle** — the web sidebar's three children. The selected segment is remembered (`@SceneStorage`). Each segment is its own view with its own store, so switching does not reload the others. Because the control sits in the bar's title position, the title is inline ("Transactions", shown by the tab) rather than large — the pattern Apple's own apps use for a segmented top-level switch. The control is the app's own `SegmentedSwitcher`, styled like the tab bar: the iOS 26 segmented `Picker` swelled under a tap and slid in from the left on every switch. A tap only moves the highlight. Each segment is as wide as its label, with even gaps.

---

## Ledger

### Screen

- Shares the Transactions `NavigationStack` and its segmented control (see Navigation).
- **Search:** `.searchable` pinned in the navigation bar's drawer (`.navigationBarDrawer(displayMode: .always)`), placeholder "Description or merchant". With the default placement the pull-to-refresh spinner drew over the search field. Debounced 300 ms (the web waits the same way before refetching) and trimmed; an empty field means no filter.
- **Toolbar, trailing:** only the **Filter** menu. (At most one trailing item per segment — Ledger's Filter, Venmo's Import CSV, none on Zelle — keeps the segmented control centred when there is one; the user asked for its position and the grey background to stay put when switching segments.) These buttons live in `SwitcherBar` with the switcher, so switching fades one out and the next in. The bottom search field likewise sits on TransactionsView (`LedgerSearchField`), holding its own text so a keystroke redraws only the field; it fades out on Venmo and Zelle and keeps what was typed.
- **Sync is pull-to-refresh** — the same gesture that refreshes balances on Accounts. Pulling the list down runs `POST /api/plaid/sync`, then reloads from page 1; a pull while a sync is running is ignored. Items with `success: false` are named in a banner, `"Couldn't sync <institution> (<error>)"`, joined with ", " (the Accounts refresh banner's wording). `skipped` items are not failures. The empty state scrolls too, so the first sync can be pulled from it.
- **Filter** (`line.3.horizontal.decrease.circle`, filled variant when anything differs from the defaults) — a `Menu` with:
  - **Account** — "All accounts" plus every account, grouped under its group label (from `GET /api/accounts`, the same source the web dropdown uses). If that call fails, the picker shows only "All accounts".
  - **Hide transfers & fees** — toggle, on by default (`hideInternal`).
  - **Show connected payments** — toggle, off by default. Off sends `hideLinked=true`, as the web does.
  - **Sort** — Date or Number (#), each Newest/Highest first or Oldest/Lowest first. Default Date, descending.
- Filter and sort choices persist per device (`@AppStorage`), like the web's in-page state but surviving a relaunch; search does not persist.
- **Count:** the list's section header — "250 transactions" (`total`), matching what the query returned. Singular for one.
- **Background:** the list is inset-grouped, like the Venmo and Zelle lists, so the grey background does not change between segments.
- **Infinite scroll:** page 1 loads first; when the last loaded row appears, the next page is requested, until `page == totalPages`. A spinner row sits at the end while a page is in flight. A failed next page shows a "Couldn't load more — Retry" row instead of the spinner; the rows already loaded stay.
- **Stale responses:** any change to search, filters or sort starts over at page 1 and discards responses from earlier queries (the generation-counter pattern `AccountsStore` uses).
- **Empty states** (`ContentUnavailableView`):
  - No transactions and no search/filter: "No Transactions" — "Connect an account on your Mac, then pull down here to sync."
  - Nothing matches the search or filters: the system `.search` variant, or "No Matches" with a **Clear Filters** button when filters are the cause.
- **Errors:** as in Accounts — full-screen "Can't Reach Budget" with Retry when nothing has loaded; a banner over data that is still showing.

### Query

`GET /api/transactions?page=&limit=50&sort=date|label&dir=asc|desc&hideInternal=true|false&hideLinked=true|false[&search=][&accountId=]` → `TransactionsResponse { transactions, page, limit, total, totalPages }`. Pages are appended in order; a row id already present is not appended twice (a sync between page requests can shift rows across a page boundary).

### Row

```
Sample Mart                            −$120.00
#101 · Sep 23, 2026 · Sample Rewards Card ··0002
[Pending] [Split 2 ways]
Groceries › Organic  CUSTOM
```

- **Line 1:** `merchantName ?? name` (up to two lines, then truncated); amount on the right in monospaced digits. Money out (`amount > 0`) prints as the web's `formatSignedAmount` does, money in is green. When `refunds` is non-empty, "net $X" (`netAmount`) sits under the amount in green, as on the web.
- **Line 2:** `#label · date · accountName ··mask` in secondary text; "—" for a null label.
- **Badges** (small capsules, wrapping), in the web's order and wording: Venmo (source VENMO), Zelle (not Venmo and the name matches the web's `isZelleName`), `→ #N` (linked, green), Pending (amber), Transfer (when not a breakdown row), "N categories" (breakdown), "Split N ways" / "Split 1 way" (amber when `splitRemainder < 0`), Fee.
- **Category line:** the web's `categoryLabel` — `Parent > Sub` for a user override with a sub, the parent alone, or `categoryDetailed ?? category` — plus a CUSTOM tag when `userCategory` is set. A linked row shows its inherited category with a lock (`lock.fill`) instead of CUSTOM.
- Pending rows render their text in secondary style.
- Tapping a row pushes its detail screen. Rows are not editable in place.

### Porting from the web

The phone must reproduce these web helpers exactly and test them against the same cases:

- `formatSignedAmount` (`src/lib/format.ts`) — sign and colour of an amount.
- `isZelleName` (`src/lib/zelle.ts`) — the Zelle badge.
- `categoryLabel` / the row's override resolution (`resolveRow` in `TransactionTable.tsx`).
- `isSplittable` — `amount > 0 && !pending`.
- `splitCategory` / `joinCategory` (`src/lib/categories.ts`) — the `"Parent > Sub"` encoding.

---

## Transaction detail (pushed)

Title: the merchant name, inline display mode. A `Form` with these sections, in order; a section that does not apply is not shown.

1. **Summary** — amount (large, signed as in the row), date, account, `#label`, Pending if pending, and the Plaid name when a merchant name is shown in the title. `personalNote` when present.
2. **Category** — not shown for a linked row (see Link).
   - **Category** `Picker`: the user's categories (from `GET /api/categories`), plus the row's current category and its Plaid category if either is missing from that list — the web's `categoryOptionsFor`. Sorted.
   - **Subcategory:** a `Picker` of the chosen category's known subcategories (declared in Settings, plus any used by rows loaded this session and any saved this session — the web's `knownSubs`), a "None" option, and **Other…**, which reveals a text field for a new one.
   - **Save** (toolbar) sends `PATCH /api/transactions/:id` `{ category, subcategory }` with only what the user picked; disabled until something changed. **Use Bank's Category** (a destructive-style button, shown when `userCategory` is set) sends `{ category: null }`, the web's Reset.
   - The server refuses a category write on a linked row (404) — the phone never offers one.
3. **Link** — only for money-in rows (`amount < 0`), as on the web.
   - Linked: "Linked to #N — Name" with the purchase's category, and **Unlink** → `PATCH { linkedToLabel: null }`. While linked the row's category is the purchase's and the Category section is hidden, with a footer saying so.
   - Not linked: **Connect to a Purchase…** (the web's wording) pushes a list from `GET /api/transactions/:id/link-candidates` → `{ candidates: [{ id, label, date, name, amount, category }] }`, best first (the server searches the 90 days before the refund). Tapping one sends `PATCH { linkedToLabel: <label> }`. An empty list says the web's "No likely purchase found — enter a number below." Below the list, as on the web, a number field links by a typed serial (`#`), sending the same PATCH.
4. **Splits** — the web's `SplitPanel` and `AddSplitForm`.
   - Shown when the row has splits, or when it is splittable and the mode is Pro.
   - Lists each part (category › sub, amount) and the leftover ("<category> (rest)", `splitRemainder`) when there is one. A negative leftover is shown in amber with the web's explanation that the transaction's amount changed and is now smaller than its splits.
   - **Pro:** swipe a part to delete it (`DELETE /api/transactions/:id/splits/:splitId`); **Add Split** (splittable rows only) opens a sheet with Amount (decimal pad, must be > 0 and no more than what is left) and the same Category/Subcategory pickers as above, and sends `POST /api/transactions/:id/splits { amount, category, subcategory }`. The server's 400 message is shown verbatim on refusal.
   - **Normal:** parts are read-only, with the web's footnote that splits still count toward totals in Normal mode and Pro mode is where they are changed.
   - The web also offers "Split" from the category editor of an unsplit row; on the phone the Add Split button in this section is that entry point.
5. **Refunds** — the linked refunds (`refunds`), each `#label · date · amount`, and the net amount. Read-only.
6. **Venmo breakdown** — for a cash-out deposit with `breakdown`: each slice (category, amount) and the prior balance, as the web's `BreakdownPanel` shows. Read-only.

After any successful write the detail screen reloads that row's state (by reloading the ledger query it came from and re-reading the row by id) and the ledger list reflects it when popped back to. A failed write shows an alert with the server's message and leaves the form as the user left it.

---

## Venmo and Zelle

One view, `P2PCategorizerView`, parameterised by endpoint — the web's `P2pCategorizer`.

- `GET /api/venmo` or `/api/zelle` → `{ transactions: P2pTx[], categories: string[] }` where `P2pTx = { id, label, date, note, counterparty, direction: "in"|"out", amount, category, linkedTo }`.
- **Totals header:** three figures — Sent (categorized), Received (categorized), Net spend — excluding rows whose category is Uncategorized or Transfer, exactly as the web computes them.
- **Rows:** counterparty (or "—"), note (or "—"), `#label · date`, amount with "+" / "−" and green for money in; a category `Menu` listing `categories` plus the row's own category if it is not in the list. Uncategorized and Transfer read in secondary style. A linked row's category is locked, as on the web.
- **Changing a category** updates the row immediately and sends `PATCH /api/venmo/:id` (or `/api/zelle/:id`) `{ userCategory }`. On failure: the server's message in a banner, then a reload — the web's behaviour.
- **Money-in rows** get the same Connect to a Purchase flow as the ledger's detail screen, from a **Connect…** link on the row (the web embeds `TransactionLinkPicker` here too).
- **Venmo only:** an **Import CSV** toolbar button → `POST /api/venmo/import`; the notice "Imported N payments · reconciled M cash-out(s)." on success, then a reload. The server reads the CSVs from its own Downloads folder, so the empty state keeps the web's hint: drop `VenmoStatement_*.csv` exports in the Mac's Downloads folder, then Import.
- Zelle's empty state: "Nothing to categorize yet" with the web's hint that Zelle payments arrive automatically with the bank sync.

---

## Shared pieces

- **`APIClient`** grows one method per call above, all through the existing `send` / typed `APIError` path, including the cancellation handling added in Accounts.
- **`CategoryCatalog`** (`@MainActor @Observable`): loads `GET /api/categories` once per foreground, exposes category names and each one's subcategories, and records subcategories used or saved this session. Shared by the ledger detail, the split sheet, and later the Rules screen. If it fails to load, pickers fall back to the categories visible on loaded rows.
- **`ProMode`** (`@MainActor @Observable`): reads `GET /api/ui-state?key=pro-mode`, falling back to the legacy `analytics-mode` key, resolved exactly as `resolveProMode` does (only the string `"pro"` is Pro). Read on launch and on return to the foreground. Until it has loaded, the phone behaves as Normal (the web's rule: never show a Pro control that might vanish). Changing the mode stays in Settings → Mode, a later screen.
- **`TransactionsStore`**: query state, pages, the generation counter, sync, and row lookup by id.
- **`P2PStore`**: one per endpoint; optimistic category changes with reload on failure.

---

## Testing

**Unit (Swift Testing):**

- Every suite that uses the shared URL-protocol stub nests under one `.serialized` parent suite; two stubbed suites running side by side answer each other's requests.
- Decoding `TransactionsResponse`, `P2pResponse`, link candidates and the categories response from invented fixtures that include a split row with a negative remainder, a linked refund, a purchase with refunds, a Venmo cash-out breakdown, and a pending row.
- Ports: `formatSignedAmount`, `isZelleName`, `categoryLabel`, `splitCategory`/`joinCategory`, `isSplittable`, `categoryOptionsFor`, the P2P totals — each against the cases the web's own tests use where they exist (`scripts/test-*.mjs`).
- Query building: every filter/sort combination produces the web's parameters.
- Paging: append in order, de-duplicate ids, stop at `totalPages`, a failed next page keeps loaded rows, a query change discards in-flight pages.
- Request bodies: category set / reset, link / unlink, add split, delete split, P2P category — exact JSON.
- Pro mode resolution including the legacy key.

**In the simulator (iPhone 17 Pro), against a running server,** read-only unless the user runs the write checks: the ledger's first page, count and badges match the web page for the same filters; search, filters and sort; infinite scroll to the last page; a row's detail sections; Venmo and Zelle lists and totals match the web. Write checks (category change, link, split, P2P category, Sync, Import) are listed for the user to run, as in Accounts.

---

## Out of scope

Anything outside Transactions (the next screens); Plaid Link; changing Normal/Pro from the phone; bulk editing; offline cache.
