import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// PATCH /api/benefits/:id — update manual usage or the perk switch.
// Body one of:
//   { usedManual: number | null }            current-period override (null reverts)
//   { periodKey: string, value: number|null }per-window override (null clears the key)
//   { perkActive: boolean }                  switch a flat-value perk on/off
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Flat-value perk switch. Stamped with "now" so windows that closed before
    // activation stay at $0 — you didn't have the perk yet.
    if (typeof body.perkActive === "boolean") {
      await prisma.userBenefit.update({
        where: { id },
        data: { perkActiveFrom: body.perkActive ? new Date() : null },
      });
      return NextResponse.json({ ok: true });
    }

    // Per-window override of a specific period in the yearly view.
    if (typeof body.periodKey === "string") {
      const key = body.periodKey.trim();
      if (!key) return bad("periodKey is required");

      const benefit = await prisma.userBenefit.findUnique({
        where: { id },
        select: { manualOverrides: true },
      });
      if (!benefit) return bad("Benefit not found", 404);

      let map: Record<string, number> = {};
      try {
        const parsed = JSON.parse(benefit.manualOverrides);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed;
      } catch {
        map = {};
      }

      if (body.value === null || body.value === undefined) {
        delete map[key];
      } else {
        const n = Number(body.value);
        if (!Number.isFinite(n) || n < 0) return bad("value must be a number ≥ 0");
        map[key] = n;
      }

      await prisma.userBenefit.update({
        where: { id },
        data: { manualOverrides: JSON.stringify(map) },
      });
      return NextResponse.json({ ok: true });
    }

    // Legacy current-period override.
    let usedManual: number | null = null;
    if (body.usedManual !== null && body.usedManual !== undefined) {
      const n = Number(body.usedManual);
      if (!Number.isFinite(n) || n < 0) return bad("usedManual must be a number ≥ 0");
      usedManual = n;
    }

    await prisma.userBenefit.update({ where: { id }, data: { usedManual } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[benefits PATCH]", err);
    return NextResponse.json({ error: "Failed to update benefit" }, { status: 500 });
  }
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// DELETE /api/benefits/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.userBenefit.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[benefits DELETE]", err);
    return NextResponse.json({ error: "Failed to delete benefit" }, { status: 500 });
  }
}
