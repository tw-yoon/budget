import { NextRequest, NextResponse } from "next/server";
import { takeOverHandSet } from "@/services/rules.service";

// POST /api/rules/:id/take-over — replace the hand-set categories on the rows
// this rule matches with the rule's own, so those rows follow the rule.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(await takeOverHandSet(id));
  } catch (err) {
    if (err instanceof Error && err.message === "Rule not found or off") {
      return NextResponse.json({ error: "That rule is off or gone" }, { status: 404 });
    }
    console.error("[rules take-over]", err);
    return NextResponse.json({ error: "Failed to apply rule" }, { status: 500 });
  }
}
