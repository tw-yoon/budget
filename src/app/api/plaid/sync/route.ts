import { NextRequest, NextResponse } from "next/server";
import { syncTransactions } from "@/services/sync.service";
import { prisma } from "@/lib/prisma";
import { pickConnectedItems } from "@/lib/plaid-items";
import { plaidErrorCode } from "@/lib/plaid-errors";

// Plaid error codes that mean "this item has no Transactions product" rather
// than a real failure — e.g. an investments-only connection (Robinhood, a
// 401k). We treat these as skipped, not failed.
const SKIP_CODES = new Set([
  "ADDITIONAL_CONSENT_REQUIRED",
  "PRODUCTS_NOT_SUPPORTED",
]);

// POST /api/plaid/sync  — body: { item_id } or omit to sync all items
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { item_id } = body as { item_id?: string };

    // A disconnected bank has no token left: skip it, or 409 if asked by id.
    const picked = pickConnectedItems(
      await prisma.plaidItem.findMany(item_id ? { where: { itemId: item_id } } : undefined),
      item_id
    );
    if (!picked.ok) {
      return NextResponse.json({ error: picked.error }, { status: picked.status });
    }
    const items = picked.items;

    // Investments-only items (Robinhood, a 401k) were linked with the
    // Investments product, not Transactions — calling /transactions/sync on
    // them returns ADDITIONAL_CONSENT_REQUIRED. Identify them by their accounts
    // (all INVESTMENT) and skip the doomed call entirely.
    const investmentOnly = new Set<string>();
    for (const item of items) {
      const types = await prisma.account.findMany({
        where: { itemId: item.itemId },
        select: { type: true },
        distinct: ["type"],
      });
      if (types.length > 0 && types.every((t) => t.type === "INVESTMENT")) {
        investmentOnly.add(item.itemId);
      }
    }

    const syncable = items.filter((i) => !investmentOnly.has(i.itemId));

    const results = await Promise.allSettled(
      syncable.map((item) => syncTransactions(item.itemId))
    );

    const synced = results.map((r, i) => {
      const base = {
        itemId: syncable[i].itemId,
        institution: syncable[i].institution,
      };
      if (r.status === "fulfilled") return { ...base, success: true, ...r.value };
      const code = plaidErrorCode(r.reason);
      // Safety net: an item that still reports a missing-product/consent error
      // (e.g. an investments item with no accounts yet) is skipped, not failed.
      if (SKIP_CODES.has(code)) return { ...base, success: true, skipped: true };
      return { ...base, success: false, error: code };
    });

    const skipped = items
      .filter((i) => investmentOnly.has(i.itemId))
      .map((i) => ({
        itemId: i.itemId,
        institution: i.institution,
        success: true,
        skipped: true,
      }));

    return NextResponse.json({ summary: [...synced, ...skipped] });
  } catch (err) {
    console.error("[sync]", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
