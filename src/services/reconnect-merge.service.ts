/**
 * Prisma behind the reconnect-merge rules in src/lib/reconnect-merge.ts.
 * docs/superpowers/specs/2026-10-02-reconnect-merges-history-design.md
 */

import path from "node:path";
import { mkdirSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import type { MergeAccount, MergePlan, MergeStore, MergeTx } from "@/lib/reconnect-merge";

// Plaid's side of an account: what the new connection reports, and what the
// survivor takes over.
const PLAID_ACCOUNT_FIELDS = {
  plaidAccountId: true,
  itemId: true,
  name: true,
  officialName: true,
  mask: true,
  type: true,
  subtype: true,
  currentBalance: true,
  availableBalance: true,
  balanceFetchedAt: true,
  nextPaymentDueDate: true,
  lastStatementBalance: true,
  minimumPaymentAmount: true,
  paymentIsOverdue: true,
} as const;

// Plaid's side of a transaction, which the survivor takes from its duplicate.
const PLAID_TX_FIELDS = {
  externalId: true,
  amount: true,
  date: true,
  name: true,
  merchantName: true,
  pfcPrimary: true,
  pfcDetailed: true,
  logoUrl: true,
  pending: true,
  isTransfer: true,
  isFee: true,
} as const;

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");

export const mergeStore: MergeStore = {
  findItem: (itemId) =>
    prisma.plaidItem.findUnique({
      where: { itemId },
      select: { itemId: true, institution: true, disconnectedAt: true },
    }),

  async listAccounts(itemId): Promise<MergeAccount[]> {
    const rows = await prisma.account.findMany({
      where: { itemId },
      include: { _count: { select: { transactions: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((a) => ({
      id: a.id,
      itemId: a.itemId,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      displayName: a.displayName,
      manualDueDay: a.manualDueDay,
      manualCreditLimit: a.manualCreditLimit,
      transactionCount: a._count.transactions,
    }));
  },

  async mergedAccountIds(fromItemId, intoItemId) {
    const rows = await prisma.reconnectMerge.findMany({
      where: { fromItemId, intoItemId },
      select: { accountIds: true },
    });
    return rows.flatMap((r) => JSON.parse(r.accountIds) as string[]);
  },

  async listTransactions(accountIds): Promise<MergeTx[]> {
    const rows = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds } },
      include: { _count: { select: { splits: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      externalId: t.externalId,
      source: t.source,
      label: t.label,
      amount: t.amount,
      date: t.date,
      name: t.name,
      merchantName: t.merchantName,
      pending: t.pending,
      priorItemId: t.priorItemId,
      userCategory: t.userCategory,
      userCategorySource: t.userCategorySource,
      personalNote: t.personalNote,
      counterparty: t.counterparty,
      linkedToId: t.linkedToId,
      fundsCashoutId: t.fundsCashoutId,
      splitCount: t._count.splits,
    }));
  },

  // VACUUM INTO writes a consistent copy while the server keeps running, next
  // to the daily and pre-update copies Budget.command keeps in prisma/backups.
  async snapshot(at) {
    const dbs = await prisma.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    const main = dbs.find((d) => d.name === "main")?.file;
    if (!main) throw new Error("No database file to back up");
    const dir = path.join(path.dirname(main), "backups");
    mkdirSync(dir, { recursive: true });
    const file = `pre-merge-${stamp(at)}.db`;
    await prisma.$executeRawUnsafe(`VACUUM INTO '${path.join(dir, file).replace(/'/g, "''")}'`);
    return file;
  },

  apply: (plan: MergePlan) =>
    prisma.$transaction(async (tx) => {
      const detail: { accounts: unknown[]; duplicates: unknown[] } = { accounts: [], duplicates: [] };

      // 1. Accounts: the old account takes over the new connection.
      for (const { survivor, removed, settings } of plan.accounts) {
        const before = await tx.account.findUniqueOrThrow({ where: { id: survivor.id } });
        const gone = await tx.account.findUniqueOrThrow({ where: { id: removed.id } });

        await tx.transaction.updateMany({
          where: { accountId: survivor.id, source: "PLAID" },
          data: { priorItemId: plan.fromItemId },
        });
        const moved = await tx.transaction.findMany({
          where: { accountId: removed.id },
          select: { id: true },
        });
        await tx.transaction.updateMany({
          where: { accountId: removed.id },
          data: { accountId: survivor.id },
        });
        const debitCards = await tx.debitCard.findMany({ where: { accountId: removed.id }, select: { id: true } });
        await tx.debitCard.updateMany({ where: { accountId: removed.id }, data: { accountId: survivor.id } });
        const userCards = await tx.userCard.findMany({ where: { accountId: removed.id }, select: { id: true } });
        await tx.userCard.updateMany({ where: { accountId: removed.id }, data: { accountId: survivor.id } });
        const subs = await tx.subscription.findMany({ where: { accountId: removed.id }, select: { id: true } });
        await tx.subscription.updateMany({ where: { accountId: removed.id }, data: { accountId: survivor.id } });

        // plaidAccountId is unique: the new row goes before the survivor takes its id.
        await tx.account.delete({ where: { id: removed.id } });
        const plaidSide = Object.fromEntries(
          Object.keys(PLAID_ACCOUNT_FIELDS).map((k) => [k, gone[k as keyof typeof gone]])
        );
        await tx.account.update({
          where: { id: survivor.id },
          data: { ...plaidSide, ...settings },
        });

        detail.accounts.push({
          survivorId: survivor.id,
          before,
          removed: gone,
          movedTransactionIds: moved.map((m) => m.id),
          debitCardIds: debitCards.map((d) => d.id),
          userCardIds: userCards.map((u) => u.id),
          subscriptionIds: subs.map((s) => s.id),
        });
      }

      // 2. Duplicates: the old row absorbs the new connection's copy.
      for (const { keep, drop, fields } of plan.duplicates) {
        const before = await tx.transaction.findUniqueOrThrow({ where: { id: keep.id } });
        const dropped = await tx.transaction.findUniqueOrThrow({
          where: { id: drop.id },
          include: { splits: true },
        });

        const refunds = await tx.transaction.findMany({ where: { linkedToId: drop.id }, select: { id: true } });
        await tx.transaction.updateMany({
          where: { linkedToId: drop.id, id: { not: keep.id } },
          data: { linkedToId: keep.id },
        });
        const inflows = await tx.transaction.findMany({ where: { fundsCashoutId: drop.id }, select: { id: true } });
        await tx.transaction.updateMany({
          where: { fundsCashoutId: drop.id },
          data: { fundsCashoutId: keep.id },
        });
        if (fields.moveSplits) {
          await tx.transactionSplit.updateMany({
            where: { transactionId: drop.id },
            data: { transactionId: keep.id },
          });
        }

        // externalId is unique: the duplicate goes before the survivor takes its id.
        await tx.transaction.delete({ where: { id: drop.id } });
        const plaidSide = Object.fromEntries(
          Object.keys(PLAID_TX_FIELDS).map((k) => [k, dropped[k as keyof typeof dropped]])
        );
        await tx.transaction.update({
          where: { id: keep.id },
          data: {
            ...plaidSide,
            userCategory: fields.userCategory,
            userCategorySource: fields.userCategorySource,
            linkedToId: fields.linkedToId,
            personalNote: fields.personalNote,
            counterparty: fields.counterparty,
            fundsCashoutId: fields.fundsCashoutId,
            priorItemId: null,
          },
        });

        detail.duplicates.push({
          keptId: keep.id,
          before,
          dropped,
          splitsMoved: fields.moveSplits,
          refundIds: refunds.map((r) => r.id),
          inflowIds: inflows.map((i) => i.id),
        });
      }

      await tx.reconnectMerge.create({
        data: {
          fromItemId: plan.fromItemId,
          intoItemId: plan.intoItemId,
          createdAt: plan.at,
          snapshotFile: plan.snapshotFile,
          accountIds: JSON.stringify(plan.accounts.map((a) => a.survivor.id)),
          duplicates: plan.duplicates.length,
          detail: JSON.stringify(detail),
        },
      });
    }, { maxWait: 10_000, timeout: 120_000 }),
};
