import { NextRequest, NextResponse } from "next/server";
import {
  createSubcategory,
  renameSubcategory,
  deleteSubcategory,
  MergeNotConfirmedError,
  SubcategoryExistsError,
} from "@/services/categories.service";

// A subcategory is addressed by its category's id plus its name: a sub that is
// only used (typed into the ledger, never declared) has no row id to offer.

/** The trimmed name, or a 400 explaining why it can't be one. */
function validName(name: unknown): string | NextResponse {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  if (trimmed.includes(" > ")) {
    return NextResponse.json(
      { error: "A subcategory name cannot contain \" > \"" },
      { status: 400 }
    );
  }
  return trimmed;
}

function notFound(err: unknown) {
  return err instanceof Error && err.message === "Category not found"
    ? NextResponse.json({ error: "Category not found" }, { status: 404 })
    : null;
}

// POST /api/categories/:id/subcategories — body: { name }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const name = validName(((await req.json()) as { name?: unknown }).name);
    if (name instanceof NextResponse) return name;
    await createSubcategory(id, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SubcategoryExistsError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const missing = notFound(err);
    if (missing) return missing;
    console.error("[subcategories POST]", err);
    return NextResponse.json({ error: "Failed to add subcategory" }, { status: 500 });
  }
}

// PATCH /api/categories/:id/subcategories — body: { from, to, allowMerge? }
// Renaming onto a sub the category already has merges them, after a 409 that
// asks first — the same handshake as renaming a category.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { from?: unknown; to?: unknown; allowMerge?: boolean };
    if (typeof body.from !== "string" || !body.from) {
      return NextResponse.json({ error: "Which subcategory?" }, { status: 400 });
    }
    const to = validName(body.to);
    if (to instanceof NextResponse) return to;
    const result = await renameSubcategory(id, body.from, to, body.allowMerge === true);
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
    const missing = notFound(err);
    if (missing) return missing;
    console.error("[subcategories PATCH]", err);
    return NextResponse.json({ error: "Failed to rename subcategory" }, { status: 500 });
  }
}

// DELETE /api/categories/:id/subcategories?name=<sub> — whatever used the sub
// falls back to the bare category, and Plaid labels renamed onto it go back to
// Plaid's wording.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const name = new URL(req.url).searchParams.get("name");
    if (!name) {
      return NextResponse.json({ error: "Which subcategory?" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await deleteSubcategory(id, name)) });
  } catch (err) {
    const missing = notFound(err);
    if (missing) return missing;
    console.error("[subcategories DELETE]", err);
    return NextResponse.json({ error: "Failed to delete subcategory" }, { status: 500 });
  }
}
