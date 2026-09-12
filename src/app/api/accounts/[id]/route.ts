import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// PATCH /api/accounts/:id — set/clear manual credit-card overrides.
// Body may include: { manualDueDay: 1-31 | null, manualAvailableCredit: >=0 | null }
// Each field is only touched if present; "" or null clears it.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const data: {
      displayName?: string | null;
      manualDueDay?: number | null;
      manualCreditLimit?: number | null;
    } = {};

    if ("displayName" in body) {
      const raw = body.displayName;
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      data.displayName = trimmed === "" ? null : trimmed;
    }

    if ("manualDueDay" in body) {
      const raw = body.manualDueDay;
      if (raw === null || raw === "" || raw === undefined) {
        data.manualDueDay = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 31) {
          return NextResponse.json(
            { error: "manualDueDay must be a whole number from 1 to 31" },
            { status: 400 }
          );
        }
        data.manualDueDay = n;
      }
    }

    if ("manualCreditLimit" in body) {
      const raw = body.manualCreditLimit;
      if (raw === null || raw === "" || raw === undefined) {
        data.manualCreditLimit = null;
      } else {
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0) {
          return NextResponse.json(
            { error: "manualCreditLimit must be a number ≥ 0" },
            { status: 400 }
          );
        }
        data.manualCreditLimit = v;
      }
    }

    await prisma.account.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[accounts PATCH]", err);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}
