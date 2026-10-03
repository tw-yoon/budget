# Server Access Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Budget server listens on loopback only and requires an access token from every request that did not originate on the Mac; the web gets a sign-in page and a Remote Access settings page; the iPhone stores the token in the Keychain and sends it on every request.

**Architecture:** Pure rules in `src/lib/access.ts` (who is local, token compare, the proxy's decision). Token file handling in `src/lib/access-token-store.ts`. `src/proxy.ts` (Next 16's middleware) applies the decision. Four small routes under `src/app/api/access/`. On the phone, `AccessToken` (Keychain behind a protocol) feeds `APIClient` and `CardArtCache`.

**Tech Stack:** Next.js 16.2.9 (App Router, `proxy.ts`), Node 24 `node:test` with native TS stripping, SwiftUI / Swift 6 / Swift Testing, iOS 26.

**Spec:** `budget-claude/docs/superpowers/specs/2026-10-03-server-auth-token-design.md`. Read it first.

## Global Constraints

- Work in the `server-auth-token` worktree, on branch `server-auth-token`. All paths below are relative to its `budget-claude/` folder.
- Read `AGENTS.md` and `ios/CLAUDE.md` before writing code. Next 16 differs from training data; the proxy reference is `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` (run `npm install` in the worktree first if `node_modules` is missing; never copy it in from elsewhere).
- **Live server:** `localhost:3000` serves real money data. Never send it anything but GET; never write `prisma/dev.db`; never run `Budget.command`; never restart or rebuild the live server; never call Plaid. Scratch servers use another port and a scratch DB.
- Public repo: no real names, hostnames (no real `.ts.net` names), tokens, amounts. Invented values only (`budget-mac.local`, `example-mac.example-tailnet.ts.net`).
- Never edit `ios/BudgetPhone.xcodeproj/project.pbxproj`; new Swift files join targets by folder.
- Exact copy (from the spec):
  - API 401 body: `{ "error": "Sign-in required." }`
  - Wrong token at sign-in: `{ "error": "That token isn't right." }`
  - Local-only routes from remote: `403 { "error": "Only available on the Mac running Budget." }`
  - iPhone unauthorized: `The server rejected the access token. Paste the current one in Settings → Server.`
- Cookie: `budget_access=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`, plus `Secure` for remote requests only.
- Token: 64 lowercase hex chars, file `data/access-token` (override `ACCESS_TOKEN_PATH`), mode 0600.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `bash scripts/test-scrub.sh` before each commit.

---

### Task 1: Access rules and token store (server libs)

**Files:**
- Create: `src/lib/access.ts`
- Create: `src/lib/access-token-store.ts`
- Create: `scripts/test-access.mjs`
- Modify: `package.json` (append `scripts/test-access.mjs` to the `node --test` list, after `scripts/test-reconnect-merge.mjs`)
- Modify: `.gitignore` (add `access-token` under the `# encrypted token store` block)

**Interfaces:**
- Produces (`src/lib/access.ts`):
  - `ACCESS_COOKIE = "budget_access"`
  - `isLoopbackAddress(addr: string): boolean`
  - `hostnameOf(host: string | null): string`
  - `isLocal(headers: { get(name: string): string | null }): boolean`
  - `bearerToken(authorization: string | null): string | null`
  - `tokensMatch(given: string | null | undefined, expected: string): boolean`
  - `safeNext(next: string | null): string`
  - `type AccessDecision = { kind: "pass" } | { kind: "unauthorized" } | { kind: "signin"; next: string }`
  - `decideAccess(input: { pathname: string; search: string; headers: { get(name: string): string | null }; cookie: string | undefined; token: string }): AccessDecision`
- Produces (`src/lib/access-token-store.ts`):
  - `createAccessTokenStore(file: string): { read(): string; reset(): string }`
  - `accessTokenPath(): string`
  - `accessTokens` (lazy singleton store at `accessTokenPath()`)

- [ ] **Step 1: Write the failing tests** — `scripts/test-access.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bearerToken,
  decideAccess,
  hostnameOf,
  isLocal,
  isLoopbackAddress,
  safeNext,
  tokensMatch,
} from "../src/lib/access.ts";
import { createAccessTokenStore } from "../src/lib/access-token-store.ts";

// docs/superpowers/specs/2026-10-03-server-auth-token-design.md

const TOKEN = "a".repeat(64);
const h = (o) => new Headers(o);

test("loopback addresses", () => {
  for (const a of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", " 127.0.0.1 "]) {
    assert.equal(isLoopbackAddress(a), true, a);
  }
  for (const a of ["100.64.0.1", "fd7a:115c:a1e0::1", "192.168.1.5", "::ffff:10.0.0.1", "", "1270.0.0.1"]) {
    assert.equal(isLoopbackAddress(a), false, a);
  }
});

test("hostnameOf strips the port and handles IPv6 brackets", () => {
  assert.equal(hostnameOf("localhost:3000"), "localhost");
  assert.equal(hostnameOf("127.0.0.1"), "127.0.0.1");
  assert.equal(hostnameOf("[::1]:3000"), "[::1]");
  assert.equal(hostnameOf("Example-Mac.example-tailnet.ts.net"), "example-mac.example-tailnet.ts.net");
  assert.equal(hostnameOf(null), "");
});

test("isLocal: loopback host, loopback or absent forwarded-for, no tailscale header", () => {
  assert.equal(isLocal(h({ host: "localhost:3000" })), true);
  assert.equal(isLocal(h({ host: "127.0.0.1:3000", "x-forwarded-for": "127.0.0.1" })), true);
  assert.equal(isLocal(h({ host: "[::1]:3000", "x-forwarded-for": "::1" })), true);
  assert.equal(isLocal(h({ host: "localhost:3000", "x-forwarded-for": "::ffff:127.0.0.1" })), true);
});

test("isLocal: anything Tailscale Serve forwards is remote", () => {
  assert.equal(isLocal(h({ host: "example-mac.example-tailnet.ts.net", "x-forwarded-for": "100.64.0.1" })), false);
  assert.equal(isLocal(h({ host: "localhost:3000", "x-forwarded-for": "100.64.0.1" })), false);
  assert.equal(isLocal(h({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1, 100.64.0.1" })), false);
  assert.equal(isLocal(h({ host: "localhost:3000", "tailscale-user-login": "someone@example.com" })), false);
  assert.equal(isLocal(h({ host: "192.168.1.5:3000" })), false);
  assert.equal(isLocal(h({})), false);
});

test("bearerToken", () => {
  assert.equal(bearerToken(`Bearer ${TOKEN}`), TOKEN);
  assert.equal(bearerToken(`bearer ${TOKEN}`), TOKEN);
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken(null), null);
});

test("tokensMatch", () => {
  assert.equal(tokensMatch(TOKEN, TOKEN), true);
  assert.equal(tokensMatch("b".repeat(64), TOKEN), false);
  assert.equal(tokensMatch("a".repeat(63), TOKEN), false);
  assert.equal(tokensMatch("", TOKEN), false);
  assert.equal(tokensMatch(null, TOKEN), false);
  assert.equal(tokensMatch(undefined, TOKEN), false);
  assert.equal(tokensMatch("", ""), false, "an empty expected token never matches");
});

test("safeNext keeps same-origin paths only", () => {
  assert.equal(safeNext("/transactions?x=1"), "/transactions?x=1");
  assert.equal(safeNext("//evil.example"), "/");
  assert.equal(safeNext("/\\evil.example"), "/");
  assert.equal(safeNext("https://evil.example"), "/");
  assert.equal(safeNext(null), "/");
});

const remote = { host: "example-mac.example-tailnet.ts.net", "x-forwarded-for": "100.64.0.1" };
const decide = (pathname, headers, cookie, search = "") =>
  decideAccess({ pathname, search, headers: h(headers), cookie, token: TOKEN });

test("decideAccess: local passes without a token", () => {
  assert.deepEqual(decide("/api/accounts", { host: "localhost:3000" }), { kind: "pass" });
});

test("decideAccess: remote with bearer or cookie passes", () => {
  assert.deepEqual(decide("/api/accounts", { ...remote, authorization: `Bearer ${TOKEN}` }), { kind: "pass" });
  assert.deepEqual(decide("/transactions", remote, TOKEN), { kind: "pass" });
});

test("decideAccess: remote without a token", () => {
  assert.deepEqual(decide("/api/accounts", remote), { kind: "unauthorized" });
  assert.deepEqual(decide("/api/accounts", { ...remote, authorization: "Bearer wrong" }), { kind: "unauthorized" });
  assert.deepEqual(decide("/transactions", remote, undefined, "?m=2026-01"), {
    kind: "signin",
    next: "/transactions?m=2026-01",
  });
  assert.deepEqual(decide("/", remote, "wrong"), { kind: "signin", next: "/" });
});

test("decideAccess: sign-in page and its routes are open", () => {
  for (const p of ["/signin", "/api/access/signin", "/api/access/signout"]) {
    assert.deepEqual(decide(p, remote), { kind: "pass" }, p);
  }
  assert.deepEqual(decide("/api/access/token", remote), { kind: "unauthorized" });
});

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "access-")), "data", "access-token");

test("token store creates a 0600 file of 64 hex chars on first read", () => {
  const file = tmpFile();
  const store = createAccessTokenStore(file);
  const t = store.read();
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(store.read(), t, "stable across reads");
  assert.equal(createAccessTokenStore(file).read(), t, "another store sees the same token");
});

test("token store reset replaces the token and every store sees it", () => {
  const file = tmpFile();
  const a = createAccessTokenStore(file);
  const b = createAccessTokenStore(file);
  const before = a.read();
  b.read();
  const after = a.reset();
  assert.notEqual(after, before);
  assert.equal(a.read(), after);
  assert.equal(b.read(), after, "picks up the change from disk");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("token store regenerates a damaged file", () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "\n");
  assert.match(createAccessTokenStore(file).read(), /^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import ./scripts/resolve-alias.mjs --test scripts/test-access.mjs`
Expected: FAIL, cannot find module `../src/lib/access.ts`.

- [ ] **Step 3: Implement `src/lib/access.ts`**

```ts
import { timingSafeEqual } from "node:crypto";

// Who may reach the server without the access token, and what the proxy does
// with everyone else. docs/superpowers/specs/2026-10-03-server-auth-token-design.md
//
// The server binds 127.0.0.1, so every request comes from a process on the
// Mac: the owner's browser, or `tailscale serve` forwarding a tailnet device.
// Serve keeps the .ts.net Host and sets X-Forwarded-For to the device's
// address; Next fills X-Forwarded-For from the socket when it is absent. This
// rule is only safe together with the loopback bind.

export const ACCESS_COOKIE = "budget_access";

type HeaderBag = { get(name: string): string | null };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Routes a signed-out remote browser must still reach. */
const OPEN_PATHS = new Set(["/signin", "/api/access/signin", "/api/access/signout"]);

export function isLoopbackAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase();
  if (a === "::1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice("::ffff:".length) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** The Host header's name, lowercased, without the port. */
export function hostnameOf(host: string | null): string {
  if (!host) return "";
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  return h.split(":")[0];
}

export function isLocal(headers: HeaderBag): boolean {
  if (!LOOPBACK_HOSTS.has(hostnameOf(headers.get("host")))) return false;
  if (headers.get("tailscale-user-login") != null) return false;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded != null && !forwarded.split(",").every(isLoopbackAddress)) return false;
  return true;
}

export function bearerToken(authorization: string | null): string | null {
  const m = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

/** Constant-time for equal lengths; a length mismatch is a plain reject. */
export function tokensMatch(given: string | null | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A same-origin path to return to after signing in, else "/". */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

export type AccessDecision =
  | { kind: "pass" }
  | { kind: "unauthorized" }
  | { kind: "signin"; next: string };

export function decideAccess(input: {
  pathname: string;
  search: string;
  headers: HeaderBag;
  cookie: string | undefined;
  token: string;
}): AccessDecision {
  const { pathname, search, headers, cookie, token } = input;
  if (isLocal(headers)) return { kind: "pass" };
  if (OPEN_PATHS.has(pathname)) return { kind: "pass" };
  if (tokensMatch(bearerToken(headers.get("authorization")), token)) return { kind: "pass" };
  if (tokensMatch(cookie, token)) return { kind: "pass" };
  if (pathname === "/api" || pathname.startsWith("/api/")) return { kind: "unauthorized" };
  return { kind: "signin", next: safeNext(pathname + search) };
}
```

- [ ] **Step 4: Implement `src/lib/access-token-store.ts`**

```ts
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// The server's one access token, in data/access-token (mode 0600, gitignored).
// Created on first read, so a fresh clone, `next dev` and `next start` need no
// setup step. Re-read when the file changes, so a reset takes effect at once.

const VALID = /^[0-9a-f]{64}$/;

export function accessTokenPath(): string {
  return process.env.ACCESS_TOKEN_PATH ?? path.join(process.cwd(), "data", "access-token");
}

export function createAccessTokenStore(file: string) {
  let cache: { mtimeMs: number; size: number; token: string } | null = null;

  function write(token: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
    cache = null;
    return token;
  }

  const fresh = () => randomBytes(32).toString("hex");

  return {
    read(): string {
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
      } catch {
        return write(fresh());
      }
      if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.token;
      const token = fs.readFileSync(file, "utf8").trim();
      if (!VALID.test(token)) return write(fresh());
      cache = { mtimeMs: st.mtimeMs, size: st.size, token };
      return token;
    },
    reset(): string {
      return write(fresh());
    },
  };
}

let shared: ReturnType<typeof createAccessTokenStore> | null = null;

/** The store at accessTokenPath(), made on first use. */
export const accessTokens = {
  read: () => (shared ??= createAccessTokenStore(accessTokenPath())).read(),
  reset: () => (shared ??= createAccessTokenStore(accessTokenPath())).reset(),
};
```

Note: `reset()` writes a new file whose size equals the old one (65 bytes) and whose mtime can equal it within a millisecond. That is why `write` clears `cache` in the writing store; other stores rely on mtime. Acceptable: resets are human-paced.

- [ ] **Step 5: Run to verify it passes**

Run: `node --import ./scripts/resolve-alias.mjs --test scripts/test-access.mjs`
Expected: all tests PASS. (If "every store sees it" flakes from mtime granularity, insert a `fs.utimesSync(file, new Date(), new Date(Date.now() + 1000))` after `a.reset()` in the test — not in the store.)

- [ ] **Step 6: Wire into `package.json` and `.gitignore`, run the full suite**

Append ` scripts/test-access.mjs` after `scripts/test-reconnect-merge.mjs` in the `test` script. Add `access-token` to `.gitignore` under `# encrypted token store`.
Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/access.ts src/lib/access-token-store.ts scripts/test-access.mjs package.json .gitignore
git commit -m "Access rules and token store for the server access token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Proxy, access routes and loopback bind

**Files:**
- Create: `src/proxy.ts`
- Create: `src/app/api/access/signin/route.ts`
- Create: `src/app/api/access/signout/route.ts`
- Create: `src/app/api/access/token/route.ts`
- Create: `src/app/api/access/reset/route.ts`
- Modify: `package.json` (`"start": "next start -H 127.0.0.1"`)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: HTTP contract from the spec's "Access API" table; proxy behaviour (401 JSON for `/api/*`, 307 with relative `Location: /signin?next=…` for pages).

- [ ] **Step 1: Read the proxy reference** (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`): file is `src/proxy.ts` (same level as `app/`), exported function `proxy`, `config.matcher`, Node runtime by default.

- [ ] **Step 2: `src/proxy.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, decideAccess } from "@/lib/access";
import { accessTokens } from "@/lib/access-token-store";

// The access token check. docs/superpowers/specs/2026-10-03-server-auth-token-design.md
// Route handlers stay unaware of auth. The app has no Server Functions; if one
// is ever added it must check access itself (a matcher can skip it).
export function proxy(req: NextRequest) {
  const decision = decideAccess({
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
    headers: req.headers,
    cookie: req.cookies.get(ACCESS_COOKIE)?.value,
    token: accessTokens.read(),
  });
  if (decision.kind === "pass") return NextResponse.next();
  if (decision.kind === "unauthorized") {
    return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  }
  // Relative Location: behind Tailscale Serve the request reaches Next as
  // plain http, so an absolute URL built here would point at the wrong scheme.
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `/signin?next=${encodeURIComponent(decision.next)}` },
  });
}

export const config = {
  // Everything but Next's own build assets. public/ is empty; card art is an
  // API route and must stay covered.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 3: The four routes**

`src/app/api/access/signin/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, isLocal, tokensMatch } from "@/lib/access";
import { accessTokens } from "@/lib/access-token-store";

// POST /api/access/signin {token} — sets the sign-in cookie on a right token.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const given = typeof body?.token === "string" ? body.token.trim() : "";
  const token = accessTokens.read();
  if (!tokensMatch(given, token)) {
    return NextResponse.json({ error: "That token isn't right." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    // Remote requests only arrive through Serve, over https; local ones are http.
    secure: !isLocal(req.headers),
  });
  return res;
}
```

`src/app/api/access/signout/route.ts`:
```ts
import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "@/lib/access";

// POST /api/access/signout — clears this browser's sign-in cookie.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ACCESS_COOKIE);
  return res;
}
```

`src/app/api/access/token/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { isLocal } from "@/lib/access";
import { accessTokens } from "@/lib/access-token-store";

// GET /api/access/token — the token, for Settings → Remote Access on the Mac.
export async function GET(req: NextRequest) {
  if (!isLocal(req.headers)) {
    return NextResponse.json({ error: "Only available on the Mac running Budget." }, { status: 403 });
  }
  return NextResponse.json({ token: accessTokens.read() }, { headers: { "Cache-Control": "no-store" } });
}
```

`src/app/api/access/reset/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { isLocal } from "@/lib/access";
import { accessTokens } from "@/lib/access-token-store";

// POST /api/access/reset — a new token; every other device is signed out.
export async function POST(req: NextRequest) {
  if (!isLocal(req.headers)) {
    return NextResponse.json({ error: "Only available on the Mac running Budget." }, { status: 403 });
  }
  return NextResponse.json({ token: accessTokens.reset() }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 4: Loopback bind.** In `package.json` set `"start": "next start -H 127.0.0.1"`. Run `bash scripts/test-launcher.sh` (it rewrites `pkg.scripts.start` with a stub; confirm it still passes).

- [ ] **Step 5: Verify on a scratch server** (never port 3000, never the real DB):

```bash
SCRATCH=$(mktemp -d)
DATABASE_URL="file:$SCRATCH/x.db" npx prisma migrate deploy   # empty scratch DB; never read or copy prisma/dev.db
npm run build
DATABASE_URL="file:$SCRATCH/x.db" ACCESS_TOKEN_PATH="$SCRATCH/access-token" npx next start -H 127.0.0.1 -p 3117 &
```

Then check (all must hold):
- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3117/api/ui-state?key=x` → `200` (local).
- `curl -s -H 'X-Forwarded-For: 100.64.0.1' http://127.0.0.1:3117/api/ui-state?key=x` → `401` with `{"error":"Sign-in required."}`.
- Same with `-H "Authorization: Bearer $(cat $SCRATCH/access-token)"` → `200`.
- `curl -si -H 'X-Forwarded-For: 100.64.0.1' http://127.0.0.1:3117/transactions` → `307`, `location: /signin?next=%2Ftransactions`.
- `curl -si -H 'X-Forwarded-For: 100.64.0.1' -H 'Content-Type: application/json' -d "{\"token\":\"$(cat $SCRATCH/access-token)\"}" http://127.0.0.1:3117/api/access/signin` → `200`, `set-cookie: budget_access=…; …HttpOnly; Secure; SameSite=lax`.
- `/api/access/token` with forwarded-for + bearer → `403`; without forwarded-for → `200`.
- `lsof -nP -iTCP:3117 -sTCP:LISTEN` shows `127.0.0.1:3117` only.
Kill the scratch server and remove `$SCRATCH` afterwards.

- [ ] **Step 6: Run** `npm test && npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/proxy.ts src/app/api/access package.json
git commit -m "Require the access token from anything not on the Mac; bind loopback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web sign-in page and Settings → Remote Access

**Files:**
- Create: `src/app/signin/page.tsx`
- Create: `src/components/SignInForm.tsx`
- Create: `src/app/settings/access/page.tsx`
- Create: `src/components/SettingsAccess.tsx`
- Modify: `src/components/SideNav.tsx:58` (add `{ href: "/settings/access", label: "Remote Access" }` after Connections)

**Interfaces:**
- Consumes: `POST /api/access/signin`, `POST /api/access/signout`, `GET /api/access/token`, `POST /api/access/reset` from Task 2; `safeNext` from `@/lib/access` is server-only (imports `node:crypto`), so the client re-checks `next` with an inline same-origin test.

Follow the look of `src/components/SettingsMode.tsx` (header `h1 text-2xl font-semibold tracking-tight`, muted `text-sm text-black/55 dark:text-white/55`, bordered `rounded-lg` blocks). Check `src/app/layout.tsx`: if it renders `SideNav` around every page, `/signin` still renders inside it; that is acceptable (links just bounce back to `/signin` while signed out).

- [ ] **Step 1: `src/app/signin/page.tsx`**

```tsx
import { Suspense } from "react";
import { SignInForm } from "@/components/SignInForm";

export const metadata = { title: "Sign In · Budget Claude" };

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 2: `src/components/SignInForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

const sameOrigin = (p: string | null) =>
  p && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") ? p : "/";

export function SignInForm() {
  const next = sameOrigin(useSearchParams().get("next"));
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/access/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (r.ok) {
        window.location.assign(next);
        return;
      }
      setError((await r.json().catch(() => null))?.error ?? "Couldn't sign in.");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sign In</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          This Budget server needs its access token. Find it on the Mac running Budget, under
          Settings → Remote Access.
        </p>
      </header>
      <label className="flex flex-col gap-1 text-sm">
        Access token
        <input
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="rounded-md border border-black/15 bg-transparent px-3 py-2 font-mono dark:border-white/15"
          autoFocus
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || token.trim() === ""}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

(Check that `bg-foreground` / `text-background` exist in `globals.css` theme tokens; if not, copy the primary-button classes used elsewhere, e.g. grep `type="submit"` in `src/components`.)

- [ ] **Step 3: `src/app/settings/access/page.tsx`**

```tsx
import { SettingsAccess } from "@/components/SettingsAccess";

export const metadata = { title: "Remote Access · Settings · Budget Claude" };

export default function SettingsAccessPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsAccess />
    </main>
  );
}
```

- [ ] **Step 4: `src/components/SettingsAccess.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

type State = { kind: "loading" } | { kind: "local"; token: string } | { kind: "remote" } | { kind: "error"; message: string };

export function SettingsAccess() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/access/token", { cache: "no-store" })
      .then(async (r) => {
        if (r.ok) setState({ kind: "local", token: (await r.json()).token });
        else if (r.status === 403) setState({ kind: "remote" });
        else setState({ kind: "error", message: (await r.json().catch(() => null))?.error ?? "Couldn't load." });
      })
      .catch(() => setState({ kind: "error", message: "Couldn't reach the server." }));
  }, []);

  async function copy(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function reset() {
    if (!confirm("Every other device (your iPhone, other browsers) will be signed out until you give it the new token.")) return;
    const r = await fetch("/api/access/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (r.ok) {
      setState({ kind: "local", token: (await r.json()).token });
      setShown(true);
    }
  }

  async function signOut() {
    await fetch("/api/access/signout", { method: "POST" });
    window.location.assign("/signin");
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Remote Access</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          The server only accepts connections from this Mac and from your tailnet. Other devices need the access token.
        </p>
      </header>

      {state.kind === "loading" && <p className="text-sm text-black/55 dark:text-white/55">Loading…</p>}
      {state.kind === "error" && <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>}

      {state.kind === "local" && (
        <div className="flex flex-col gap-3 rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
          <span className="text-sm font-medium">Access token</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              type={shown ? "text" : "password"}
              value={state.token}
              className="min-w-0 flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 font-mono text-sm dark:border-white/15"
            />
            <button type="button" onClick={() => setShown((s) => !s)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15">
              {shown ? "Hide" : "Show"}
            </button>
            <button type="button" onClick={() => copy(state.token)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-sm text-black/55 dark:text-white/55">
            On the iPhone, paste it under Settings → Server. In another browser, open this server&apos;s address and paste it when asked.
          </p>
          <button type="button" onClick={reset} className="self-start text-sm text-red-600 hover:underline dark:text-red-400">
            Reset Token…
          </button>
        </div>
      )}

      {state.kind === "remote" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
          <span className="text-sm">Signed in on this browser.</span>
          <button type="button" onClick={signOut} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15">
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: SideNav** — add `{ href: "/settings/access", label: "Remote Access" },` after the Connections entry.

- [ ] **Step 6: Check in a scratch server** (as Task 2 Step 5, port 3117, `npm run build` first): open `http://127.0.0.1:3117/settings/access` in the browser pane — token hidden, Show/Copy work, Reset shows a new token. The remote view and `/signin` can't be reached from the pane (it is local); check them with curl (`/signin` with forwarded-for returns 200 HTML; the sign-in POST was covered in Task 2). Optional: render `/signin` locally at `http://127.0.0.1:3117/signin` to check the look. Never the live server.

- [ ] **Step 7: Run** `npm test && npx tsc --noEmit` (lint is part of `npm test`). Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/signin src/components/SignInForm.tsx src/app/settings/access src/components/SettingsAccess.tsx src/components/SideNav.tsx
git commit -m "Web: sign-in page and Settings → Remote Access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: iPhone sends the token

**Files:**
- Create: `ios/BudgetPhone/Networking/AccessToken.swift`
- Modify: `ios/BudgetPhone/Networking/APIClient.swift` (`token` property, header in `sendRaw`, `.unauthorized`, 401 mapping, `APIClient.saved()` helper)
- Modify: `ios/BudgetPhone/App/RootView.swift:25`, `ios/BudgetPhone/Transactions/TransactionsView.swift:35`, `ios/BudgetPhone/Accounts/AccountsView.swift:7`, `ios/BudgetPhone/Analytics/AnalyticsView.swift:12,15` (use `APIClient.saved()`)
- Modify: `ios/BudgetPhone/Benefits/CardArtCache.swift` (header)
- Modify: `ios/BudgetPhone/Settings/ServerForm.swift` (token field, test with token, footer copy)
- Test: `ios/BudgetPhoneTests/AccessTokenTests.swift` (new); extend `ios/BudgetPhoneTests/NetworkTests.swift` and `ios/BudgetPhoneTests/CardArtCacheTests.swift`

**Interfaces:**
- Produces:
  - `protocol TokenStore: Sendable { func read() -> String?; func write(_ token: String?) }`
  - `struct KeychainTokenStore: TokenStore`
  - `final class MemoryTokenStore: TokenStore, @unchecked Sendable` (in the app target, so tests and previews can use it)
  - `enum AccessToken { static func normalize(_ s: String) -> String?; nonisolated(unsafe) static var store: any TokenStore; static func saved() -> String?; static func save(_ s: String?) }`
  - `APIClient.token: String?`, `APIError.unauthorized`, `static func APIClient.saved() -> APIClient?`
  - `CardArtCache.init(session:directory:token:)` with `token: @escaping @Sendable () -> String? = { AccessToken.saved() }`

- [ ] **Step 1: Write failing tests**

`ios/BudgetPhoneTests/AccessTokenTests.swift`:
```swift
import Foundation
import Testing
@testable import BudgetPhone

struct AccessTokenTests {
  @Test func normalizeTrimsAndRejectsEmpty() {
    #expect(AccessToken.normalize("  abc123\n") == "abc123")
    #expect(AccessToken.normalize("   ") == nil)
    #expect(AccessToken.normalize("") == nil)
  }

  @Test func memoryStoreRoundTrips() {
    let store = MemoryTokenStore()
    #expect(store.read() == nil)
    store.write("abc")
    #expect(store.read() == "abc")
    store.write(nil)
    #expect(store.read() == nil)
  }
}
```

Add to `NetworkTests` (inside the existing struct):
```swift
    @Test func sendsTheTokenAsABearerHeader() async throws {
      let json = try TestData.accountsJSON()
      var c = client { _ in (200, json) }
      c.token = "sample-token"
      _ = try await c.accounts()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer sample-token")
    }

    @Test func sendsNoAuthorizationWithoutAToken() async throws {
      let json = try TestData.accountsJSON()
      _ = try await client { _ in (200, json) }.accounts()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func status401IsUnauthorized() async {
      let c = client { _ in (401, Data(#"{"error":"Sign-in required."}"#.utf8)) }
      await #expect(throws: APIError.unauthorized) { try await c.accounts() }
      #expect(APIError.unauthorized.message == "The server rejected the access token. Paste the current one in Settings → Server.")
    }
```

Add to `CardArtCacheTests`:
```swift
    @Test func sendsTheToken() async throws {
      let session = StubURLProtocol.session { _ in (200, Self.png) }
      let c = CardArtCache(session: session, directory: directory, token: { "sample-token" })
      c.load(url)
      await c.settle()
      let request = try #require(StubURLProtocol.requests.first)
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer sample-token")
    }
```
Also change the existing `cache()` helper to pass `token: { nil }` so other card-art tests never read the Keychain.

- [ ] **Step 2: Run to verify they fail**

From `ios/`: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: compile errors (`AccessToken`, `token`, `.unauthorized` missing).

- [ ] **Step 3: `ios/BudgetPhone/Networking/AccessToken.swift`**

```swift
import Foundation
import Security

/// Where the server's access token is kept. A protocol so tests use memory,
/// not the Keychain.
protocol TokenStore: Sendable {
  func read() -> String?
  func write(_ token: String?)
}

/// The server's access token, pasted once from the Mac's web Settings →
/// Remote Access. Never compiled in, never in UserDefaults.
/// docs/superpowers/specs/2026-10-03-server-auth-token-design.md
enum AccessToken {
  nonisolated(unsafe) static var store: any TokenStore = KeychainTokenStore()

  /// Trims whitespace; nil when nothing is left.
  static func normalize(_ input: String) -> String? {
    let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? nil : s
  }

  static func saved() -> String? { store.read() }

  static func save(_ input: String?) { store.write(input.flatMap(normalize)) }
}

/// A generic password item, readable after first unlock so background
/// reloads work.
struct KeychainTokenStore: TokenStore {
  var service = Bundle.main.bundleIdentifier ?? "BudgetPhone"
  var account = "accessToken"

  private var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service,
     kSecAttrAccount as String: account]
  }

  func read() -> String? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  func write(_ token: String?) {
    SecItemDelete(query as CFDictionary)
    guard let token else { return }
    var q = query
    q[kSecValueData as String] = Data(token.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(q as CFDictionary, nil)
  }
}

/// For tests and previews.
final class MemoryTokenStore: TokenStore, @unchecked Sendable {
  private let lock = NSLock()
  private var value: String?
  init(_ value: String? = nil) { self.value = value }
  func read() -> String? { lock.withLock { value } }
  func write(_ token: String?) { lock.withLock { value = token } }
}
```

- [ ] **Step 4: `APIClient.swift`**
  - Add case to `APIError`, after `server`:
    ```swift
      /// 401: the access token is missing, wrong, or was reset on the Mac.
      case unauthorized
    ```
    and in `message`: `case .unauthorized: "The server rejected the access token. Paste the current one in Settings → Server."`
  - In `struct APIClient`, after `var session`: `var token: String? = nil`
  - After `var token`, the shared builder:
    ```swift
      /// The saved server with the saved token; nil until a server is set.
      static func saved() -> APIClient? {
        ServerAddress.saved().map { APIClient(baseURL: $0, token: AccessToken.saved()) }
      }
    ```
    Note the memberwise init order becomes `(baseURL:session:token:)`; existing `APIClient(baseURL:session:)` calls keep compiling.
  - In `sendRaw`, after the `Accept` header: `if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }`
  - In `serverError(status:data:)`, first line: `if status == 401 { return .unauthorized }`

- [ ] **Step 5: Call sites.** Replace `ServerAddress.saved().map { APIClient(baseURL: $0) }` with `APIClient.saved()` in RootView.swift:25, TransactionsView.swift:35, AccountsView.swift:7, AnalyticsView.swift:12 and :15. Grep afterwards: `grep -rn "APIClient(baseURL" BudgetPhone` should list only `ServerForm.swift`.

- [ ] **Step 6: `CardArtCache.swift`**
  - New stored property `@ObservationIgnored private let token: @Sendable () -> String?`
  - `init(session: URLSession = .shared, directory: URL? = CardArtCache.defaultDirectory, token: @escaping @Sendable () -> String? = { AccessToken.saved() })`, assigning `self.token = token`.
  - In `fetch`: `var request = URLRequest(url: url, timeoutInterval: 30)` then `if let t = token() { request.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }`. Non-200 already isn't cached.

- [ ] **Step 7: `ServerForm.swift`**
  - Add `@State private var tokenDraft = ""`.
  - Under the address `TextField`:
    ```swift
          SecureField("Access token", text: $tokenDraft)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textContentType(.password)
            .onSubmit(save)
    ```
  - `.onAppear { draft = server; tokenDraft = AccessToken.saved() ?? "" }`
  - `save()`: after saving the address, `AccessToken.save(tokenDraft)`.
  - `saveAndTest()`: `APIClient(baseURL: url, token: AccessToken.normalize(tokenDraft)).accounts()`.
  - Placeholder `"https://your-mac.your-tailnet.ts.net"`; footer text:
    `"The Mac's https:// address ending in .ts.net, with no port. Budget only accepts connections through Tailscale, so keep Tailscale connected, at home too. The access token is on the Mac, in Budget's web Settings → Remote Access."`
  - Keep the existing `if let testResult` switch: `.unauthorized` already shows its message through `error.message`.
  - `ServerSetupView` intro text: change "Enter the address of the Mac that runs it." to "Enter the address of the Mac that runs it and its access token."

- [ ] **Step 8: Make tests independent of the Keychain.** Nothing in tests calls `AccessToken.saved()` except through `APIClient.saved()`/`CardArtCache` defaults. Grep the test target for `CardArtCache(` and `APIClient.saved` and pass `token: { nil }` where a cache is built; stores built in tests use explicit `APIClient(baseURL:session:)`.

- [ ] **Step 9: Run tests.** The xcodebuild command from Step 2. Expected: all pass. Then `bash ../scripts/test-scrub.sh` from `ios/`.

- [ ] **Step 10: Look at it.** Build and run on the iPhone 17 Pro simulator. Open Settings → Server (or first-run setup on a fresh install) and screenshot it: the Access token field and the new footer render, and nothing wraps badly at the default and an accessibility text size. Don't tap Save and Test against port 3000 with a token typed (it is a GET, so allowed, but not needed); use the scratch server at `http://127.0.0.1:3117` if you want a connection check. The 401 message is covered by the unit test.

- [ ] **Step 11: Commit**

```bash
git add ios/BudgetPhone ios/BudgetPhoneTests
git commit -m "iPhone: access token in the Keychain, sent on every request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs and final verification

**Files:**
- Modify: `README.md` ("Where your data lives": add `- \`data/access-token\` — the access token other devices need (see Settings → Remote Access). Delete it to make a new one.`; plus a short "Using Budget from another device" note if the README has a section on reaching the server)
- Modify: `ios/README.md` (lines ~84-100: replace "The server has no login, so it is only reachable on your own network." and "Add authentication to the server before running it anywhere permanently — see the design doc." with: the server listens on the Mac only and is reached through Tailscale even at home; step 4: "Open Budget on the Mac, Settings → Remote Access, copy the token, and paste it into the app's Settings → Server.")
- Modify: `docs/superpowers/specs/2026-09-26-ios-accounts-design.md:32` (append: "Done: `2026-10-03-server-auth-token-design.md`.")
- Modify: `CHANGELOG.md` (Unreleased, first bullet): "Budget only accepts connections from the Mac it runs on and, with the access token, from your tailnet. Find the token under Settings → Remote Access; other browsers ask for it once, and the iPhone app has a field for it under Settings → Server. Devices on your Wi-Fi can no longer reach Budget directly."

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2:** Full verification, all from the worktree: `npm test`, `npx tsc --noEmit`, the iOS xcodebuild test command (from `ios/`), `bash scripts/test-scrub.sh`. All must pass; paste the tail of each output in the report.
- [ ] **Step 3:** `git diff main --stat` and read the whole diff for anything from live data (hostnames, names, amounts).
- [ ] **Step 4: Commit**

```bash
git add README.md ios/README.md CHANGELOG.md docs/superpowers/specs/2026-09-26-ios-accounts-design.md
git commit -m "Docs: access token and Remote Access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Do not merge, push, or touch the live server. The controller reports back to the owner, who plans the rollout (spec, "Rollout").
