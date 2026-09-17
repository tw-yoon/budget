import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listCategoryNames } from "@/services/categories.service";

// PATCH /api/zelle/:id — set the user category on a native Zelle transaction.
// "Uncategorized" clears it (keeping the row excluded, like a plain transfer).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { userCategory?: string };
    const category = body.userCategory;
    // Validate against the user's own list, plus the "Uncategorized" sentinel
    // that clears the category — it is deliberately not a stored Category row.
    const names = new Set(await listCategoryNames());
    if (!category || (category !== "Uncategorized" && !names.has(category))) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const { count } = await prisma.transaction.updateMany({
      // A linked row derives its category from its purchase — refuse to
      // overwrite it here. (This route sets userCategory with no source guard,
      // so without this the derived category would be silently replaced.)
      where: { id, source: "PLAID", linkedToId: null },
      data: { userCategory: category === "Uncategorized" ? null : category },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[zelle PATCH]", err);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}
