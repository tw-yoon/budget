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
