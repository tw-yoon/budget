import { prisma } from "@/lib/prisma";
import type { AccountBase } from "plaid";

/**
 * Upserts Plaid accounts into the local DB. Shared by the token-exchange flow
 * and the sandbox seeder so the mapping lives in exactly one place.
 */
export async function upsertAccounts(itemId: string, accounts: AccountBase[]) {
  const ops = accounts.map((a) =>
    prisma.account.upsert({
      where: { plaidAccountId: a.account_id },
      create: {
        plaidAccountId: a.account_id,
        itemId,
        name: a.name,
        officialName: a.official_name ?? null,
        mask: a.mask ?? null,
        type: String(a.type).toUpperCase(),
        subtype: a.subtype ?? null,
        currentBalance: a.balances.current ?? 0,
        availableBalance: a.balances.available ?? null,
        balanceFetchedAt: new Date(),
      },
      update: {
        name: a.name,
        currentBalance: a.balances.current ?? 0,
        availableBalance: a.balances.available ?? null,
        balanceFetchedAt: new Date(),
      },
    })
  );
  return prisma.$transaction(ops);
}
