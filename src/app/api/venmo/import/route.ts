import { NextResponse } from "next/server";
import { importVenmoStatements } from "@/services/venmo.service";

// POST /api/venmo/import — parse Venmo CSV statements from the configured
// directory and upsert them as Transactions (preserving user categories).
export async function POST() {
  try {
    const result = await importVenmoStatements();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[venmo import]", err);
    return NextResponse.json({ error: "Failed to import Venmo statements" }, { status: 500 });
  }
}
