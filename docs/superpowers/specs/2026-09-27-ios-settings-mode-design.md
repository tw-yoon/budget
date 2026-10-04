# iPhone App — Settings → Mode Design

**Status:** Approved in chat 2026-09-27, revised the same day after the owner tried the first build. Branch `ios-settings-mode`, cut from `main`.

**Goal:** Bring the web's Settings → Mode (`src/components/SettingsMode.tsx`) to the phone as an iPhone-style **Pro Mode** switch. The setting is shared with the web through `/api/ui-state`. The phone does not port the web's Light/Dark/System setting; it follows the iPhone's own appearance.

**Builds on:** `2026-09-26-ios-accounts-design.md` and `2026-09-26-ios-transactions-design.md`. Everything there still holds.

**No server changes.** `GET` and `PUT /api/ui-state` exist, and the web uses both today.

---

## Decisions already made

| Question | Decision |
|---|---|
| Settings scope | All four web sections, one spec each, in the order Mode → Categories → Rules → Connections. This spec covers Mode only. |
| Connecting a bank (Plaid Link) | Stays on the Mac. To be decided again with Connections. |
| How Normal/Pro looks | A single `Toggle` on the Settings screen itself, the way iPhone Settings shows an on/off choice. It has no descriptions and no separate Mode page. *(Revised: the first build had a Mode page with the web's Normal/Pro rows and blurbs.)* |
| Appearance | The phone follows the iPhone's own Light/Dark setting. It never reads or writes the web's `theme` key, and the web keeps that setting for itself. *(Revised: the first build shared Light/Dark/System with the web and forced the scheme.)* |
| A failed save | The phone shows a banner, while the web stays silent. This is the one deliberate difference; see Failures. |
| Action button colour | Settings' **Save and Test Connection** button is tinted `.primary` (black in light mode) instead of the default blue. |

---

## The Settings screen

`SettingsView` is a `Form` inside a `NavigationStack`, with these sections in order:

1. **Pro Mode** is a `Toggle` bound to `ProMode.isPro`. Turning it on or off calls `ProMode.choose`. The toggle is disabled until the first successful read, or until a choice has been made (`hasLoaded`), so it never shows Off and then flips On. This is the web's `loading` rule. The section has no header and no footer. Categories, Rules and Connections will join the screen in later specs.
2. **Server** is the existing `ServerForm`. Its button is tinted `.primary`.
3. **About** shows the version, as before.

A failed save shows a `Banner` at the top of the screen (see Failures).

## State

### `ProMode` (existing, `Shared/ProMode.swift`)

- **Ownership:** `ProMode` moves from `TransactionsView` up to `RootView` (`@State`). `RootView` passes it into `TransactionsView(proMode:)` and `SettingsView(proMode:)`, so a change in Settings reaches the ledger straight away.
- **Loading:** `RootView` loads it with `.task(id: server)` and again whenever `scenePhase` becomes `.active`.
- **`choose(_ pro: Bool) async`** follows `useProMode`'s `choose`:
  1. It sets `isPro`, sets `hasLoaded = true`, clears `saveFailed`, and bumps a choice counter. Reads and choices are counted separately. A read is dropped if a newer read started, if a choice was made after it started, or if a save was in flight at its start or end (the server may not hold the choice yet). A save failure is flagged only when its choice is still the latest, whatever loads ran in between.
  2. It sends `PUT /api/ui-state` with the body `{"key":"pro-mode","value":"pro"}` or `"normal"`.
  3. On failure it sets `saveFailed`. `.cancelled` stays silent.
- **Legacy key:** the phone still falls back to `analytics-mode`, but it does **not** push the migrated value forward. The web does that migration.

### Networking

`Networking/APIClient+Settings.swift` holds `func putUIState(key: String, value: String) async throws(APIError)`. It sends the JSON body `{"key":…,"value":…}`.

## Failures

- **A read fails:** nothing changes, and there is no banner.
- **A save fails:** the switch stays where the user put it, and the Settings screen shows `Banner`: "Couldn't save to the server. Other devices keep the old setting." The banner clears when it is dismissed, or when the next choice is made (before that choice's request is sent). This differs from the web on purpose. The web quietly keeps the value in one browser's localStorage, but the phone's next read from the server would quietly undo the choice.
- `.cancelled` is always silent.

## Tests

`SettingsModeTests.swift` is nested under `StubbedNetworkTests` with `@Suite(.serialized)`. The race tests hold requests back with the stub's gate instead of sleeping. The tests cover:

- **Request bodies:** `choose(true)` sends exactly `{"key":"pro-mode","value":"pro"}`, and `choose(false)` sends `"normal"`. Each test checks the method and path too.
- **Races:**
  - a choice made while a read is in flight survives the read;
  - a read started while a save is in flight doesn't overwrite the choice;
  - a save failure is still flagged when a load ran in between;
  - a superseded save's failure isn't flagged.
- **Save failure:** the choice stays applied, and the next choice clears the flag before its request is sent.

## Out of scope

- Categories, Rules and Connections, which get their own specs in that order.
- The web's `theme` setting on the phone.
- Checking a real save on the simulator. The live server holds real data, so the owner does that.
