import { NextRequest, NextResponse } from "next/server";
import { listRulesWithOutcomes, createRule } from "@/services/rules.service";
import {
  RULE_FIELDS,
  RULE_MATCH_TYPES,
  type RuleField,
  type RuleMatchType,
} from "@/lib/rules";

// GET /api/rules — all rules in evaluation order, each with how the rows it
// matches stand (`outcome`, null for a rule that is off).
export async function GET() {
  try {
    const rules = await listRulesWithOutcomes();
    return NextResponse.json({ rules });
  } catch (err) {
    console.error("[rules GET]", err);
    return NextResponse.json({ error: "Failed to load rules" }, { status: 500 });
  }
}

// POST /api/rules — create a rule.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const field = body.field as RuleField;
    const matchType = body.matchType as RuleMatchType;
    const pattern = typeof body.pattern === "string" ? body.pattern.trim() : "";
    const category =
      typeof body.category === "string" ? body.category.trim() : "";

    if (!RULE_FIELDS.includes(field)) {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }
    if (!RULE_MATCH_TYPES.includes(matchType)) {
      return NextResponse.json({ error: "Invalid matchType" }, { status: 400 });
    }
    if (!pattern) {
      return NextResponse.json({ error: "Pattern is required" }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: "Category is required" }, { status: 400 });
    }

    const rule = await createRule({
      field,
      matchType,
      pattern,
      category,
      priority: Number.isFinite(body.priority) ? body.priority : 0,
      enabled: body.enabled !== false,
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    console.error("[rules POST]", err);
    return NextResponse.json({ error: "Failed to create rule" }, { status: 500 });
  }
}
