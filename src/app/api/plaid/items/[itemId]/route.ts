import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { getAccessToken, deleteAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";

// DELETE /api/plaid/items/:itemId — disconnect a bank: revoke the Plaid Item,
// then remove its accounts, transactions, sync logs, and stored access token.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;

    const item = await prisma.plaidItem.findUnique({ where: { itemId } });
    if (!item) {
      return NextResponse.json({ error: "Bank not found" }, { status: 404 });
    }

    // Best-effort: tell Plaid to remove the Item (stops further billing).
    // Don't let a failure here block local cleanup.
    try {
      const accessToken = getAccessToken(itemId);
      await plaidClient.itemRemove({ access_token: accessToken });
    } catch (e) {
      console.warn("[items DELETE] itemRemove skipped:", e);
    }

    // Local cleanup in FK-safe order.
    const accounts = await prisma.account.findMany({
      where: { itemId },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);

    await prisma.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.account.deleteMany({ where: { itemId } });
    await prisma.syncLog.deleteMany({ where: { itemId } });
    await prisma.plaidItem.delete({ where: { itemId } });

    try {
      deleteAccessToken(itemId);
    } catch (e) {
      console.warn("[items DELETE] token removal skipped:", e);
    }

    return NextResponse.json({
      ok: true,
      institution: item.institution,
      removedAccounts: accountIds.length,
    });
  } catch (err) {
    console.error("[items DELETE]", err);
    return NextResponse.json({ error: "Failed to disconnect bank" }, { status: 500 });
  }
}
