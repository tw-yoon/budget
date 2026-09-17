import { NextRequest, NextResponse } from "next/server";
import {
  renameCategory,
  setPlaidPrimaries,
  deleteCategory,
  CategoryInUseError,
  UnknownCategoryError,
  MergeNotConfirmedError,
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
    const body = (await req.json()) as {
      name?: string;
      plaidPrimaries?: string[];
      allowMerge?: boolean;
    };

    let result = { merged: false, movedTransactions: 0, movedRules: 0 };
    if (body.plaidPrimaries) await setPlaidPrimaries(id, body.plaidPrimaries);
    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (!trimmed) {
        return NextResponse.json({ error: "A name is required" }, { status: 400 });
      }
      if (trimmed.includes(" > ")) {
        return NextResponse.json(
          { error: "A category name cannot contain \" > \"" },
          { status: 400 }
        );
      }
      if (trimmed.toLowerCase() === "uncategorized") {
        return NextResponse.json(
          { error: "\"Uncategorized\" is reserved — it means a row has no category" },
          { status: 400 }
        );
      }
      result = await renameCategory(id, trimmed, body.allowMerge === true);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof MergeNotConfirmedError) {
      return NextResponse.json(
        {
          error: err.message,
          merge: true,
          targetName: err.targetName,
          movingTransactions: err.movingTransactions,
          movingRules: err.movingRules,
        },
        { status: 409 }
      );
    }
    if (err instanceof Error && err.message === "Category not found") {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
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
    if (err instanceof Error && err.message === "Category not found") {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    console.error("[categories DELETE]", err);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
