/**
 * Core Plaid → SQLite sync using the /transactions/sync cursor API.
 * The cursor is persisted on PlaidItem so incremental runs only fetch new data.
 * Bouncer logic flags transfers and fees rather than dropping them.
 */

import { plaidClient } from "@/lib/plaid";
import { getAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";
import { getEnabledRulesOrdered, categorizeRow } from "@/services/rules.service";
import { upsertAccounts } from "@/services/accounts.service";
import { nextLabel } from "@/lib/next-label";
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

  // Pick up accounts added since the last sync. Reconnecting a bank can add a
  // new card to a login that was already linked, and /transactions/sync starts
  // returning that card's transactions straight away. The cursor advances
  // whether or not we can store them, so a transaction whose account we don't
  // know yet is not just skipped -- it is never offered again. Refreshing the
  // account list first is what keeps that from happening.
  const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
  await upsertAccounts(itemId, accountsRes.data.accounts);

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
      if (!account) continue; // safety net: accounts are refreshed above

      const c = classify(tx);
      const ruleCat = categorizeRow(rules, {
        name: tx.name,
        merchantName: tx.merchant_name ?? null,
      });
      // Computed before the upsert so it is available to the `create` branch.
      // If the row already exists we take the update branch and this value goes
      // unused — no number is burned, since the maximum is unchanged.
      const label = await nextLabel();
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
          label,
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
            linkedToId: null,
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

  // A retracted transaction nulls linkedToId on any refund pointing at it
  // (onDelete: SetNull), but leaves userCategorySource = "LINK" behind. That
  // orphan would be invisible to the rules engine forever, so sweep it here.
  await prisma.transaction.updateMany({
    where: { linkedToId: null, userCategorySource: "LINK" },
    data: { userCategorySource: null },
  });

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
