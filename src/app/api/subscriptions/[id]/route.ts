import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// DELETE /api/subscriptions/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.subscription.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[subscriptions DELETE]", err);
    return NextResponse.json({ error: "Failed to delete subscription" }, { status: 500 });
  }
}
