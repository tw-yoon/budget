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
