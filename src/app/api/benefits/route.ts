import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PERIODS = new Set(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]);

// POST /api/benefits — add a user-defined benefit to a card.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userCardId = String(body.userCardId ?? "");
    const name = String(body.name ?? "").trim();
    const amount = Number(body.amount);
    const period = String(body.period ?? "").toUpperCase();
    const category = body.category ? String(body.category).toUpperCase() : null;
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!userCardId) return bad("Missing card");
    if (!name) return bad("Benefit name is required");
    if (!Number.isFinite(amount) || amount <= 0)
      return bad("Amount must be a positive number");
    if (!PERIODS.has(period)) return bad("Invalid period");

    const card = await prisma.userCard.findUnique({ where: { id: userCardId } });
    if (!card) return bad("Card not found", 404);

    const benefit = await prisma.userBenefit.create({
      data: {
        userCardId,
        name,
        amount,
        period,
        notes,
        matchCategories: category ? JSON.stringify([category]) : "[]",
      },
    });

    return NextResponse.json({ id: benefit.id });
  } catch (err) {
    console.error("[benefits POST]", err);
    return NextResponse.json({ error: "Failed to add benefit" }, { status: 500 });
  }
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
