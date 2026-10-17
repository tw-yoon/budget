import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseRotatingBody } from "@/lib/rotating-body";

type Ctx = { params: Promise<{ id: string; year: string; quarter: string }> };

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function quarterParams(params: Ctx["params"]) {
  const { id, year, quarter } = await params;
  const y = Number(year);
  const q = Number(quarter);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return { error: "Year must be between 2000 and 2100" };
  if (!Number.isInteger(q) || q < 1 || q > 4) return { error: "Quarter must be between 1 and 4" };
  return { id, year: y, quarter: q };
}

// PUT /api/user-cards/:id/rotating/:year/:quarter — sets the card's bonus for
// that quarter. Body { multiplier, unit, categories, merchants, cap, activated }.
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const p = await quarterParams(params);
    if ("error" in p) return bad(p.error!);
    const card = await prisma.userCard.findUnique({
      where: { id: p.id },
      select: {
        rewardRates: {
          where: { category: { in: ["OTHER", "ROTATING"] } },
          select: { category: true, unit: true },
        },
      },
    });
    if (!card) return bad("Card not found", 404);

    const body = await req.json().catch(() => null);
    const unitOf = (c: string) => card.rewardRates.find((r) => r.category === c)?.unit;
    const parsed = parseRotatingBody(body, unitOf("OTHER") ?? unitOf("ROTATING") ?? "X");
    if (!parsed.ok) return bad(parsed.error);
    const v = parsed.value;
    const data = {
      multiplier: v.multiplier,
      unit: v.unit,
      categories: JSON.stringify(v.categories),
      merchants: JSON.stringify(v.merchants),
      excludeMerchants: JSON.stringify(v.excludeMerchants),
      cap: v.cap,
      activated: v.activated,
    };
    const key = { userCardId: p.id, year: p.year, quarter: p.quarter };
    await prisma.rotatingBonus.upsert({
      where: { userCardId_year_quarter: key },
      create: { ...key, ...data },
      update: data,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[rotating PUT]", err);
    return NextResponse.json({ error: "Failed to save quarter" }, { status: 500 });
  }
}

// DELETE /api/user-cards/:id/rotating/:year/:quarter — removes that quarter's bonus.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const p = await quarterParams(params);
    if ("error" in p) return bad(p.error!);
    const { count } = await prisma.rotatingBonus.deleteMany({
      where: { userCardId: p.id, year: p.year, quarter: p.quarter },
    });
    if (count === 0) return bad("Quarter not found", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[rotating DELETE]", err);
    return NextResponse.json({ error: "Failed to delete quarter" }, { status: 500 });
  }
}
