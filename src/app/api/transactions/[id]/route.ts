import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { joinCategory } from "@/lib/categories";
import { validateLink } from "@/lib/links";

// PATCH /api/transactions/:id — manually override a transaction's category,
// and/or connect a money-in row to the purchase it offsets.
//   body: { category?: string | null, subcategory?: string | null,
//           linkedToLabel?: number | null }
//
// `linkedToLabel` absent leaves any existing link alone; null unlinks; a number
// links to the transaction carrying that display label. A linked row derives
// its category from its target, so linking clears any category of its own and
// stamps userCategorySource=LINK, which keeps the rules engine off it.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      category?: string | null;
      subcategory?: string | null;
      linkedToLabel?: number | null;
    };

    if (body.linkedToLabel !== undefined) {
      return handleLink(id, body.linkedToLabel);
    }

    const category = body.category?.trim() || null;
    const subcategory = body.subcategory?.trim() || null;
    const userCategory = category ? joinCategory(category, subcategory) : null;

    const { count } = await prisma.transaction.updateMany({
      // A linked row's category is owned by its link, not by this row's own
      // fields — it must be changed by disconnecting the link first. Without
      // this guard a category write here would win over the link (via
      // resolveLinkedCategory's userCategory ?? linkedToCategory) while the UI
      // still renders the row as locked, and a `category: null` write would
      // clear userCategorySource, exposing the row to the rules engine.
      where: { id, linkedToId: null },
      data: {
        userCategory,
        userCategorySource: userCategory ? "MANUAL" : null,
      },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, userCategory });
  } catch (err) {
    console.error("[transactions PATCH]", err);
    return NextResponse.json(
      { error: "Failed to update category" },
      { status: 500 }
    );
  }
}

async function handleLink(id: string, label: number | null) {
  const refund = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, amount: true, linkedToId: true },
  });
  if (!refund) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (label === null) {
    // Unlinking an already-unlinked row is a no-op. Only a linked row's
    // provenance is ours to clear — it is "LINK" by construction. Blanking it
    // on an unlinked row would strip a MANUAL or VENMO provenance and leave
    // userCategory exposed to the rules engine on the next sync.
    if (refund.linkedToId !== null) {
      await prisma.transaction.update({
        where: { id },
        data: { linkedToId: null, userCategorySource: null },
      });
    }
    return NextResponse.json({ ok: true, linkedTo: null });
  }

  const target = await prisma.transaction.findUnique({
    where: { label },
    select: {
      id: true,
      amount: true,
      linkedToId: true,
      label: true,
      name: true,
      merchantName: true,
    },
  });
  if (!target) {
    return NextResponse.json(
      { error: `No transaction numbered ${label}` },
      { status: 404 }
    );
  }

  const problem = validateLink(refund, target);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  await prisma.transaction.update({
    where: { id },
    data: {
      linkedToId: target.id,
      // The link owns the category now — drop any of this row's own.
      userCategory: null,
      userCategorySource: "LINK",
    },
  });

  return NextResponse.json({
    ok: true,
    linkedTo: {
      id: target.id,
      label: target.label,
      name: target.merchantName ?? target.name,
    },
  });
}
