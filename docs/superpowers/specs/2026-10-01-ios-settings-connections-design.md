# iPhone App — Settings → Connections Design

**Status:** Approved in chat 2026-10-01. Branch `ios-settings-connections`, cut from `main`.

**Goal:** Bring the web's Settings → Connections (`src/components/SettingsConnections.tsx`, `DebitCards.tsx`, `ConnectedBanks.tsx`) to the phone: debit cards (list, add, remove) and connected banks (list, disconnect). Connecting or reconnecting a bank through Plaid Link stays on the Mac.

**Builds on:** `2026-09-27-ios-settings-mode-design.md` (Settings order: Mode → Categories → Rules → Connections), plus the Categories and Rules specs. Everything there still holds.

**No server changes.** These routes exist, and the web uses them: `GET /api/accounts` (which carries `banks` and `debitCards`), `POST /api/debit-cards`, `DELETE /api/debit-cards/:id`, `DELETE /api/plaid/items/:itemId`.

---

## Decisions already made

| Question | Decision |
|---|---|
| Plaid Link on the phone | No. The phone manages connections only. A footer points to the Mac for connecting or reconnecting. Rejected alternatives: the native LinkKit SDK (a new dependency, plus an OAuth redirect URI and a server change), and handing off to Safari (OAuth over local `http` is unreliable). |
| Layout | Settings row → one Connections list with two sections; Add Debit Card is a sheet. |
| Pull to refresh | GET only. Never Plaid's balance refresh, unlike the Accounts tab. |
| Deliberate differences | A failed card removal shows a banner (the web is silent). A failed disconnect shows the server's message, not "Failed (HTTP 500)". The web's header blurb is dropped. |

---

## Screens

### Settings

A **Connections** `NavigationLink` sits in the same section as Categories and Rules, under Rules. It pushes `ConnectionsView`.

### `ConnectionsView`

The usual states: a `ProgressView`, then a full-screen `ErrorView`, then the list. `Banner` sits at the top for failures.

1. **Debit Cards section**
   - **Rows:** card name, then the secondary line `··1234 · draws from <accountName>`.
   - **Available amount:** trailing when non-nil, `$1,234.56 available` (`Formatters.currency`), secondary and monospaced digits. At `dynamicTypeSize.isAccessibilitySize` it stacks under the label instead.
   - **Swipe Remove** (destructive). An alert asks first: title `Remove debit card <name> ··<last4>?`, with buttons Remove and Cancel.
   - **Add Debit Card** row, last in the section, only when there is at least one checking account. It opens `AddDebitCardSheet`.
   - **Footer** when there are no cards: "No debit cards yet.". If there are no checking accounts it says "Connect a checking account first, then add the debit card linked to it." instead.
2. **Connected Banks section** (header "Connected Banks")
   - **Rows:** institution, then the secondary line `<plural(n,"account")> · id …<last 6 of itemId>`.
   - **Swipe Disconnect** (destructive). An alert asks first:
     - Title: `Disconnect <institution>?`
     - Message: `This removes its N account(s) and their transactions from this app and revokes the Plaid connection. It cannot be undone (you'd reconnect to get the data back).`
     - Buttons: Disconnect (destructive) and Cancel.
   - **Footer**, always shown: "To connect a bank or investment account, or reconnect one, use Budget on your Mac."
   - When there are no banks, the section shows just the footer.

### `AddDebitCardSheet`

- **Name:** text field, placeholder "Card name (e.g. Chase Debit)".
- **Last 4:** text field, placeholder "Last 4 digits", `.numberPad`. Input is filtered to digits and capped at 4.
- **Account:** picker over the checking accounts, shown by `displayName ?? name`, defaulting to the first.
- **Add:** disabled until the trimmed name is non-empty and the last 4 has exactly 4 digits. While saving it shows a spinner.
- On success the sheet dismisses and the list reloads. On failure the server message shows in red, and the fields are kept.

## Wording — `Support/ConnectionText.swift`

- `bankLine(b)`: `"\(plural(accountCount,"account")) · id …\(itemId.suffix(6))"`
- `disconnectTitle(b)` and `disconnectMessage(b)`: as above, from `ConnectedBanks.tsx`.
- `cardLine(c)`: `"··\(last4) · draws from \(accountName)"`
- `removeTitle(c)`: `"Remove debit card \(name) ··\(last4)?"`
- `available(c)`: `"\(Formatters.currency(x)) available"`, or nil when `available` is nil.
- `noCards`, `noChecking`, `macFooter`: the fixed strings above.
- `cleanLast4(_:)`: keeps digits only, at most 4.
- `accountLabel(_:)`: `displayName ?? name`.
- Non-ASCII characters (`·`, `…`) are written as `\u{…}` escapes in string literals.

## Networking — `APIClient+Connections.swift`

| Call | Request | Body / result |
|---|---|---|
| `connections()` | `GET api/accounts` | → `ConnectionsResponse { groups, banks, debitCards }` |
| `addDebitCard(_:)` | `POST api/debit-cards` | `{"name","last4","accountId"}` |
| `removeDebitCard(id:)` | `DELETE api/debit-cards/:id` | — |
| `disconnectBank(itemId:)` | `DELETE api/plaid/items/:itemId`, timeout 60 (it calls Plaid) | — |

- `ConnectionsResponse` reuses `AccountGroup` and adds `checkingAccounts`: the `DEPOSITORY` group's accounts, or an empty list.
- `BankSummary { itemId, institution, accountCount }` and `DebitCardDTO { id, name, last4, accountId, accountName, available? }` mirror `src/types/index.ts`.
- `AccountsResponse` is left as it is.

## State — `Settings/ConnectionsStore.swift`

- `@MainActor @Observable`, owned by `SettingsView` (`@State`).
- **Loading:** `data`, `error`, `isLoading`, `banner`, and a generation-guarded `load()`. The store failure rules apply.
- **Writes:** `perform(_ write: ConnectionWrite) async`, with `.removeCard(id:)` and `.disconnect(itemId:)`.
  - One write at a time (`isSaving`). The banner is cleared before each request.
  - On success the store reloads. On failure the banner shows the server message and there is no reload.
  - `.cancelled` is silent.
- **Add:** `add(_ card: NewDebitCard) async throws(APIError)`. It clears the banner first, throws to the sheet on failure, and reloads on success.

## Tests

`ConnectionTextTests` needs no stub. `ConnectionsAPITests` and `ConnectionsStoreTests` run under `StubbedNetworkTests` with `.serialized`. The fixture `Fixtures/connections.json` is new and invented.

- **Decoding:** banks, cards (one with `available: null`), and `checkingAccounts` both with and without a DEPOSITORY group.
- **Bodies:** the method, path and exact JSON of every call. The add body has exactly three keys. The deletes send no body.
- **Wording:** every string above, the singular "1 account", `cleanLast4`, and `accountLabel`.
- **Store:**
  - A full-screen error versus a banner.
  - A successful load clears the banner.
  - A write clears a stale banner before it sends.
  - A failed disconnect shows the server message with no reload.
  - A successful removal reloads.
  - A second write while one is in flight sends nothing.
  - `.cancelled` is silent.
  - `add` clears a stale banner, throws the server message, and reloads on success.

## Out of scope

- Plaid Link (connecting or reconnecting) on the phone.
- Reloading the Accounts or Activity tabs after a disconnect. They catch up on their next load.
- Checking real writes on the simulator; the owner does that.
