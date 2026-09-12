import { NextRequest, NextResponse } from "next/server";
import { getAnalytics } from "@/services/analytics.service";

// GET /api/analytics?months=6
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const months = Math.min(
      24,
      Math.max(1, parseInt(searchParams.get("months") ?? "6", 10))
    );

    const result = await getAnalytics(months);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[analytics]", err);
    return NextResponse.json(
      { error: "Failed to compute analytics" },
      { status: 500 }
    );
  }
}
