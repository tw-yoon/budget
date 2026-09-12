import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { joinCategory } from "@/lib/categories";

// PATCH /api/transactions/:id — manually override a transaction's category.
//   body: { category: string | null, subcategory?: string | null }
// Stored as "Category > Subcategory" when a subcategory is given, otherwise
// just the category (the sub defaults to the category itself in analytics).
// category: null clears the override, reverting to Plaid's PFC category.
// Manual edits set userCategorySource=MANUAL so the rules engine never
// clobbers them.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      category?: string | null;
      subcategory?: string | null;
    };

    const category = body.category?.trim() || null;
    const subcategory = body.subcategory?.trim() || null;

    const userCategory = category ? joinCategory(category, subcategory) : null;

    const { count } = await prisma.transaction.updateMany({
      where: { id },
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
