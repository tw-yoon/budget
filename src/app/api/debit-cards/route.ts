import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/debit-cards — add a debit card linked to a checking account.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const last4 = String(body.last4 ?? "").trim();
    const accountId = String(body.accountId ?? "");

    if (!name) return bad("Card name is required");
    if (!/^\d{4}$/.test(last4)) return bad("Last 4 must be exactly 4 digits");
    if (!accountId) return bad("Pick a linked checking account");

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return bad("Linked account not found", 404);

    const card = await prisma.debitCard.create({
      data: { name, last4, accountId },
    });
    return NextResponse.json({ id: card.id });
  } catch (err) {
    console.error("[debit-cards POST]", err);
    return NextResponse.json({ error: "Failed to add debit card" }, { status: 500 });
  }
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
