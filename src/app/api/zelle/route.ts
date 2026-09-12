import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ZELLE_CATEGORIES, isZelleName, parseZelleCounterparty } from "@/lib/zelle";

// GET /api/zelle — native Zelle transactions from the Plaid feed, parsed and
// ready to categorize. (Nothing is imported; these rows already exist.)
export async function GET() {
  try {
    const rows = await prisma.transaction.findMany({
      where: { source: "PLAID", name: { contains: "Zelle" } },
      orderBy: { date: "desc" },
      select: {
        id: true,
        date: true,
        name: true,
        amount: true,
        userCategory: true,
      },
    });

    const transactions = rows
      .filter((t) => isZelleName(t.name))
      .map((t) => ({
        id: t.id,
        date: t.date.toISOString(),
        note: "", // Zelle has no memo in the bank feed
        counterparty: parseZelleCounterparty(t.name),
        direction: t.amount > 0 ? ("out" as const) : ("in" as const),
        amount: Math.abs(t.amount),
        category: t.userCategory ?? "Uncategorized",
      }));

    return NextResponse.json({ transactions, categories: ZELLE_CATEGORIES });
  } catch (err) {
    console.error("[zelle GET]", err);
    return NextResponse.json({ error: "Failed to load Zelle transactions" }, { status: 500 });
  }
}
