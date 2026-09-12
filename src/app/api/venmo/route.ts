import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VENMO_CATEGORIES } from "@/lib/venmo";

// GET /api/venmo — list imported Venmo transactions (for the categorizer page).
export async function GET() {
  try {
    const rows = await prisma.transaction.findMany({
      where: { source: "VENMO" },
      orderBy: { date: "desc" },
      select: {
        id: true,
        date: true,
        name: true,
        counterparty: true,
        amount: true,
        userCategory: true,
        fundsCashoutId: true,
      },
    });

    const transactions = rows.map((t) => ({
      id: t.id,
      date: t.date.toISOString(),
      note: t.name,
      counterparty: t.counterparty,
      direction: t.amount > 0 ? ("out" as const) : ("in" as const),
      amount: Math.abs(t.amount),
      category: t.userCategory ?? "Other",
      pooledIntoCashout: Boolean(t.fundsCashoutId),
    }));

    return NextResponse.json({ transactions, categories: VENMO_CATEGORIES });
  } catch (err) {
    console.error("[venmo GET]", err);
    return NextResponse.json({ error: "Failed to load Venmo transactions" }, { status: 500 });
  }
}
