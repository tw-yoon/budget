import { NextRequest, NextResponse } from "next/server";
import { listPerkCandidates } from "@/services/perk-credits.service";

// GET /api/perk-credits/candidates?benefitId=b1 — credits on the perk's card
// (last 365 days, newest first, at most 50) not already placed to it.
export async function GET(req: NextRequest) {
  try {
    const benefitId = new URL(req.url).searchParams.get("benefitId");
    if (!benefitId) return NextResponse.json({ error: "benefitId is required" }, { status: 400 });
    const candidates = await listPerkCandidates(benefitId);
    if (!candidates) return NextResponse.json({ error: "Perk not found" }, { status: 404 });
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[perk-credits candidates GET]", err);
    return NextResponse.json({ error: "Failed to load candidates" }, { status: 500 });
  }
}
