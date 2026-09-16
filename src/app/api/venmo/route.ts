import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VENMO_CATEGORIES } from "@/lib/venmo";
import { humanizePfc } from "@/lib/format";
import { resolveLinkedCategory } from "@/lib/links";

// GET /api/venmo — list imported Venmo transactions (for the categorizer page).
export async function GET() {
  try {
    const rows = await prisma.transaction.findMany({
      where: { source: "VENMO" },
      orderBy: { date: "desc" },
      select: {
        id: true,
        label: true,
        date: true,
        name: true,
        counterparty: true,
        amount: true,
        userCategory: true,
        fundsCashoutId: true,
        linkedToId: true,
        linkedTo: {
          select: { id: true, label: true, name: true, merchantName: true,
                    userCategory: true, pfcPrimary: true },
        },
      },
    });

    const transactions = rows.map((t) => {
      const linkedToCategory = t.linkedTo
        ? t.linkedTo.userCategory ?? humanizePfc(t.linkedTo.pfcPrimary)
        : null;
      const { raw } = resolveLinkedCategory({
        amount: t.amount,
        userCategory: t.userCategory,
        linkedToCategory,
      });
      return {
        id: t.id,
        label: t.label,
        date: t.date.toISOString(),
        note: t.name,
        counterparty: t.counterparty,
        direction: t.amount > 0 ? ("out" as const) : ("in" as const),
        amount: Math.abs(t.amount),
        // Reporting the inherited category here keeps the page's "Received
        // (categorized)" and "Net spend" totals right with no special-casing —
        // a linked row simply is not Uncategorized.
        category: raw ?? "Other",
        linkedTo: t.linkedTo
          ? {
              id: t.linkedTo.id,
              label: t.linkedTo.label,
              name: t.linkedTo.merchantName ?? t.linkedTo.name,
              category: linkedToCategory ?? "Uncategorized",
            }
          : null,
        pooledIntoCashout: Boolean(t.fundsCashoutId),
      };
    });

    return NextResponse.json({ transactions, categories: VENMO_CATEGORIES });
  } catch (err) {
    console.error("[venmo GET]", err);
    return NextResponse.json({ error: "Failed to load Venmo transactions" }, { status: 500 });
  }
}
