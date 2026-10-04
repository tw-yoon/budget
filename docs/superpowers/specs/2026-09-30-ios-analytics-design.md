# iPhone App — Analytics Design

**Status:** Approved in chat 2026-09-30. Branch `ios-analytics`, cut from `main`.

**Goal:** Bring the web's Analytics page (`src/components/AnalyticsDashboard.tsx`) to the phone as a fourth tab: the summary cards, spending by category, monthly spending vs income, and (Pro only) the cumulative Spending graph with its editable monthly limit.

**Builds on:** `2026-09-26-ios-accounts-design.md`, `2026-09-26-ios-transactions-design.md` and `2026-09-27-ios-settings-mode-design.md`. Everything there still holds.

**No server changes.** Every route used here exists, and the web uses each of them today.

---

## Decisions already made

| Question | Decision |
|---|---|
| Scope | Everything on the web page. The Cash-flow Sankey was added later (see below). |
| Top merchants | Not shown. The API returns them, but the web page does not show them either. |
| Spending limit | Editable on the phone and shared with the web through `/api/ui-state` key `spendingMonthlyLimit`. |
| Charts | Swift Charts (`SectorMark`, `BarMark`, `AreaMark`, `LineMark`, `RuleMark`). No third-party packages. |
| Pull-to-refresh | Reloads the three analytics GETs only. Analytics never calls Plaid. |
| Normal mode | Hides the Cash-flow Sankey and the Spending graph and shows the web's footnote. The phone's footnote points to Settings, which has no link target on iOS, so it is plain text. |

---

## Project layout

New files (folder-synchronized groups; no project file edits):

| File | What it holds |
|---|---|
| `Models/AnalyticsModels.swift` | `AnalyticsSummary`, `AnalyticsResult` (summary only is decoded; other keys ignored), `CashflowMonth`, `CashflowSeries`, `DailySpend`, `SpendingSeries`. Property names equal the JSON keys in `../src/types/index.ts`. |
| `Networking/APIClient+Analytics.swift` | `analytics(months:)`, `cashflow()`, `spending()`. |
| `Support/MonthWindow.swift` | Port of `useMonthWindow` / `clampView` (`../src/components/charts/useMonthWindow.ts`) as a value type. |
| `Support/CategoryColors.swift` | Port of `categoryColor`, `INCOME_COLOR`, `DRAW_COLOR`, `HUB_COLOR` (`../src/lib/colors.ts`). |
| `Support/CategoryBreakdown.swift` | Port of `CategoryChart`'s per-category sum and `fold`, plus the legend's percentage. |
| `Support/SpendingMath.swift` | Pure port of `SpendingGraph`'s `useMemo` math (`../src/components/charts/SpendingGraph.tsx`). |
| `Analytics/AnalyticsStore.swift` | `@MainActor @Observable` store for the three loads and the limit. |
| `Analytics/AnalyticsView.swift` | The tab's screen. |
| `Analytics/ChartCard.swift`, `SummaryGrid.swift`, `CategoryChartCard.swift`, `MonthlyTrendCard.swift`, `SpendingGraphCard.swift`, `WindowNav.swift`, `LimitSheet.swift` | One view each. |

Changed files:

- `App/RootView.swift` adds `Tab("Analytics", systemImage: "chart.pie")` between Transactions and Settings, passing `proMode`.
- `Networking/APIClient+Settings.swift`: `putUIState` takes `value: some Encodable & Sendable` instead of `String`. The existing Pro Mode call keeps sending a string, and its body test keeps passing unchanged.
- `Networking/APIClient+Transactions.swift`: `UIStateValue` gains `number: Double?`. It is set when the value is a JSON number, or a non-empty string that parses as a number, which is the web's `v != null && v !== "" && !isNaN(Number(v))`.

## Networking

| Call | Route | Notes |
|---|---|---|
| `analytics(months: Int)` | `GET /api/analytics?months=N` | N is 3, 6 or 12. |
| `cashflow()` | `GET /api/analytics/cashflow` | 24 months, oldest first. Fetched once per load; the category and trend charts window over it locally, as on the web. The `cash` field is ignored (Sankey only). |
| `spending()` | `GET /api/analytics/spending` | Days with spend activity only, oldest first. Loaded only in Pro mode. |
| `uiState("spendingMonthlyLimit")` | `GET /api/ui-state?key=…` | Existing call. |
| `putUIState(key: "spendingMonthlyLimit", value: Double)` | `PUT /api/ui-state` | Body `{"key":"spendingMonthlyLimit","value":2500}`; `value` is a JSON number, as the web sends. |

## State — `AnalyticsStore`

Holds `range` (3/6/12, default 6), `summary`, `cashflow`, `spending`, `limitOverride: Double?`, `banner: String?`, and a `fullScreenError` used only while nothing has loaded.

- **`load(isPro:)`** runs the summary and cash-flow GETs, plus spending and the limit when `isPro`, one after another (local network; it keeps `throws(APIError)` and the generation guard simple). Each section keeps its own data, and the first failure decides the message.
- **Changing `range`** reloads the summary only. While it loads, the old cards stay, dimmed, as the web's `opacity-60`.
- **Turning Pro on** (observing `proMode.isPro`) runs `load(isPro: true)` when spending has not loaded yet.
- **Failure rules** are the usual ones: with nothing loaded, an error is full-screen with Try Again; with data showing, it becomes a banner and the data stays. A successful load clears the banner. Pull-to-refresh clears a stale banner before its calls. `.cancelled` is silent. A generation counter drops overlapping loads.
- **A failed limit read** is silent, and the current limit stays. A read that succeeds with null or an unusable value clears the override, so the computed default limit is used again, as on the web. That covers a limit cleared on another device or a different server.
- **`saveLimit(_ value: Double)`** sets `limitOverride` at once, then PUTs. It sends nothing when the value equals the current limit. A failed PUT shows a banner: "Couldn't save the limit to the server." The value stays on screen. This differs from the web, which fails silently into localStorage; the phone has no local fallback, so the next load would quietly undo the change. This is the same reasoning as the Pro Mode save.

## Screen

`AnalyticsView` is a `NavigationStack` with large title "Analytics" and a `ScrollView` on the grouped grey background. Each card is a rounded `secondarySystemGroupedBackground` panel. In order:

1. **Summary.** The caption "Summary over the last N months", then a segmented `Picker` (3m / 6m / 12m), then a 2×2 `SummaryGrid`: Spent, Income, Net, Transactions. Income is green. Net is `+$…` and green when ≥ 0, and red when negative (`SummaryCards.tsx`). At accessibility sizes the grid becomes one column.
2. **Spending** (Pro only). See below.
3. **Spending by category.** The header shows the month label ("Jun 2026") and `WindowNav` with pan only. *(Revised 2026-10-01: always one month; the web can zoom out, the phone cannot.)* It opens on the latest month. The chart is a `SectorMark` donut (inner radius ratio 0.7, angular inset for the web's padding) with "Total" and the amount in the centre. The legend below lists colour, category, whole-number %, and amount. Slices are folded to the top 8 plus "Other", using the web's `fold`, which adds the tail to an existing "Other". The empty state reads "No spending in {range}." The cards show it only for a cash flow that loaded. While it has not loaded, one card-styled panel stands in for both this card and the monthly trend: a spinner while a load is running, otherwise "Couldn't load cash flow."
4. **Monthly spending vs income.** A range label and `WindowNav` with pan and zoom, capped at 3 months (`MonthWindow`'s `maxSpan`). It opens on the last 3 months. *(Revised 2026-10-01: the web opens on 6 and has no cap.)* Grouped `BarMark`s show Income (`INCOME_COLOR`) and Spent (`HUB_COLOR`). The x axis uses short month names and the y axis compact currency (`$1.2K`), with a legend.
5. **Normal mode only:** a footnote reading "Cash flow and cumulative spending are hidden in Normal mode — switch to Pro in Settings." (the web's text)

`WindowNav`'s icons share one Dynamic-Type-scaled frame, so every button is the same size. It shows `‹ ›` (accessibility labels "Earlier" / "Later") and, when zoom applies, `− +` ("Fewer months" / "More months"), each disabled per `MonthWindow`'s `canEarlier` / `canLater` / `canZoomIn` / `canZoomOut`. Each chart keeps its own window.

Charts show a selection readout on tap or drag (`chartXSelection` / `chartAngleSelection`) in place of the web's hover tooltip. The readout has a solid system background and primary text; a material inside a chart annotation renders black. Amounts never wrap mid-number.

## Spending graph (Pro)

`SpendingMath` is a pure port, taking `days`, the selected month, the compare mode, the limit and "today":

- **Months:** every calendar month from the first to the last data month, labelled "June 2026".
- **Cumulative:** daily running totals for the selected month, rounded to cents. For the current month, values stop at today's date.
- **Average:** for each day index 1…31, the mean of the cumulative totals of complete (past) months that have that day.
- **Compare:** the cumulative series for the previous month ("Last month") or the same month a year earlier ("Last year").
- **Default limit:** the mean total of past months with spend above 0, rounded to the nearest 250, at least 500, or 3000 when there is no history.
- **Y ceiling:** `niceCeil(max(limit, peak, avg…, compare…, 0) × 1.06)`.
- **X ticks:** 1, 5, 10, 15, 20, 25 and the last day.

The header shows "Spending", the month label, a **Limit $X** button that opens `LimitSheet`, a segmented Last month / Last year picker, and `WindowNav` with pan only. It opens on the latest month.

The chart draws:
- the average as a grey solid line;
- the comparison month as a darker grey dashed line;
- this month as an `AreaMark` with a line. Both are green below the limit and red above it, split at the limit with a vertical gradient. When the line never crosses the limit it is solid green or solid red, with no gradient, matching the web's hairline fix;
- the limit as a dashed `RuleMark` labelled "Limit $2.5K".

The legend below reads "This month $X", "Average", and "Last month" or "Last year". The status line reads "$X left of the $Y limit" in green, or "$X over the $Y limit" in red. The empty state reads "No spending in {month}." when the selected month's peak is 0. While spending has not loaded the card shows a spinner during a load, otherwise "Couldn't load spending."

`LimitSheet` is a small sheet with a currency `TextField` (decimal pad), plus Cancel and Save. Save clamps negatives to 0 and calls `store.saveLimit`. Save is disabled while the text is not a number. The web would save 0 for that; the phone does not.

## Tests

Pure suites (no network):
- `AnalyticsSupportTests`: `MonthWindow` (clamping, default span, pan and zoom bounds, the `maxSpan` cap, the `can…` flags, range labels); the category fold (fewer than 9 slices left alone, the tail folded into a new or an existing "Other"), slice sums, ties, percent and angle selection; `CategoryColors` (fixed-map hits, the hash staying stable for an invented category); `compactCurrency`, `mathRound` and `clamp`.
- `SpendingMathTests`: cumulative with gaps; the current month stopping at today; average over complete months only; compare across a year boundary (January → previous December); the default limit (rounding, the 500 floor, the 3000 fallback); `niceCeil` steps; ticks for 28-, 30- and 31-day months; a month outside 1 to 12 in the data not crashing.
- `SummaryTileTests`: the tiles, and Net sign and tone.
- `AnalyticsModelTests`: decoding the summary, cash-flow months and daily spend; `UIStateValue.number` for a number, a numeric string, `""`, a non-numeric string and null.

Stubbed suites, nested under `StubbedNetworkTests` with `@Suite(.serialized)`:
- `AnalyticsAPITests`: each endpoint's path and the range query; a numeric limit sent as a JSON number.
- `AnalyticsStoreTests`:
  - Store rules: full-screen error with nothing loaded; a banner over data; success clearing the banner; pull clearing a stale banner first; `.cancelled` silent; a stale generation dropped; spending not requested in Normal mode.
  - Limit: the PUT body JSON is exactly `{"key":"spendingMonthlyLimit","value":2500}`; nothing is sent for an unchanged value; a failed PUT keeps the value and shows the banner; a cleared stored limit falls back to the default on the next load; a failed read keeps the current value.
- The existing Pro Mode PUT body test stays green after the `putUIState` signature change.

Fixtures use invented categories and amounts only (`Sample Mart`, round numbers).

**Simulator checks:** GET only against the live server. Never edit the limit or pull to refresh there. The owner does the limit write check.

## Cash-flow Sankey

`Analytics/CashFlowSankeyCard.swift` ports `../src/components/charts/CashFlowSankey.tsx`; its data model (`buildModel`, `foldTail`) is `Support/CashflowSankey.swift`. Pro mode only, above the Spending graph, as on the web. Drawn with `Canvas` (Swift Charts has no Sankey).

Where the phone differs:

- One month's Sankey on screen at a time. The card opens on the latest month; the arrows pan; there is no − / + zoom and no drag to pan.
- A tap on a band, node or the hub shows the readout the web shows on hover; a second tap, or a tap elsewhere, hides it.
- Subcategories always branch out when a month has them (the web draws that stage only at 560 px and wider).
- Nodes are wide columns (19% of the width each) that hold their own names, instead of thin bars labelled beside them. The two columns (three with subcategories) and the hub run edge to edge, with the same ribbon run between each pair. Text is black or white by the node colour's brightness; a node under 11 pt tall has no name (a tap reads it).
- Names are fitted to the column, measured rather than cut at a fixed character count: one line when it fits; else name above amount on a tall enough node; else a shortened name (at least five letters) with the amount; else the name alone; else the amount.

## Out of scope

- Top merchants.
- Widgets, or exporting charts.
