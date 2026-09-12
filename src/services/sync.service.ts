/**
 * Core Plaid → SQLite sync using the /transactions/sync cursor API.
 * The cursor is persisted on PlaidItem so incremental runs only fetch new data.
 * Bouncer logic flags transfers and fees rather than dropping them.
 */

import { plaidClient } from "@/lib/plaid";
import { getAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";
import { getEnabledRulesOrdered, categorizeRow } from "@/services/rules.service";
import type { Transaction as PlaidTransaction } from "plaid";
import type { CategoryRule } from "@prisma/client";

/**
 * Bouncer + categorization keyed off Plaid's personal_finance_category (PFC).
 * The legacy top-level `category` array is deprecated and now returned empty,
 * so we use PFC's `primary`/`detailed` instead.
 *
 * Transfers and credit-card payments are flagged (not dropped) so spending
 * analytics can exclude them and avoid double-counting; the underlying
 * purchases are still recorded.
 */
const TRANSFER_PRIMARIES = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);

function classify(tx: PlaidTransaction): {
  primary: string;
  detailed: string | null;
  isTransfer: boolean;
  isFee: boolean;
} {
  const pfc = tx.personal_finance_category;
  const primary = pfc?.primary ?? "UNCATEGORIZED";
  const detailed = pfc?.detailed ?? null;

  const isTransfer =
    TRANSFER_PRIMARIES.has(primary) ||
    detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
  const isFee = primary === "BANK_FEES";

  return { primary, detailed, isTransfer, isFee };
}

export async function syncTransactions(
  itemId: string
): Promise<{ added: number; modified: number; removed: number }> {
  const accessToken = getAccessToken(itemId);
  const item = await prisma.plaidItem.findUniqueOrThrow({ where: { itemId } });

  // User auto-categorization rules, evaluated against each incoming row.
  const rules: CategoryRule[] = await getEnabledRulesOrdered();

  let cursor = item.cursor ?? undefined;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500,
    });

    const { added: addedTxs, modified: modifiedTxs, removed: removedTxs, next_cursor, has_more } =
      res.data;

    // ── Added ─────────────────────────────────────────────────────────────────
    for (const tx of addedTxs) {
      const account = await prisma.account.findUnique({
        where: { plaidAccountId: tx.account_id },
      });
      if (!account) continue; // account not yet synced — skip

      const c = classify(tx);
      const ruleCat = categorizeRow(rules, {
        name: tx.name,
        merchantName: tx.merchant_name ?? null,
      });
      await prisma.transaction.upsert({
        where: { plaidTxId: tx.transaction_id },
        create: {
          plaidTxId: tx.transaction_id,
          accountId: account.id,
          amount: tx.amount,
          date: new Date(tx.date),
          name: tx.name,
          merchantName: tx.merchant_name ?? null,
          pfcPrimary: c.primary,
          pfcDetailed: c.detailed,
          logoUrl: tx.logo_url ?? null,
          pending: tx.pending,
          isTransfer: c.isTransfer,
          isFee: c.isFee,
          userCategory: ruleCat ?? undefined,
          userCategorySource: ruleCat ? "RULE" : undefined,
        },
        update: {
          amount: tx.amount,
          date: new Date(tx.date),
          name: tx.name,
          merchantName: tx.merchant_name ?? null,
          pfcPrimary: c.primary,
          pfcDetailed: c.detailed,
          pending: tx.pending,
          isTransfer: c.isTransfer,
          isFee: c.isFee,
        },
      });
      added++;
    }

    // ── Modified ──────────────────────────────────────────────────────────────
    for (const tx of modifiedTxs) {
      const c = classify(tx);
      await prisma.transaction.updateMany({
        where: { plaidTxId: tx.transaction_id },
        data: {
          amount: tx.amount,
          date: new Date(tx.date),
          name: tx.name,
          merchantName: tx.merchant_name ?? null,
          pfcPrimary: c.primary,
          pfcDetailed: c.detailed,
          pending: tx.pending,
          isTransfer: c.isTransfer,
          isFee: c.isFee,
        },
      });

      // Re-run rules on the (possibly changed) merchant/name, but only touch
      // rows the user hasn't manually or Venmo-categorized.
      const ruleCat = categorizeRow(rules, {
        name: tx.name,
        merchantName: tx.merchant_name ?? null,
      });
      if (ruleCat) {
        await prisma.transaction.updateMany({
          where: {
            plaidTxId: tx.transaction_id,
            OR: [{ userCategorySource: null }, { userCategorySource: "RULE" }],
          },
          data: { userCategory: ruleCat, userCategorySource: "RULE" },
        });
      }
      modified++;
    }

    // ── Removed ───────────────────────────────────────────────────────────────
    for (const tx of removedTxs) {
      await prisma.transaction.deleteMany({
        where: { plaidTxId: tx.transaction_id },
      });
      removed++;
    }

    cursor = next_cursor;
    hasMore = has_more;
  }

  // Persist the new cursor and sync timestamp
  await prisma.plaidItem.update({
    where: { itemId },
    data: { cursor, lastSynced: new Date() },
  });

  // Write a sync log record
  await prisma.syncLog.create({
    data: { itemId, added, modified, removed },
  });

  return { added, modified, removed };
}
