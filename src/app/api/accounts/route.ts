import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { AccountDTO, AccountGroup } from "@/types";

const LIABILITY_TYPES = new Set(["CREDIT", "LOAN"]);

// Render order + friendly labels. Assets first, then liabilities.
const TYPE_META: { type: string; label: string }[] = [
  { type: "DEPOSITORY", label: "Cash" },
  { type: "INVESTMENT", label: "Investments" },
  { type: "CREDIT", label: "Credit Cards" },
  { type: "LOAN", label: "Loans" },
  { type: "OTHER", label: "Other" },
];

export async function GET() {
  try {
    const rows = await prisma.account.findMany({
      include: { item: { select: { institution: true } } },
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
    }));

    // Group by type in the defined order; drop empty groups.
    const groups: AccountGroup[] = TYPE_META.map(({ type, label }) => {
      const inType = accounts.filter((a) => a.type === type);
      return {
        type,
        label,
        isLiability: LIABILITY_TYPES.has(type),
        subtotal: inType.reduce((s, a) => s + a.currentBalance, 0),
        accounts: inType,
      };
    }).filter((g) => g.accounts.length > 0);

    const totalAssets = accounts
      .filter((a) => !a.isLiability)
      .reduce((s, a) => s + a.currentBalance, 0);
    const totalLiabilities = accounts
      .filter((a) => a.isLiability)
      .reduce((s, a) => s + a.currentBalance, 0);

    const lastRefreshed =
      accounts.length > 0
        ? accounts
            .map((a) => a.balanceFetchedAt)
            .sort()
            .at(-1) ?? null
        : null;

    const items = await prisma.plaidItem.findMany({
      include: { _count: { select: { accounts: true } } },
      orderBy: { createdAt: "asc" },
    });
    const banks = items.map((i) => ({
      itemId: i.itemId,
      institution: i.institution,
      accountCount: i._count.accounts,
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

    const round = (n: number) => Math.round(n * 100) / 100;

    return NextResponse.json({
      groups,
      summary: {
        totalAssets: round(totalAssets),
        totalLiabilities: round(totalLiabilities),
        netWorth: round(totalAssets - totalLiabilities),
        accountCount: accounts.length,
        lastRefreshed,
      },
      banks,
      debitCards,
    });
  } catch (err) {
    console.error("[accounts]", err);
    return NextResponse.json(
      { error: "Failed to load accounts" },
      { status: 500 }
    );
  }
}
