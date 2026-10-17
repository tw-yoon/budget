import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateLink } from "@/lib/links";
import { parsePurchasePick } from "@/lib/perk-credits";
import { loadPerkPlacement, poolsOthers, rememberMerchant } from "@/services/perk-credits.service";

// PUT /api/perk-credits/:id/purchase — pick the purchase a placed credit paid back.
//   { purchaseId: "t9" }  link it and remember its merchant for the perk
//   { purchaseId: null }  unlink; never auto-pair this credit again
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const purchaseId = parsePurchasePick(await req.json().catch(() => null));
    if (purchaseId === undefined) return bad("Expected { purchaseId: string | null }");

    const row = await prisma.transaction.findUnique({
      where: { id },
      select: { id: true, amount: true, linkedToId: true, isFee: true, pending: true },
    });
    if (!row) return bad("Not found", 404);
    const placed = (await loadPerkPlacement()).placement.placed.get(id);
    if (!placed) return bad("That transaction does not fill a perk");

    if (purchaseId === null) {
      await prisma.transaction.update({
        where: { id },
        data: {
          noAutoPair: true,
          // Only a linked row's provenance is ours to clear (see handleLink).
          ...(row.linkedToId !== null && { linkedToId: null, perkPaired: false, userCategorySource: null }),
        },
      });
      return NextResponse.json({ ok: true });
    }

    const target = await prisma.transaction.findUnique({
      where: { id: purchaseId },
      select: { id: true, amount: true, linkedToId: true, isFee: true, pending: true, name: true, merchantName: true },
    });
    if (!target) return bad("Purchase not found", 404);
    const problem = validateLink({ ...row, poolsOthers: await poolsOthers(id) }, { ...target, poolsOthers: false });
    if (problem) return bad(problem);

    await prisma.transaction.update({
      where: { id },
      data: {
        linkedToId: target.id,
        userCategory: null,
        userCategorySource: "LINK",
        perkPaired: true,
        noAutoPair: false,
      },
    });
    await rememberMerchant(placed.benefitId, target.merchantName ?? target.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[perk-credits purchase PUT]", err);
    return NextResponse.json({ error: "Failed to pick the purchase" }, { status: 500 });
  }
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
