import { NextRequest, NextResponse } from "next/server";
import { deleteItemHistory } from "@/lib/plaid-items";
import { itemStore, plaidPort } from "@/services/plaid-items.service";

// DELETE /api/plaid/items/:itemId/history — delete everything a bank recorded:
// its transactions (splits cascade; links pointing at them are cleared), its
// accounts, sync logs and the PlaidItem itself. A connected bank is
// disconnected first (Plaid Item revoked, access token deleted), in the same
// step. Cannot be undone.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const { status, body } = await deleteItemHistory(itemId, itemStore, plaidPort);
    return NextResponse.json(body, { status });
  } catch (err) {
    console.error("[items history DELETE]", err);
    return NextResponse.json({ error: "Failed to delete bank history" }, { status: 500 });
  }
}
