import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

// Tiny key-value store for client-side state (income organizer, spending
// limit, …) backed by data/ui-state.json, so the state is shared by every
// browser instead of living in one browser's localStorage. Matches the
// on-disk persistence the other hub apps use; the previous version of the
// file is kept as ui-state.json.bak.

const FILE = path.join(process.cwd(), "data", "ui-state.json");

async function readAll(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {}; // missing (first run) or unreadable — start empty
  }
}

// GET /api/ui-state?key=X — the stored value, or null if never saved.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  const all = await readAll();
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
    const all = await readAll();
    all[body.key] = body.value ?? null;
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    try {
      await fs.copyFile(FILE, FILE + ".bak");
    } catch {
      /* first write — nothing to back up */
    }
    const tmp = FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(all, null, 2));
    await fs.rename(tmp, FILE);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ui-state PUT]", err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
