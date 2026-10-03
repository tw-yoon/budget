import { timingSafeEqual } from "node:crypto";

// Who may reach the server without the access token, and what the proxy does
// with everyone else. docs/superpowers/specs/2026-10-03-server-auth-token-design.md
//
// The server binds 127.0.0.1, so every request comes from a process on the
// Mac: the owner's browser, or `tailscale serve` forwarding a tailnet device.
// Serve keeps the .ts.net Host and sets X-Forwarded-For to the device's
// address. A plain local request reaches the proxy with X-Forwarded-For absent
// (in Next 16.2.9 the proxy runs before base-server fills it), so absent counts
// as local and a present header must be all loopback. This rule is only safe
// together with the loopback bind.

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
  | { kind: "forbidden" }
  | { kind: "unauthorized" }
  | { kind: "signin"; next: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * True when a state-changing request looks like it was sent by another web
 * page. Requests with neither Origin nor Sec-Fetch-Site (curl, URLSession)
 * are not browser-driven and fall through to the normal rules.
 */
export function isCrossSiteWrite(method: string, headers: HeaderBag, local: boolean): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if (headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") return true;
  const origin = headers.get("origin");
  if (origin == null) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (local) return !LOOPBACK_HOSTS.has(host);
  return host !== hostnameOf(headers.get("host"));
}

export function decideAccess(input: {
  method: string;
  pathname: string;
  search: string;
  headers: HeaderBag;
  cookie: string | undefined;
  token: string;
}): AccessDecision {
  const { method, pathname, search, headers, cookie, token } = input;
  const local = isLocal(headers);
  if (isCrossSiteWrite(method, headers, local)) return { kind: "forbidden" };
  if (local) return { kind: "pass" };
  if (OPEN_PATHS.has(pathname)) return { kind: "pass" };
  if (tokensMatch(bearerToken(headers.get("authorization")), token)) return { kind: "pass" };
  if (tokensMatch(cookie, token)) return { kind: "pass" };
  if (pathname === "/api" || pathname.startsWith("/api/")) return { kind: "unauthorized" };
  return { kind: "signin", next: safeNext(pathname + search) };
}
