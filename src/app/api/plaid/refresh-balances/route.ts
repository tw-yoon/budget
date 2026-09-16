import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { getAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";
import { syncLiabilities } from "@/services/liabilities.service";
import { upsertAccounts } from "@/services/accounts.service";

// POST /api/plaid/refresh-balances — body: { item_id } or omit for all
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

    const updated: { accountId: string; name: string; current: number; available: number | null }[] = [];
    const liabilities: { itemId: string; institution: string; ok: boolean; updated: number; error?: string }[] = [];
    const errors: { itemId: string; institution: string; error: string }[] = [];

    // Each item is handled independently — one bad connection (e.g. a token
    // that needs re-auth) must not abort the whole refresh.
    for (const item of items) {
      try {
        const accessToken = getAccessToken(item.itemId);

        // /accounts/balance/get always returns real-time balances, unlike /accounts/get
        const res = await plaidClient.accountsBalanceGet({ access_token: accessToken });

        // Upsert, not update: reconnecting a bank can add an account to a
        // login that was already linked -- a new card on the same login --
        // and Plaid hands it back here before anything has created its row.
        // `update` raised "record to update not found" for that one account,
        // and because every account on the item went into a single
        // transaction, it took every other balance on that login down with it.
        const rows = await upsertAccounts(item.itemId, res.data.accounts);

        rows.forEach((row) =>
          updated.push({
            accountId: row.id,
            name: row.name,
            current: row.currentBalance,
            available: row.availableBalance,
          })
        );

        // Best-effort: pull credit-card payment due dates.
        liabilities.push({
          itemId: item.itemId,
          institution: item.institution,
          ...(await syncLiabilities(item.itemId)),
        });
      } catch (err) {
        console.error(`[refresh-balances] item ${item.itemId} failed:`, err);
        errors.push({
          itemId: item.itemId,
          institution: item.institution,
          error: plaidErrorCode(err),
        });
      }
    }

    return NextResponse.json({ updated, liabilities, errors });
  } catch (err) {
    console.error("[refresh-balances]", err);
    return NextResponse.json({ error: "Balance refresh failed" }, { status: 500 });
  }
}

function plaidErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: { error_code?: string } } }).response?.data;
    if (data?.error_code) return data.error_code;
  }
  return err instanceof Error ? err.message : String(err);
}
