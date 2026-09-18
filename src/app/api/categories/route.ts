import { NextRequest, NextResponse } from "next/server";
import {
  listCategories,
  createCategory,
  listUnmappedPrimaries,
} from "@/services/categories.service";
import { PFC_PRIMARIES } from "@/lib/rules";

// GET /api/categories — the editable list, with how many transactions and rules
// use each, plus the Plaid primaries available to map. The counts are what let
// the UI disable a delete and explain the refusal. `unmappedPrimaries` is the
// set of real Plaid primaries in use that `primaries` doesn't cover and that
// therefore resolve to no category — see listUnmappedPrimaries.
export async function GET() {
  try {
    return NextResponse.json({
      categories: await listCategories(),
      primaries: [...PFC_PRIMARIES].sort(),
      unmappedPrimaries: await listUnmappedPrimaries(),
    });
  } catch (err) {
    console.error("[categories GET]", err);
    return NextResponse.json({ error: "Failed to load categories" }, { status: 500 });
  }
}

// POST /api/categories — body: { name }
export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };
    const trimmed = name?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "A name is required" }, { status: 400 });
    }
    if (trimmed.includes(" > ")) {
      return NextResponse.json(
        { error: "A category name cannot contain \" > \" — that separates a subcategory" },
        { status: 400 }
      );
    }
    if (trimmed.toLowerCase() === "uncategorized") {
      return NextResponse.json(
        { error: "\"Uncategorized\" is reserved — it means a row has no category" },
        { status: 400 }
      );
    }
    return NextResponse.json({ category: await createCategory(trimmed) });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "That category already exists" }, { status: 409 });
    }
    console.error("[categories POST]", err);
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
