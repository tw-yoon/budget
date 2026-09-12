import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { REWARD_CATEGORIES, REWARD_UNITS } from "@/lib/rewards";

const CATEGORIES = new Set<string>(REWARD_CATEGORIES);
const UNITS = new Set<string>(REWARD_UNITS);

// POST /api/rewards — add or override an earning rate on a card.
// Upserts on (userCardId, category) so re-submitting a category updates it.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userCardId = String(body.userCardId ?? "");
    const category = String(body.category ?? "").toUpperCase();
    const unit = String(body.unit ?? "X").toUpperCase();
    const multiplier = Number(body.multiplier);
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!userCardId) return bad("Missing card");
    if (!CATEGORIES.has(category)) return bad("Invalid category");
    if (!UNITS.has(unit)) return bad("Invalid unit");
    if (!Number.isFinite(multiplier) || multiplier <= 0)
      return bad("Rate must be a positive number");

    const card = await prisma.userCard.findUnique({ where: { id: userCardId } });
    if (!card) return bad("Card not found", 404);

    const rate = await prisma.rewardRate.upsert({
      where: { userCardId_category: { userCardId, category } },
      create: { userCardId, category, multiplier, unit, notes },
      update: { multiplier, unit, notes },
    });

    return NextResponse.json({ id: rate.id });
  } catch (err) {
    console.error("[rewards POST]", err);
    return NextResponse.json({ error: "Failed to save rate" }, { status: 500 });
  }
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
