import { NextRequest, NextResponse } from "next/server";
import { updateRule, deleteRule } from "@/services/rules.service";
import type { Prisma } from "@prisma/client";

// PATCH /api/rules/:id — update mutable fields of a rule.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: Prisma.CategoryRuleUpdateInput = {};

    if (typeof body.field === "string") data.field = body.field;
    if (typeof body.matchType === "string") data.matchType = body.matchType;
    if (typeof body.pattern === "string") data.pattern = body.pattern.trim();
    if (typeof body.category === "string") data.category = body.category.trim();
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;
    if (Number.isFinite(body.priority)) data.priority = body.priority;

    const rule = await updateRule(id, data);
    return NextResponse.json({ rule });
  } catch (err) {
    console.error("[rules PATCH]", err);
    return NextResponse.json({ error: "Failed to update rule" }, { status: 500 });
  }
}

// DELETE /api/rules/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteRule(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[rules DELETE]", err);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
