import { NextResponse } from "next/server";
import { Products } from "plaid";
import { plaidClient } from "@/lib/plaid";
import { saveAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";
import { upsertAccounts } from "@/services/accounts.service";
import { syncTransactions } from "@/services/sync.service";

/**
 * DEV ONLY. Seeds the local DB with a sandbox bank using Plaid's
 * /sandbox/public_token/create — no Link UI required. Refuses to run unless
 * PLAID_ENV=sandbox so it can never touch real data.
 *
 *   curl -X POST http://localhost:3000/api/plaid/sandbox-seed
 */
export async function POST() {
  if (process.env.PLAID_ENV !== "sandbox") {
    return NextResponse.json(
      { error: "Seeding is only allowed when PLAID_ENV=sandbox" },
      { status: 403 }
    );
  }

  try {
    // 1. Mint a sandbox public token for a test institution
    const ptRes = await plaidClient.sandboxPublicTokenCreate({
      institution_id: "ins_109508", // "First Platypus Bank" (sandbox)
      initial_products: [Products.Transactions],
    });

    // 2. Exchange it like a normal Link flow
    const exRes = await plaidClient.itemPublicTokenExchange({
      public_token: ptRes.data.public_token,
    });
    const { access_token, item_id } = exRes.data;
    saveAccessToken(item_id, access_token);

    // 3. Store the item + accounts
    await prisma.plaidItem.upsert({
      where: { itemId: item_id },
      create: { itemId: item_id, institution: "First Platypus Bank (Sandbox)" },
      update: {},
    });
    const accountsRes = await plaidClient.accountsGet({ access_token });
    await upsertAccounts(item_id, accountsRes.data.accounts);

    // 4. Pull transactions
    const sync = await syncTransactions(item_id);

    return NextResponse.json({
      item_id,
      institution: "First Platypus Bank (Sandbox)",
      accounts: accountsRes.data.accounts.length,
      ...sync,
    });
  } catch (err) {
    console.error("[sandbox-seed]", err);
    const detail =
      err && typeof err === "object" && "response" in err
        ? // @ts-expect-error Plaid axios error shape
          err.response?.data
        : String(err);
    return NextResponse.json(
      { error: "Sandbox seed failed", detail },
      { status: 500 }
    );
  }
}
