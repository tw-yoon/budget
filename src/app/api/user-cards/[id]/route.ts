import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// PATCH /api/user-cards/:id — update editable card fields. Every field is
// optional; only the ones present in the body are written.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: {
      annualFee?: number;
      membershipStartMonth?: number | null;
      pointValueCents?: number;
    } = {};

    if (body.annualFee !== undefined) {
      const fee = Number(body.annualFee);
      if (!Number.isFinite(fee) || fee < 0) return bad("Annual fee must be a non-negative number");
      data.annualFee = fee;
    }

    if (body.membershipStartMonth !== undefined) {
      if (body.membershipStartMonth === null) {
        data.membershipStartMonth = null;
      } else {
        const m = Number(body.membershipStartMonth);
        if (!Number.isInteger(m) || m < 1 || m > 12) return bad("Month must be between 1 and 12");
        data.membershipStartMonth = m;
      }
    }

    if (body.pointValueCents !== undefined) {
      const c = Number(body.pointValueCents);
      if (!Number.isFinite(c) || c <= 0) return bad("Point value must be greater than 0");
      data.pointValueCents = c;
    }

    if (Object.keys(data).length === 0) return bad("Nothing to update");

    await prisma.userCard.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[user-cards PATCH]", err);
    return NextResponse.json({ error: "Failed to update card" }, { status: 500 });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

// DELETE /api/user-cards/:id — removes the card and cascades its benefits.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.userCard.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[user-cards DELETE]", err);
    return NextResponse.json({ error: "Failed to delete card" }, { status: 500 });
  }
}
