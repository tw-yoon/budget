import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// DELETE /api/debit-cards/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.debitCard.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[debit-cards DELETE]", err);
    return NextResponse.json({ error: "Failed to delete debit card" }, { status: 500 });
  }
}
