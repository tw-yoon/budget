import { NextRequest, NextResponse } from "next/server";
import { confirmMerge, parsePairsParam, previewMerge } from "@/lib/reconnect-merge";
import { mergeStore } from "@/services/reconnect-merge.service";

// Merging a disconnected bank into its reconnection.
// docs/superpowers/specs/2026-10-02-reconnect-merges-history-design.md

// GET /api/plaid/items/:itemId/merge?into=<itemId>[&pairs=old:new,…] — the
// review: account pairs (suggested unless `pairs` is given) and the possible
// duplicate transactions. Changes nothing.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const q = req.nextUrl.searchParams;
    const { status, body } = await previewMerge(
      itemId,
      q.get("into"),
      parsePairsParam(q.get("pairs")),
      mergeStore
    );
    return NextResponse.json(body, { status });
  } catch (err) {
    console.error("[merge GET]", err);
    return NextResponse.json({ error: "Failed to load the merge review" }, { status: 500 });
  }
}

// POST /api/plaid/items/:itemId/merge — { into, accounts: [{ from, to }],
// duplicates: [{ keep, drop }] }. Re-checks every pair, snapshots the
// database, then merges in one transaction.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const body = await req.json().catch(() => null);
    const { status, body: out } = await confirmMerge(itemId, body, mergeStore);
    return NextResponse.json(out, { status });
  } catch (err) {
    console.error("[merge POST]", err);
    return NextResponse.json({ error: "Failed to merge" }, { status: 500 });
  }
}
