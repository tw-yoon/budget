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
  // Next rejects a relative Location from a proxy ("Invalid URL"), so build an
  // absolute one; Next rewrites it to a relative Location before sending, so the
  // scheme and host seen behind Tailscale Serve never reach the browser.
  const url = new URL(`/signin?next=${encodeURIComponent(decision.next)}`, req.url);
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Everything but Next's own build assets. public/ is empty; card art is an
  // API route and must stay covered.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
