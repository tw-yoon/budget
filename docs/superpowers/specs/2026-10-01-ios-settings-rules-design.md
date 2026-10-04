# iPhone App — Settings → Rules Design

**Status:** Approved in chat 2026-10-01. Branch `ios-settings-rules`, cut from `main`.

**Goal:** Bring the web's Settings → Rules page (`src/components/RulesDashboard.tsx`) to the phone with full parity: list with outcomes, add, on/off, change category, delete, Apply now, and Use rule for these. The layout is native iOS: a list that pushes a detail screen, with a sheet for adding.

**Builds on:** `2026-09-27-ios-settings-mode-design.md` (Settings order: Mode → Categories → Rules → Connections) and `2026-10-01-ios-settings-categories-design.md`. Everything there still holds.

**No server changes.** These routes exist, and the web uses them: `GET`/`POST /api/rules`, `PATCH`/`DELETE /api/rules/:id`, `POST /api/rules/apply`, `POST /api/rules/:id/take-over`.

---

## Decisions already made

| Question | Decision |
|---|---|
| Scope | Full parity. The pattern, field and match type are read-only after creation, as on the web, even though PATCH would accept them. |
| Layout | Settings row → rule list → rule detail; Add Rule is a sheet. |
| Explainer | The web's amber box becomes the rules section's footer. Its subtitle line is dropped, as iPhone Settings pages have none. |
| Button names | Title case on the phone ("Apply Now", "Use Rule for These"). The footer names them that way too. |
| Delete | Swipe to delete, or a Delete Rule button on the detail screen. Neither asks first, matching the web. |
| Deliberate differences | A failed delete shows a banner (the web is silent). The empty state is iOS's "No Rules" view. |

---

## Screens

### Settings

A **Rules** `NavigationLink` goes in the same section as Categories, directly under it. It pushes `RulesView`.

### `RulesView` (list)

- **Apply section** (first): one button, **Apply Now**. While it runs, it shows a `ProgressView` and "Applying…", and it is disabled. The result goes to the store's `notice`.
- **Rules section:** the rows in server order (evaluation order). Each row has:
  - Line 1: `<Field label> <match label> "<pattern>"`. The labels are secondary and the pattern is monospaced, e.g. `Merchant or description contains "Sample Mart"`.
  - Line 2: `→ <category>` in footnote style.
  - Line 3, only when `outcome` is non-nil: the outcome line (see Wording), in footnote secondary.
  - A trailing on/off switch. Turning it sends `{enabled}`. A rule that is off is shown at 50% opacity.
  - Tapping the row pushes `RuleDetailView`. Swiping offers Delete, with no confirmation.
  - Footer: the explainer text (see Wording).
- **Empty:** `ContentUnavailableView("No Rules", systemImage: "wand.and.stars", description: Text("Tap + to add one."))`.
- **Toolbar:** a `+` button opens `AddRuleSheet`.
- **Pull to refresh** runs a GET-only reload, and clears any stale banner first.
- Notices and banners appear at the top, via the `Notice` and `Banner` pattern used by Categories.

### `AddRuleSheet`

- A `Form` with these fields:
  - **Field** picker, default `EITHER`.
  - **Match** picker, default `CONTAINS`.
  - **Pattern** text field, placeholder "Pattern (e.g. Starbucks)".
  - `CategoryFields`. Options come from `CategoryCatalog.names`, the category defaults to the first name, and the subcategory list comes from `catalog.subcategories(of:)`.
- **Add** is disabled until the trimmed pattern is non-empty and a category is picked. While saving it is replaced by a spinner.
- On success the sheet dismisses and the list reloads. On failure the server's message shows in a red section, and the fields are kept.

### `RuleDetailView`

It reads the rule from the store by id, and pops itself if the rule disappears.

1. **Match:** `LabeledContent` rows for Field, Match and Pattern, all read-only.
2. **Category:** `CategoryFields`, seeded from `CategoryPath.split(rule.category)`. The options are the catalog names, with the rule's current parent added at the front if it's missing (the web's TargetPicker). A **Save** button appears only when `CategoryPath.join(cat, sub)` differs from `rule.category`, and it sends `{category}`.
3. **On:** a `Toggle`, which sends `{enabled}`.
4. **Matches:** only when `outcome` is non-nil.
   - Rows: "Set by this rule", "Waiting for Apply Now" and "Set by hand (kept)", each with its count.
   - When `handSet > 0`, a **Use Rule for These** button. It confirms first (see Wording), then sends take-over, and the result goes to the notice.
5. **Delete Rule:** a destructive button. It deletes without asking, then the view pops.

## Wording (verbatim from `RulesDashboard.tsx` unless noted)

- `plural(n, word)` = `"\(n) \(word)"`, plus `"s"` unless n is 1.
- **Outcome line:**
  - When matched (applied + pending + handSet) is 0: `No matching transactions yet`.
  - Otherwise: `Matches N: ` followed by the non-zero parts, joined with ` · `:
    - `A set by this rule`
    - `P waiting for Apply Now` (the phone's button name)
    - `H set by hand (kept)`
- **Apply notice:** `Re-categorized <plural(updated,"transaction")>.`. When kept > 0, append ` <plural(kept,"matching transaction")> set by hand was|were kept.` (was when 1).
- **Take-over confirmation:**
  - Title: `Replace the category you set by hand on <plural(count,"transaction")> matching "<pattern>" with "<category>"?`
  - Message: `They'll follow this rule from then on.`
- **Take-over notice:** `"<pattern>" now sets <plural(updated,"more transaction")>.`
- **Toggle or category save failure:** the banner reads `Failed to update the rule.`
- **Footer** (phone button names): `Rules run top-to-bottom on each sync; the first match wins. They never overwrite a category you set by hand or one from Venmo, unless you tap Use Rule for These on a rule. Set a rule's category to Transfer to exclude matching transactions from spending. Tap Apply Now to run them over existing transactions.`
- **Labels:**
  - Field: `MERCHANT` → "Merchant", `NAME` → "Description", `EITHER` → "Merchant or description".
  - Match: `CONTAINS` → "contains", `EQUALS` → "equals", `STARTS_WITH` → "starts with", `REGEX` → "matches regex".
  - An unknown code shows as itself.

## Networking — `APIClient+Rules.swift`

| Call | Request | Body / result |
|---|---|---|
| `rules()` | `GET api/rules` | → `RulesResponse { rules: [RuleDTO] }` |
| `createRule(_ r: NewRule)` | `POST api/rules` | `{"field","matchType","pattern","category"}` |
| `setRuleCategory(id:_:)` | `PATCH api/rules/:id` | `{"category":…}` |
| `setRuleEnabled(id:_:)` | `PATCH api/rules/:id` | `{"enabled":…}` |
| `deleteRule(id:)` | `DELETE api/rules/:id` | — |
| `applyRules()` | `POST api/rules/apply`, timeout 60 | → `ApplyResult { updated, kept }` |
| `takeOverRule(id:)` | `POST api/rules/:id/take-over`, timeout 30 | → `TakeOverResult { updated }` |

- `RuleDTO`: `id, field, matchType, pattern, category, priority, enabled, outcome: Outcome?`, where `Outcome` is `{applied, pending, handSet}`. Extra keys (such as `createdAt`) are ignored.
- POSTs without a body send `{}`, as `refreshBalances` does.

## State — `Settings/RulesStore.swift`

- `@MainActor @Observable`, owned by `SettingsView` (`@State`), with the same `client` closure as the other stores.
- State: `data`, `error`, `isLoading`, `isSaving`, `isApplying`, `banner`, `notice`, plus `rule(id:)`.
- `load()` follows the store failure rules and has a generation guard.
- `perform(_ write: RuleWrite) async`:
  - The cases are `.setCategory(id:category:)`, `.setEnabled(id:enabled:)`, `.delete(id:)` and `.takeOver(id:)`.
  - It runs one write at a time and clears the banner and notice before sending.
  - On success it reloads, then sets its notice (only take-over has one).
  - On failure it sets the banner and reloads, so a switch the user flipped goes back to the server's value, as the web does.
  - Banner text on failure: `Failed to update the rule.` for setCategory and setEnabled; the server message for take-over and delete.
- `apply() async`: runs one at a time, clears messages first, then reloads, then sets the notice. A failure shows the server message as the banner.
- `add(_ r: NewRule) async throws(APIError)`: throws to the sheet; on success it reloads.
- `.cancelled` is always silent.
- `Support/RuleText.swift` holds the labels, `outcomeLine`, `applyNotice`, `takeOverTitle`, `takeOverMessage`, `takeOverNotice`, `footer`, `updateFailed`, and `categoryOptions(_ names: [String], current: String) -> [String]`.

## Tests

Under `StubbedNetworkTests` with `@Suite(.serialized)`; the pure suites need no stub.

- **Bodies:**
  - Each call's method, path and exact JSON.
  - PATCH sends only `category` or only `enabled`, never both.
  - The POSTs to apply and take-over send `{}`.
- **Decoding:** an `outcome: null` rule, and a rule with outcome counts, from an invented fixture `rules.json`.
- **Wording:**
  - The outcome line: zero matches, a single part, and all parts.
  - The apply notice: kept is 0, kept is 1 ("was"), kept is 2 ("were").
  - The take-over title, message and notice, including the singular "1 more transaction".
  - `categoryOptions` keeps a missing current category, at the front.
- **Store:**
  - A full-screen error versus a banner.
  - A successful load clears the banner.
  - A write clears stale messages before sending.
  - A failed toggle sets "Failed to update the rule." and reloads.
  - The take-over notice.
  - The apply notice, and a second apply while one is in flight sends nothing.
  - `.cancelled` is silent.

## Out of scope

- Editing the pattern, field or match type, and reordering by priority (the web has neither).
- Reloading the Activity ledger after Apply or take-over (the same open item as Categories).
- Connections, which gets its own spec.
- Checking real writes on the simulator; the owner does that.
