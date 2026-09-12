import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { saveAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";
import { upsertAccounts } from "@/services/accounts.service";

export async function POST(req: NextRequest) {
  try {
    const { public_token, institution_name } = await req.json();

    if (!public_token || typeof public_token !== "string") {
      return NextResponse.json({ error: "public_token is required" }, { status: 400 });
    }

    // Exchange public token for access token
    const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeRes.data;

    // Persist access token encrypted on disk — never in the database
    saveAccessToken(item_id, access_token);

    // Fetch initial accounts so we can store them right away
    const accountsRes = await plaidClient.accountsGet({ access_token });

    // Upsert the PlaidItem row (no access_token column — by design)
    const item = await prisma.plaidItem.upsert({
      where: { itemId: item_id },
      create: { itemId: item_id, institution: institution_name ?? "Unknown" },
      update: { institution: institution_name ?? "Unknown" },
    });

    // Upsert each account (shared mapping — see accounts.service)
    await upsertAccounts(item.itemId, accountsRes.data.accounts);

    return NextResponse.json({ item_id, accounts: accountsRes.data.accounts.length });
  } catch (err) {
    console.error("[exchange-token]", err);
    return NextResponse.json(
      { error: "Token exchange failed" },
      { status: 500 }
    );
  }
}
