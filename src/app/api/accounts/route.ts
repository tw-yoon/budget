import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LIABILITY_TYPES, summarizeAccounts } from "@/lib/account-totals";
import { mergeLinks } from "@/lib/reconnect-merge";
import type { AccountDTO } from "@/types";

export async function GET() {
  try {
    const rows = await prisma.account.findMany({
      include: { item: { select: { institution: true, disconnectedAt: true } } },
      orderBy: [{ name: "asc" }],
    });

    const accounts: AccountDTO[] = rows.map((a) => ({
      id: a.id,
      name: a.name,
      officialName: a.officialName,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      currentBalance: a.currentBalance,
      availableBalance: a.availableBalance,
      balanceFetchedAt: a.balanceFetchedAt.toISOString(),
      institution: a.item.institution,
      isLiability: LIABILITY_TYPES.has(a.type),
      nextPaymentDueDate: a.nextPaymentDueDate?.toISOString() ?? null,
      lastStatementBalance: a.lastStatementBalance,
      minimumPaymentAmount: a.minimumPaymentAmount,
      paymentIsOverdue: a.paymentIsOverdue,
      displayName: a.displayName,
      manualDueDay: a.manualDueDay,
      manualCreditLimit: a.manualCreditLimit,
      disconnected: a.item.disconnectedAt != null,
    }));

    // A disconnected bank's accounts stay listed but count toward no total.
    const { groups, summary } = summarizeAccounts(accounts);

    const items = await prisma.plaidItem.findMany({
      include: { _count: { select: { accounts: true } } },
      orderBy: { createdAt: "asc" },
    });
    // Transactions per bank, named in the Delete confirm.
    const txByAccount = await prisma.transaction.groupBy({
      by: ["accountId"],
      _count: { _all: true },
    });
    const itemOfAccount = new Map(rows.map((a) => [a.id, a.itemId]));
    const txByItem = new Map<string, number>();
    for (const g of txByAccount) {
      const itemId = itemOfAccount.get(g.accountId);
      if (itemId) txByItem.set(itemId, (txByItem.get(itemId) ?? 0) + g._count._all);
    }
    // Merge suggestions and history; a bank emptied by a merge is left out.
    const merges = await prisma.reconnectMerge.findMany({
      select: { fromItemId: true, intoItemId: true, createdAt: true },
    });
    const links = mergeLinks(
      items.map((i) => ({
        itemId: i.itemId,
        institution: i.institution,
        accountCount: i._count.accounts,
        disconnectedAt: i.disconnectedAt,
      })),
      merges
    );
    const banks = items
      .filter((i) => !links.get(i.itemId)?.hidden)
      .map((i) => ({
        itemId: i.itemId,
        institution: i.institution,
        accountCount: i._count.accounts,
        transactionCount: txByItem.get(i.itemId) ?? 0,
        disconnectedAt: i.disconnectedAt?.toISOString() ?? null,
        mergeInto: links.get(i.itemId)?.mergeInto ?? [],
        mergedFrom: links.get(i.itemId)?.mergedFrom ?? [],
      }));

    const debitCardRows = await prisma.debitCard.findMany({
      include: { account: { select: { name: true, displayName: true, availableBalance: true, currentBalance: true } } },
      orderBy: { createdAt: "asc" },
    });
    const debitCards = debitCardRows.map((d) => ({
      id: d.id,
      name: d.name,
      last4: d.last4,
      accountId: d.accountId,
      accountName: d.account.displayName ?? d.account.name,
      available: d.account.availableBalance ?? d.account.currentBalance ?? null,
    }));

    return NextResponse.json({ groups, summary, banks, debitCards });
  } catch (err) {
    console.error("[accounts]", err);
    return NextResponse.json(
      { error: "Failed to load accounts" },
      { status: 500 }
    );
  }
}
