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
import { nextLabel, withLabelLock } from "@/lib/next-label";
import type { Transaction as PlaidTransaction } from "plaid";
import type { CategoryRule, Prisma } from "@prisma/client";

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

/** The fields Plaid owns, refreshed whenever it sends the row again. */
function plaidFields(tx: PlaidTransaction) {
  const pfc = tx.personal_finance_category;
  const primary = pfc?.primary ?? "UNCATEGORIZED";
  const detailed = pfc?.detailed ?? null;
  return {
    amount: tx.amount,
    date: new Date(tx.date),
    name: tx.name,
    merchantName: tx.merchant_name ?? null,
    pfcPrimary: primary,
    pfcDetailed: detailed,
    pending: tx.pending,
    isTransfer:
      TRANSFER_PRIMARIES.has(primary) || detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    isFee: primary === "BANK_FEES",
  };
}

export function syncTransactions(
  itemId: string
): Promise<{ added: number; modified: number; removed: number }> {
  return withLabelLock(() => syncItem(itemId));
}

async function syncItem(
  itemId: string
): Promise<{ added: number; modified: number; removed: number }> {
  const item = await prisma.plaidItem.findUniqueOrThrow({ where: { itemId } });
  // A disconnected bank has no token left; never call Plaid for it. Callers
  // already skip these (see pickConnectedItems); this is the backstop.
  if (item.disconnectedAt) throw new Error(`${item.institution} is disconnected`);
  const accessToken = getAccessToken(itemId);

  // Pick up accounts added since the last sync. Reconnecting a bank can add a
  // new card to a login that was already linked, and /transactions/sync starts
  // returning that card's transactions straight away. The cursor advances
  // whether or not we can store them, so a transaction whose account we don't
  // know yet is not just skipped -- it is never offered again. Refreshing the
  // account list first is what keeps that from happening.
  const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
  await upsertAccounts(itemId, accountsRes.data.accounts);
  const accountIds = new Map(
    (await prisma.account.findMany({ select: { id: true, plaidAccountId: true } }))
      .map((a) => [a.plaidAccountId, a.id])
  );

  // User auto-categorization rules, evaluated against each incoming row.
  const rules: CategoryRule[] = await getEnabledRulesOrdered();

  let cursor = item.cursor ?? undefined;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;
  // The lock is held, so labels can be counted up locally from the max.
  let nextFree = await nextLabel();

  while (hasMore) {
    const res = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500,
    });

    const { added: addedTxs, modified: modifiedTxs, removed: removedTxs, next_cursor, has_more } =
      res.data;

    // Each page is written in one transaction rather than a commit per row.
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    const known = new Set(
      (await prisma.transaction.findMany({
        where: { externalId: { in: addedTxs.map((tx) => tx.transaction_id) } },
        select: { externalId: true },
      })).map((t) => t.externalId)
    );

    // ── Added ─────────────────────────────────────────────────────────────────
    for (const tx of addedTxs) {
      const accountId = accountIds.get(tx.account_id);
      if (!accountId) continue; // safety net: accounts are refreshed above

      const fields = plaidFields(tx);
      const ruleCat = categorizeRow(rules, {
        name: tx.name,
        merchantName: tx.merchant_name ?? null,
      });
      // Only a row that is really new takes a number, so none is burned.
      let label = 0;
      if (!known.has(tx.transaction_id)) {
        label = nextFree++;
        known.add(tx.transaction_id);
      }
      ops.push(prisma.transaction.upsert({
        where: { externalId: tx.transaction_id },
        create: {
          ...fields,
          externalId: tx.transaction_id,
          accountId,
          logoUrl: tx.logo_url ?? null,
          userCategory: ruleCat ?? undefined,
          userCategorySource: ruleCat ? "RULE" : undefined,
          label,
        },
        update: fields,
      }));
      added++;
    }

    // ── Modified ──────────────────────────────────────────────────────────────
    for (const tx of modifiedTxs) {
      ops.push(prisma.transaction.updateMany({
        where: { externalId: tx.transaction_id },
        data: plaidFields(tx),
      }));

      // Re-run rules on the (possibly changed) merchant/name, but only touch
      // rows the user hasn't manually or Venmo-categorized.
      const ruleCat = categorizeRow(rules, {
        name: tx.name,
        merchantName: tx.merchant_name ?? null,
      });
      if (ruleCat) {
        ops.push(prisma.transaction.updateMany({
          where: {
            externalId: tx.transaction_id,
            linkedToId: null,
            OR: [{ userCategorySource: null }, { userCategorySource: "RULE" }],
          },
          data: { userCategory: ruleCat, userCategorySource: "RULE" },
        }));
      }
      modified++;
    }

    // ── Removed ───────────────────────────────────────────────────────────────
    ops.push(prisma.transaction.deleteMany({
      where: { externalId: { in: removedTxs.map((tx) => tx.transaction_id) } },
    }));
    removed += removedTxs.length;
    await prisma.$transaction(ops);

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
