/**
 * Prisma and Plaid behind the disconnect / delete-history rules in
 * src/lib/plaid-items.ts.
 */

import { plaidClient } from "@/lib/plaid";
import { getAccessToken, deleteAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";
import type { ItemStore, PlaidPort } from "@/lib/plaid-items";

export const itemStore: ItemStore = {
  findItem: (itemId) =>
    prisma.plaidItem.findUnique({
      where: { itemId },
      select: { itemId: true, institution: true, disconnectedAt: true },
    }),

  async markDisconnected(itemId, at) {
    await prisma.plaidItem.update({ where: { itemId }, data: { disconnectedAt: at } });
  },

  // FK-safe order. Splits cascade with their transaction, debit cards with
  // their account, and other banks' refunds linked to these rows have the
  // link cleared (onDelete: SetNull).
  deleteHistory: (itemId) =>
    prisma.$transaction(async (tx) => {
      const accounts = await tx.account.findMany({ where: { itemId }, select: { id: true } });
      const accountIds = accounts.map((a) => a.id);
      const { count: removedTransactions } = await tx.transaction.deleteMany({
        where: { accountId: { in: accountIds } },
      });
      await tx.account.deleteMany({ where: { itemId } });
      await tx.syncLog.deleteMany({ where: { itemId } });
      await tx.plaidItem.delete({ where: { itemId } });
      return { removedAccounts: accountIds.length, removedTransactions };
    }),
};

export const plaidPort: PlaidPort = {
  async revoke(itemId) {
    await plaidClient.itemRemove({ access_token: getAccessToken(itemId) });
  },
  deleteToken: deleteAccessToken,
};

/** True when the item exists and is disconnected; Plaid callers skip it. */
export async function isDisconnected(itemId: string): Promise<boolean> {
  const item = await prisma.plaidItem.findUnique({
    where: { itemId },
    select: { disconnectedAt: true },
  });
  return item?.disconnectedAt != null;
}
