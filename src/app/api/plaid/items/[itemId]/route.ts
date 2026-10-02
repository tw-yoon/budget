import { NextRequest, NextResponse } from "next/server";
import { disconnectItem } from "@/lib/plaid-items";
import { itemStore, plaidPort } from "@/services/plaid-items.service";

// DELETE /api/plaid/items/:itemId — disconnect a bank: revoke the Plaid Item
// and delete its access token, but keep everything it recorded (accounts,
// transactions, splits, links, sync logs). Sets PlaidItem.disconnectedAt.
// Idempotent. The full cleanup is DELETE …/:itemId/history.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const { status, body } = await disconnectItem(itemId, itemStore, plaidPort);
    return NextResponse.json(body, { status });
  } catch (err) {
    console.error("[items DELETE]", err);
    return NextResponse.json({ error: "Failed to disconnect bank" }, { status: 500 });
  }
}
