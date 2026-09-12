import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { CountryCode } from "plaid";
import { plaidClient } from "@/lib/plaid";
import { saveAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";
import { upsertAccounts } from "@/services/accounts.service";
import { syncTransactions } from "@/services/sync.service";

const TOKENS_FILE = "data/access-tokens.json";

/**
 * Imports existing Plaid access tokens directly — no Link, no OAuth.
 * Reads access-production-… tokens from a gitignored local file, derives each
 * item's institution + accounts from Plaid, stores the token encrypted, and
 * syncs transactions.
 *
 *   1. put your tokens in data/access-tokens.json (array of strings)
 *   2. curl -X POST http://localhost:3000/api/plaid/import-tokens
 *
 * The tokens must have been issued under the same PLAID_CLIENT_ID that is in
 * .env.local, or Plaid will reject them.
 */
export async function POST() {
  const filePath = path.resolve(process.cwd(), TOKENS_FILE);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: `Create ${TOKENS_FILE} with a JSON array of access-production-… tokens.` },
      { status: 400 }
    );
  }

  let tokens: string[];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    tokens = Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string" && t.startsWith("access-"))
      : [];
  } catch {
    return NextResponse.json({ error: `${TOKENS_FILE} is not valid JSON.` }, { status: 400 });
  }

  if (tokens.length === 0) {
    return NextResponse.json(
      { error: "No valid tokens found — each must start with 'access-'. Replace the placeholders." },
      { status: 400 }
    );
  }

  const imported: unknown[] = [];

  for (const accessToken of tokens) {
    try {
      const itemRes = await plaidClient.itemGet({ access_token: accessToken });
      const itemId = itemRes.data.item.item_id;
      const institutionId = itemRes.data.item.institution_id ?? null;

      let institution = institutionId ?? "Unknown";
      if (institutionId) {
        try {
          const inst = await plaidClient.institutionsGetById({
            institution_id: institutionId,
            country_codes: [CountryCode.Us],
          });
          institution = inst.data.institution.name;
        } catch {
          /* keep the id as the name if lookup fails */
        }
      }

      // Persist the token encrypted on disk (never in the DB).
      saveAccessToken(itemId, accessToken);

      await prisma.plaidItem.upsert({
        where: { itemId },
        create: { itemId, institution },
        update: { institution },
      });

      const acctRes = await plaidClient.accountsGet({ access_token: accessToken });
      await upsertAccounts(itemId, acctRes.data.accounts);

      const sync = await syncTransactions(itemId);
      imported.push({
        itemId,
        institution,
        accounts: acctRes.data.accounts.length,
        ...sync,
        success: true,
      });
    } catch (err) {
      imported.push({
        tokenPrefix: accessToken.slice(0, 22) + "…",
        success: false,
        error: extractPlaidError(err),
      });
    }
  }

  return NextResponse.json({ imported });
}

function extractPlaidError(err: unknown): unknown {
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response?: { data?: unknown } }).response;
    return resp?.data ?? String(err);
  }
  return err instanceof Error ? err.message : String(err);
}
