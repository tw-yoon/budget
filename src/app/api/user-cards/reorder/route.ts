import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/user-cards/reorder — persist a new card display order.
// Body: { ids: string[] }  (the full list of card ids in the desired order)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: string[] | null = Array.isArray(body.ids) ? body.ids.map(String) : null;
    if (!ids || ids.length === 0)
      return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.userCard.update({ where: { id }, data: { sortOrder: index } })
      )
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[user-cards reorder]", err);
    return NextResponse.json({ error: "Failed to reorder cards" }, { status: 500 });
  }
}
