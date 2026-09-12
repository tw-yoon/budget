import { NextRequest, NextResponse } from "next/server";
import { syncTransactions } from "@/services/sync.service";
import { prisma } from "@/lib/prisma";

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

    const items = item_id
      ? await prisma.plaidItem.findMany({ where: { itemId: item_id } })
      : await prisma.plaidItem.findMany();

    if (items.length === 0) {
      return NextResponse.json({ error: "No linked items found" }, { status: 404 });
    }

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

// Surface Plaid's error_code (e.g. ITEM_LOGIN_REQUIRED) instead of a generic
// "AxiosError: Request failed with status code 400".
function plaidErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: { error_code?: string } } }).response?.data;
    if (data?.error_code) return data.error_code;
  }
  return err instanceof Error ? err.message : String(err);
}
