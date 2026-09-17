import { NextRequest, NextResponse } from "next/server";
import {
  renameCategory,
  setPlaidPrimaries,
  deleteCategory,
  CategoryInUseError,
  UnknownCategoryError,
} from "@/services/categories.service";

// PATCH /api/categories/:id — body: { name?, plaidPrimaries? }
// Renaming onto an existing name merges into it; the response says so, and how
// much moved, so the UI can report what actually happened.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { name?: string; plaidPrimaries?: string[] };

    let result = { merged: false, movedTransactions: 0, movedRules: 0 };
    if (body.plaidPrimaries) await setPlaidPrimaries(id, body.plaidPrimaries);
    if (body.name) {
      if (body.name.includes(" > ")) {
        return NextResponse.json(
          { error: "A category name cannot contain \" > \"" },
          { status: 400 }
        );
      }
      result = await renameCategory(id, body.name);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[categories PATCH]", err);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

// DELETE /api/categories/:id?reassignTo=<name> — without reassignTo, a category
// still in use is refused with the counts that explain why.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const reassignTo = new URL(req.url).searchParams.get("reassignTo") ?? undefined;
    await deleteCategory(id, reassignTo);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CategoryInUseError) {
      return NextResponse.json(
        {
          error: "Still in use",
          transactionCount: err.transactionCount,
          ruleCount: err.ruleCount,
          mappingCount: err.mappingCount,
        },
        { status: 409 }
      );
    }
    if (err instanceof UnknownCategoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[categories DELETE]", err);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
