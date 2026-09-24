import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { createUiStateStore } from "@/lib/ui-state-store";

// Tiny key-value store for client-side state (income organizer, spending
// limit, …) backed by data/ui-state.json, so the state is shared by every
// browser instead of living in one browser's localStorage. Matches the
// on-disk persistence the other hub apps use; the previous version of the
// file is kept as ui-state.json.bak.

const store = createUiStateStore(path.join(process.cwd(), "data", "ui-state.json"));

// GET /api/ui-state?key=X — the stored value, or null if never saved.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  const all = await store.readAll();
  return NextResponse.json(
    { value: key in all ? all[key] : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// PUT /api/ui-state — body {key, value}; value replaces the stored one.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body?.key !== "string" || !body.key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }
    const { key, value } = body as { key: string; value: unknown };
    await store.put(key, value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ui-state PUT]", err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
