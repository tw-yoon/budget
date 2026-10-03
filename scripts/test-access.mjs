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
