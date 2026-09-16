import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { humanizePfc } from "@/lib/format";
import { rankCandidates } from "@/lib/links";

// GET /api/transactions/:id/link-candidates — the purchases this money-in row
// most likely pays back, best first. Queried server-side rather than filtered
// from the loaded page, because the purchase behind a refund is often months
// back and several pages away.
const WINDOW_DAYS = 90;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const refund = await prisma.transaction.findUnique({
      where: { id },
      select: {
        date: true,
        amount: true,
        name: true,
        merchantName: true,
        counterparty: true,
      },
    });
    if (!refund) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (refund.amount >= 0) {
      return NextResponse.json({ candidates: [] });
    }

    const since = new Date(refund.date.getTime() - WINDOW_DAYS * 86_400_000);
    const rows = await prisma.transaction.findMany({
      where: {
        amount: { gt: 0 },
        date: { gte: since, lte: refund.date },
        linkedToId: null,
        isFee: false,
        pending: false,
      },
      select: {
        id: true,
        label: true,
        date: true,
        name: true,
        merchantName: true,
        counterparty: true,
        amount: true,
        userCategory: true,
        pfcPrimary: true,
      },
    });

    const candidates = rankCandidates(refund, rows).map((c) => {
      const row = rows.find((r) => r.id === c.id)!;
      return {
        id: row.id,
        label: row.label,
        date: row.date.toISOString(),
        name: row.merchantName ?? row.name,
        amount: row.amount,
        category: row.userCategory ?? humanizePfc(row.pfcPrimary),
      };
    });

    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[link-candidates]", err);
    return NextResponse.json(
      { error: "Failed to load candidates" },
      { status: 500 }
    );
  }
}
