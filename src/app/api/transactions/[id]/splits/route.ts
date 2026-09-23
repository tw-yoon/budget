import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { joinCategory } from "@/lib/categories";
import { roundToCents, validateNewSplit } from "@/lib/splits";

// POST /api/transactions/:id/splits — carve part of a purchase out under its
// own category.
//   body: { amount: number, category: string, subcategory?: string | null }
//
// The leftover is never written. It is derived on read from the transaction's
// amount and the parts stored here, so this endpoint has nothing to keep in
// step when Plaid later revises that amount.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      amount?: number;
      category?: string | null;
      subcategory?: string | null;
    };

    const row = await prisma.transaction.findUnique({
      where: { id },
      select: {
        amount: true,
        pending: true,
        splits: { select: { amount: true } },
      },
    });
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const category = body.category?.trim() || "";
    const subcategory = body.subcategory?.trim() || null;
    const userCategory = category ? joinCategory(category, subcategory) : "";
    // Rounded to cents: the client sends a plain number from React state, not
    // a form-validated one, so `step="0.01"` on the input never actually stops
    // something like 30.005 from reaching here and breaking the "slices sum
    // back to the transaction" invariant by half a cent.
    const amount = roundToCents(Number(body.amount));

    const problem = validateNewSplit(row, row.splits, { amount, userCategory });
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    const split = await prisma.transactionSplit.create({
      data: { transactionId: id, amount, userCategory },
      select: { id: true, amount: true, userCategory: true },
    });
    return NextResponse.json(split, { status: 201 });
  } catch (err) {
    console.error("[splits POST]", err);
    return NextResponse.json({ error: "Failed to add split" }, { status: 500 });
  }
}
