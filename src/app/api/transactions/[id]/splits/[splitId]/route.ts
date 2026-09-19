import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// DELETE /api/transactions/:id/splits/:splitId — drop one carve-out. The
// remainder grows back by that amount on the next read, with no write.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; splitId: string }> }
) {
  try {
    const { id, splitId } = await params;
    // Scoped by transaction as well as id, so a mismatched pair is a 404
    // rather than a deletion from some other transaction's split set.
    const { count } = await prisma.transactionSplit.deleteMany({
      where: { id: splitId, transactionId: id },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[splits DELETE]", err);
    return NextResponse.json({ error: "Failed to remove split" }, { status: 500 });
  }
}
