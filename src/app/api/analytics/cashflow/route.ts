import { NextResponse } from "next/server";
import { getCashflow } from "@/services/analytics.service";

// GET /api/analytics/cashflow — wide per-month cash-flow series for the Sankey.
// The client fetches this once and windows/zooms over it locally.
export async function GET() {
  try {
    const result = await getCashflow(24);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[analytics/cashflow]", err);
    return NextResponse.json(
      { error: "Failed to compute cash flow" },
      { status: 500 }
    );
  }
}
