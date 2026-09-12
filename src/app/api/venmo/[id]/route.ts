import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VENMO_CATEGORIES } from "@/lib/venmo";

// PATCH /api/venmo/:id — update the user category of one Venmo transaction.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { userCategory?: string };
    const category = body.userCategory;
    if (!category || !VENMO_CATEGORIES.includes(category as never)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const { count } = await prisma.transaction.updateMany({
      where: { id, source: "VENMO" },
      data: { userCategory: category },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[venmo PATCH]", err);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}
