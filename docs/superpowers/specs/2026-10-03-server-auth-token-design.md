# Server access token

Server, web, iPhone and launcher. Owner's decisions, 2026-10-03. Closes the
prerequisite recorded in `2026-09-26-ios-accounts-design.md` ("Prerequisite
recorded for the server move").

## Today

`next start` binds every interface and no route checks who is asking, so
anything on the home Wi-Fi, or on the owner's tailnet through
`tailscale serve`, can read and change the ledger. The phone reaches the
server at its `https://<mac>.<tailnet>.ts.net` address (`ios/README.md`).

## Decisions

| Question | Answer |
|---|---|
| Lock-down | **Loopback + token.** The server listens on `127.0.0.1` only, so Wi-Fi devices cannot connect at all. Other devices come in through `tailscale serve` and must present the token. |
| The Mac's own browser | Token-free. |
| Another device's browser | A sign-in page takes the token once and sets a long-lived cookie. |
| iPhone | A Token field next to the server address (first-run setup and Settings), stored in the Keychain. The owner copies the token from the web and pastes it. No QR code. |
| Rotation | One "Reset token" button on the web, Mac only. Every other device is signed out. |
| Out of scope | User accounts, more than one token, per-device tokens, rate limiting, in-app token display on the phone. |

## Who counts as "local"

Binding to loopback means every request comes from a process on the Mac:
either the owner's browser or `tailscale serve` forwarding a tailnet
device. Local processes are trusted already (they can read `prisma/dev.db`
directly), so the only job is telling those two apart, and Serve marks what
it forwards:

- It keeps the original `Host` (the `.ts.net` name).
- It sets `X-Forwarded-For` to the tailnet client's address (`100.x.y.z` or
  a `fd7a:` IPv6), and adds `Tailscale-User-Login` for tailnet users.

In Next 16.2.9 the proxy runs (router-server's resolve-routes) before
base-server fills `x-forwarded-for`, so a plain local request reaches the
proxy with the header absent. Absent is treated as local; present must be
all loopback.

A request is **local** only when all of these hold:

1. The `Host` hostname is `localhost`, `127.0.0.1` or `[::1]`.
2. Every comma-separated `x-forwarded-for` entry, if the header is present,
   is a loopback address (`127.0.0.0/8`, `::1`, `::ffff:127.x.y.z`).
3. There is no `tailscale-user-login` header.

Anything else is **remote**. This rule is a pure function
(`src/lib/access.ts`) with its own tests. It is safe only because of the
loopback bind; the bind is part of this change, not an option.

## Server

- **Bind:** `package.json` `"start": "next start -H 127.0.0.1"`. `"dev": "next dev -H 127.0.0.1"`,
  so `next dev` binds loopback too.
  `Budget.command` already runs `npm run start`.
### Cross-site requests

A web page open in the Mac's browser can POST to `http://localhost:3000`, and
loopback is trusted, so the proxy refuses cross-site writes before the local
pass (`isCrossSiteWrite`). For any method other than GET/HEAD/OPTIONS: refuse
when `Sec-Fetch-Site` is `cross-site`, or when `Origin` is present and
unparseable (`null` included) or its hostname is not loopback (local request)
or not equal to the request's `Host` hostname (remote request). No Origin and
no Sec-Fetch-Site (curl, the iPhone's URLSession) falls through to the normal
rules. The response is `403 { "error": "Cross-site request refused." }`.

- **Token file:** `data/access-token`, 64 hex characters (32 random bytes
  from `crypto.randomBytes`), mode `0600`, gitignored. Created on first read
  if missing, so a fresh clone, `next dev` and `next start` all work with no
  setup step. Path overridable by `ACCESS_TOKEN_PATH` (tests use a temp
  dir). Read through a small cache that re-reads when the file's mtime
  changes, so a reset takes effect without a restart.
- **`src/proxy.ts`** (Next 16's renamed middleware, Node runtime). Its
  matcher skips `_next/static`, `_next/image`, `favicon.ico` and files in
  `public/`. For every other request:
  - Local → pass.
  - Remote with `Authorization: Bearer <token>` or cookie
    `budget_access=<token>` matching → pass. Comparison is
    `crypto.timingSafeEqual` over equal-length buffers (length mismatch is
    a plain reject).
  - Remote and `/signin` or `/api/access/signin` → pass (so the sign-in
    page and its form work).
  - Remote otherwise: paths under `/api/` get
    `401 { "error": "Sign-in required." }`; pages redirect (307) to
    `/signin?next=<path>` (same-origin path only).
- **Route handlers stay unaware of auth.** The app has no Server Functions
  today; the Next docs warn that those bypass a path-excluding matcher, so
  the spec records: if one is added, it checks access itself.

### Access API (`src/app/api/access/`)

| Route | Who | Does |
|---|---|---|
| `POST /api/access/signin` `{ token }` | anyone | Constant-time check. Right: `200 { ok: true }` and `Set-Cookie: budget_access=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`. Wrong: `401 { "error": "That token isn't right." }`. `Secure` is set for remote requests (they only arrive through Serve, over https) and omitted for local ones, which are plain http. |
| `POST /api/access/signout` | anyone | Clears the cookie. |
| `GET /api/access/token` | **local only** | `{ token }`. Remote, even with a valid token: `403 { "error": "Only available on the Mac running Budget." }`. |
| `POST /api/access/reset` `{}` | **local only** | Writes a new token (temp file + rename, `0600`), returns `{ token }`. Remote: 403 as above. |

The cookie holds the token itself rather than a session id: there is one
secret and one owner, and a reset must sign every device out, which this
gives for free.

## Web

- **`/signin`**: a plain centred card with the app's styling. One password
  field ("Access token"), a Sign in button, the error line under it. On
  success it navigates to `next` (default `/`). Copy: "This Budget server
  needs its access token. Find it on the Mac running Budget, under
  Settings → Remote Access."
- **Settings → Remote Access** (`/settings/access`, added to `SideNav` after
  Connections):
  - On the Mac: the token in a monospaced read-only field, hidden by default
    with Show and Copy buttons; under it "Reset Token…" with a confirm:
    "Every other device (your iPhone, other browsers) will be signed out
    until you give it the new token." After a reset the new token shows.
  - From another device: "Signed in on this browser." and a Sign Out
    button; no token, no reset (the API refuses them anyway).
  - Footer copy explains: the server only accepts connections from this Mac
    and from your tailnet; other devices need the token.
- The client fetch helpers need no change: same-origin `fetch` sends the
  cookie. If the token is reset while a remote browser has a page open, its
  API calls fail with the usual error display, and the proxy redirects it
  to `/signin` on the next navigation or reload. No fetch wrapper.

## iPhone

- **`AccessToken`** (`Networking/AccessToken.swift`): `normalize` (trim
  whitespace; empty → nil) and storage behind a protocol
  `TokenStore { read() -> String?; write(String?) }`. The app uses
  `KeychainTokenStore` (generic password, service = bundle id,
  account `"accessToken"`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`); tests use
  an in-memory store.
- **`APIClient`** gains `var token: String?`. `sendRaw` sets
  `Authorization: Bearer <token>` when present. Every `APIClient(baseURL:)`
  call site builds through one helper that reads the saved address and
  token together (`RootView.client()` and its copies collapse into it).
- **`APIError.unauthorized`** for status 401, message: "The server rejected
  the access token. Paste the current one in Settings → Server." It follows
  the store failure rules like any other error (full-screen with nothing
  loaded, banner otherwise).
- **Card art:** `CardArtCache.fetch` adds the same header (it builds its
  own `URLRequest`). Images that fail with 401 are not cached.
- **`ServerForm`:** a `SecureField("Access token")` under the address,
  pasted once. "Save and Test Connection" tests both; a 401 shows the
  unauthorized message. Footer copy changes: the server is reachable only
  through Tailscale now, so always use the `https://….ts.net` address, and
  get the token from the Mac's web Settings → Remote Access. The `.local`
  advice goes (Wi-Fi access no longer works).
- First-run setup uses the same form, so it gets the field for free.

## Launcher and docs

- `.gitignore`: `access-token`.
- `Budget.command` needs no new step (the server creates the file). Its
  printed URL stays `http://localhost:3000`, which is local and token-free.
- `README.md` "Where your data lives" gains `data/access-token`;
  `ios/README.md`'s Tailscale section replaces "Add authentication to the
  server before running it anywhere permanently" with the token steps.
- `CHANGELOG.md` entry.

## Rollout (owner runs each step)

1. Merge, then install the new phone build (it sends nothing until a token
   is pasted, so it works against the old server).
2. Rebuild the server (`bash Budget.command --no-open`). From here it binds
   loopback and the phone shows "rejected" until step 3.
3. On the Mac, open Settings → Remote Access, copy the token, paste it on
   the phone under Settings → Server, Save and Test.
4. Check: the phone loads over the `.ts.net` address; the Mac's browser
   still opens `localhost:3000` with no prompt; the Mac's LAN address on
   port 3000 refuses connections from another device.

## Testing

- **Node** (`scripts/test-access.mjs`, added to `package.json`'s test list):
  - `isLocal`: loopback hosts with and without `x-forwarded-for`; `.ts.net`
    host; loopback host with a `100.x` forwarded-for; IPv6 forms;
    `::ffff:127.0.0.1`; a `tailscale-user-login` header.
  - Token compare: right, wrong, wrong length, empty.
  - Proxy decision function: local pass; remote + bearer; remote + cookie;
    remote + nothing → 401 for `/api/*`, redirect for pages; `/signin`
    exempt; `next` param rejects off-site URLs.
  - Token file: created with mode 600 when missing; reset replaces it and
    the cache picks up the change.
- **Swift** (nested under `StubbedNetworkTests`):
  - Every request carries `Authorization` when a token is set and none when
    not; card-art fetch carries it.
  - 401 maps to `.unauthorized`.
  - `AccessToken.normalize`; the in-memory store round-trip.
- **Scratch server only** (another port, scratch DB, `-H 127.0.0.1`):
  local browser passes without a token; a request with a forged
  `X-Forwarded-For: 100.64.0.1` gets 401; sign-in sets the cookie. Never the
  live server.
