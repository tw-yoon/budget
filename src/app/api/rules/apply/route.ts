import { NextResponse } from "next/server";
import { applyRulesToExisting } from "@/services/rules.service";

// POST /api/rules/apply — re-run all enabled rules over existing transactions.
export async function POST() {
  try {
    const result = await applyRulesToExisting();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[rules apply]", err);
    return NextResponse.json({ error: "Failed to apply rules" }, { status: 500 });
  }
}
