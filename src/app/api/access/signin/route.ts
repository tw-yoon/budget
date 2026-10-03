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
