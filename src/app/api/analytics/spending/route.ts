import { NextResponse } from "next/server";
import { getDailySpending } from "@/services/analytics.service";

// GET /api/analytics/spending — daily spend totals for the cumulative graph.
export async function GET() {
  try {
    return NextResponse.json(await getDailySpending(24));
  } catch (err) {
    console.error("[analytics/spending]", err);
    return NextResponse.json(
      { error: "Failed to compute spending" },
      { status: 500 }
    );
  }
}
