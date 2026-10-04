# iPhone App — Settings → Categories Design

**Status:** Approved in chat 2026-10-01. Branch `ios-settings-categories`, cut from `main`.

**Goal:** Bring the web's Settings → Categories editor (`src/components/SettingsCategories.tsx`) to the phone with full parity: add, rename, merge, delete, Plaid-primary mapping, and subcategories (add, rename, merge, delete, reset). The layout is native iOS (a list that pushes a detail screen), not the web's table.

**Builds on:** `2026-09-27-ios-settings-mode-design.md` (Settings order: Mode → Categories → Rules → Connections, one spec each). Everything in the earlier iOS specs still holds.

**No server changes.** All routes exist and the web uses them today: `GET`/`POST /api/categories`, `PATCH`/`DELETE /api/categories/:id`, `POST`/`PATCH`/`DELETE /api/categories/:id/subcategories`.

---

## Decisions already made

| Question | Decision |
|---|---|
| Scope | Full parity with the web editor. |
| Layout | Settings row → category list → category detail. iPhone Settings patterns, not the web's table. |
| Merge confirmation | An alert with the web's exact `confirm()` wording; confirming re-sends with `allowMerge: true`. |
| Plaid labels | Raw primary codes (e.g. `FOOD_AND_DRINK`), as the web shows them. `humanizePfc` is ported only for the unmapped warning. |
| Delete with reassign | Not offered. The web never sends `reassignTo`; neither does the phone. |
| Pro Mode | Categories shows the same thing in Normal and Pro. |

---

## Screens

### Settings

`SettingsView` gains a **Categories** `NavigationLink` row in its own section, between Pro Mode and Server. It pushes `CategoriesView`.

### `CategoriesView` (list)

- **Unmapped warning:** when `unmappedPrimaries` is non-empty, the first section shows the web's amber notice:
  - "`N` Plaid label(s) not mapped to a category: `Humanized (count)`, …." (singular "label" when N is 1)
  - "Those transactions report under Plaid's own wording instead of one of your categories, and won't follow if you rename a category later."
- **Rows:** one per category, in the server's order. The name, then a secondary line copying the web's "Used by" cell: `R tx (D direct) · N rule(s) · N split(s)`. `(D direct)` appears only when `resolvedTransactionCount != transactionCount`; "rule"/"split" are singular at 1.
- **Add:** a `+` toolbar button opens an alert with a text field ("New category") and Add/Cancel. Empty or whitespace-only input sends nothing.
- **Delete:** swipe → Delete, then a confirmation with the web's text: `Delete "Name"?` plus ` Its N subcategor(y|ies) will go too.` when any subcategory is `declared`. Transfer has no swipe action.
- **Tap** pushes `CategoryDetailView` for that category id. The detail reads the category from the store by id, so it updates after every reload; if the id disappears (merged or deleted), the detail pops.

### `CategoryDetailView`

1. **Name** — a `TextField` that saves on submit (Return). Unchanged or empty input sends nothing and restores the name. For Transfer the name is plain text, with footer: "\"Transfer\" controls how transactions are excluded from spending — it cannot be renamed or deleted".
2. **Subcategories** — one row per subcategory:
   - Name, with a "Plaid" badge when `plaidLabels` is non-empty; when `renamed`, the badge reads `Plaid: <names joined by ", ">`.
   - Secondary line: `T tx (D direct) · N rule(s)`, where T = `transactionCount + plaidTransactionCount`, and `(D direct)` appears only when both parts are > 0.
   - Tap → an alert with a text field to rename (pre-filled).
   - Swipe action only when `isDeletable`: labelled **Reset** when `isResetOnly`, else **Delete**. Reset runs without a confirmation; Delete confirms with the web's text (in-use counts line and the renamed-Plaid line as applicable).
   - A last row, **Add Subcategory**, opens an alert ("New subcategory of Name").
3. **Plaid Labels** — every code in `primaries`, with a checkmark when it is in this category's `plaidPrimaries`. Tapping toggles it and sends the full new list.
4. **Delete Category** — a destructive button, with the same confirmation as the list's swipe. Disabled for Transfer.

### Messages

- Success messages show as the shared `Notice` (as Subscriptions does), on whichever screen is showing: the list and the detail both read the store's `notice` and `banner`.
- Errors show as `Banner`, under the store failure rules below.
- Notice wording copies the web exactly:
  - Rename: `Renamed — N transaction(s)[ and N split(s)] updated.`
  - Merge: `Merged into "Name" — N transaction(s)[ and N split(s)] moved.`
  - Subcategory delete that moved rows: `Deleted — N transaction(s)[ and N split(s)] moved back to "Name".`
  - Subcategory reset: `Back to Plaid's name.`
  - Add, create-sub, mapping toggle and category delete show no notice (the web shows none).

### Merge alerts

When a rename returns 409 with `merge: true`:

- Category: title `Merge "Old" into "Target"?`, message `R transaction(s)[ and S split(s)] will report as "Target" instead, and "Old" will be removed.` (R = `movingResolved`, S = `movingSplits`, shown only when > 0).
- Subcategory: title `Merge "Old" into "Target"?`, message `T transaction(s) and R rule(s) will move to "Category > Target".`
- **Merge** re-sends the same rename with `allowMerge: true`; **Cancel** sends nothing.

## Networking

### `sendRaw`

`APIClient.send` discards every non-2xx body except `{ error }`. Categories needs two richer bodies (the merge prompt and the delete-in-use counts). `send` is split:

- `sendRaw(...) async throws(APIError) -> (status: Int, data: Data)` does the request and maps transport failures and cancellation exactly as `send` does today, but returns any HTTP status.
- `send` calls `sendRaw` and keeps its current behaviour for non-2xx. Existing callers do not change.

### `APIClient+Categories.swift`

| Call | Request | Body |
|---|---|---|
| `categoriesAdmin()` | `GET api/categories` | — |
| `createCategory(name:)` | `POST api/categories` | `{"name":…}` |
| `renameCategory(id:name:allowMerge:)` | `PATCH api/categories/:id` | `{"name":…,"allowMerge":…}` |
| `setPlaidPrimaries(id:_:)` | `PATCH api/categories/:id` | `{"plaidPrimaries":[…]}` |
| `deleteCategory(id:)` | `DELETE api/categories/:id` | — |
| `createSubcategory(categoryId:name:)` | `POST api/categories/:id/subcategories` | `{"name":…}` |
| `renameSubcategory(categoryId:from:to:allowMerge:)` | `PATCH api/categories/:id/subcategories` | `{"from":…,"to":…,"allowMerge":…}` |
| `deleteSubcategory(categoryId:name:)` | `DELETE api/categories/:id/subcategories?name=…` | — |

- Names are sent trimmed. Each body carries only its own fields.
- The two renames return `RenameOutcome`: `.done(RenameResult)` on 2xx, or `.needsMerge(MergePrompt)` on a 409 whose body has `merge: true`. Any other non-2xx throws `.server` as usual.
- `deleteCategory` on a 409 whose body has `transactionCount` throws `.server(status: 409, message:)` with the web's text: `Still used by T transaction(s), R rule(s), M Plaid label(s) and S split(s) — rename this category onto another one to merge them first.`
- `deleteSubcategory` returns `{ movedTransactions, movedSplits, resetPlaidLabels }` for the notice.

### Models (`Models/CategoryModels.swift`)

Codable mirrors of the GET response — `AdminCategory`, `AdminSubcategory`, `UnmappedPrimary`, `CategoriesAdminResponse` — with property names equal to the JSON keys. The ledger's slim `CategoriesResponse` stays as it is.

## State — `Settings/CategoriesStore.swift`

`@MainActor @Observable`, owned by `SettingsView` (`@State`), with the usual `client` closure.

- `data`, `error` (only while nothing is loaded), `banner`, `notice`, `isLoading`, `isSaving`.
- `load()` is generation-guarded. With nothing loaded an error is full-screen; with data showing it becomes a banner and the data stays. A successful load clears the banner. `.cancelled` is silent.
- Each write: returns early if `isSaving`; clears `banner` and `notice` before its request; sends; on success reloads, then sets its notice (if any) so the reload doesn't wipe it; on failure sets `banner` and does not reload (as the web). One write at a time.
- Renames return the `MergePrompt` to the view when the server asks; the view shows the alert and calls the rename again with `allowMerge: true`.
- After any successful write, the store calls a hook that reloads the ledger's `CategoryCatalog`, so the pickers see the change. `RootView` wires the two together.
- `Support/CategoryRules.swift` ports the web's `isResetOnly`, `isDeletable`, the reserved `Transfer` name, the count lines and the notice/confirm strings. `Support/Formatters.swift` gains `humanizePfc` (port of `../src/lib/format.ts`, with its `ACRONYMS` and `LOWERCASE_WORDS`).

## Accessibility sizes

At `dynamicTypeSize.isAccessibilitySize` the count lines wrap freely (they are text, not amounts); no row has a label/amount pair.

## Tests

`CategoriesTests.swift`, nested under `StubbedNetworkTests` with `@Suite(.serialized)`:

- **Request bodies:** each call's method, path and exact JSON; the subcategory delete's percent-encoded `name` query; renames send `allowMerge: false` first and `true` after confirming.
- **409 handling:** a merge body decodes to `.needsMerge` with the target and counts; a delete-in-use body becomes the web's "Still used by…" message; a 409 without `merge` stays `.server`.
- **Wording:** rename, merge, split-count variants, subcategory delete and reset notices; both merge alert texts; delete confirmations with and without declared subcategories.
- **Store:** full-screen error vs banner; a successful load clears the banner; writes clear a stale banner before sending; a failed write is a banner with no reload; overlapping loads keep only the newest; `.cancelled` is silent; a second write while one is in flight sends nothing.
- **Ports:** `isResetOnly`, `isDeletable`, `humanizePfc` (acronyms, lowercase joiners).
- **`sendRaw`:** existing `send` callers still see `.server` with the `{ error }` message.

All fixtures use invented names (`Sample Groceries`, `Example Dining`).

## Out of scope

- Rules and Connections — their own specs, in that order.
- Delete-with-reassign (`reassignTo`), which the web doesn't offer either.
- Checking real writes on the simulator. The live server holds real data; the owner does that.
