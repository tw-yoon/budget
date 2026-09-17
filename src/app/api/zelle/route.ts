import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isZelleName, parseZelleCounterparty } from "@/lib/zelle";
import { listCategoryNames } from "@/services/categories.service";
import { humanizePfc } from "@/lib/format";
import { resolveLinkedCategory } from "@/lib/links";

// GET /api/zelle — native Zelle transactions from the Plaid feed, parsed and
// ready to categorize. (Nothing is imported; these rows already exist.)
export async function GET() {
  try {
    const rows = await prisma.transaction.findMany({
      where: { source: "PLAID", name: { contains: "Zelle" } },
      orderBy: { date: "desc" },
      select: {
        id: true,
        label: true,
        date: true,
        name: true,
        amount: true,
        userCategory: true,
        linkedToId: true,
        linkedTo: {
          select: { id: true, label: true, name: true, merchantName: true,
                    userCategory: true, pfcPrimary: true },
        },
      },
    });

    const transactions = rows
      .filter((t) => isZelleName(t.name))
      .map((t) => {
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
          note: "", // Zelle has no memo in the bank feed
          counterparty: parseZelleCounterparty(t.name),
          direction: t.amount > 0 ? ("out" as const) : ("in" as const),
          amount: Math.abs(t.amount),
          // Reporting the inherited category here keeps the page's totals right
          // with no special-casing — a linked row simply is not Uncategorized.
          category: raw ?? "Uncategorized",
          linkedTo: t.linkedTo
            ? {
                id: t.linkedTo.id,
                label: t.linkedTo.label,
                name: t.linkedTo.merchantName ?? t.linkedTo.name,
                category: linkedToCategory ?? "Uncategorized",
              }
            : null,
        };
      });

    // "Uncategorized" is a sentinel, not a stored category — it is what the
    // PATCH route turns back into a null userCategory. Offer it first so a
    // categorized row can always be reverted.
    const categories = ["Uncategorized", ...(await listCategoryNames())];
    return NextResponse.json({ transactions, categories });
  } catch (err) {
    console.error("[zelle GET]", err);
    return NextResponse.json({ error: "Failed to load Zelle transactions" }, { status: 500 });
  }
}
