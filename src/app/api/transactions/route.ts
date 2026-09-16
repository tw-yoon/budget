import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { humanizePfc } from "@/lib/format";
import { splitCategory } from "@/lib/categories";
import { getCashoutBreakdowns } from "@/services/venmo.service";
import { netAmount, resolveLinkedCategory } from "@/lib/links";
import type { LinkedTargetDTO, RefundDTO } from "@/types";
import type { Prisma } from "@prisma/client";

// GET /api/transactions
//   ?page=1&limit=50
//   &accountId=<id>
//   &search=<text>            matches name OR merchantName
//   &from=<ISO>&to=<ISO>      date range (inclusive of the `to` timestamp)
//   &hideInternal=true        exclude rows flagged isTransfer or isFee
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10))
    );
    const accountId = searchParams.get("accountId") ?? undefined;
    const search = searchParams.get("search")?.trim();
    const hideInternal = searchParams.get("hideInternal") === "true";

    const and: Prisma.TransactionWhereInput[] = [];
    if (accountId) and.push({ accountId });
    if (hideInternal) {
      and.push({ isFee: false });
      // Don't show anything explicitly tagged "Transfer" (null-safe: keep
      // nulls), including subcategorized "Transfer > ..." overrides.
      and.push({
        OR: [
          { userCategory: null },
          {
            AND: [
              { userCategory: { not: "Transfer" } },
              { NOT: { userCategory: { startsWith: "Transfer > " } } },
            ],
          },
        ],
      });
      and.push({
        OR: [
          { isTransfer: false },
          // Keep classified P2P transfers (Venmo/Zelle) — they're real spend now.
          { userCategory: { not: null } },
          // Keep anything linked to a purchase — a Zelle payback holds no
          // category of its own but is real, netted spend.
          { linkedToId: { not: null } },
          // Keep Venmo cash-out deposits — they expand into a categorized breakdown.
          {
            isTransfer: true,
            source: "PLAID",
            amount: { lt: 0 },
            OR: [
              { name: { contains: "Venmo" } },
              { merchantName: { contains: "Venmo" } },
            ],
          },
        ],
      });
    }

    const dateFilter: Prisma.DateTimeFilter = {};
    const from = parseDate(searchParams.get("from"));
    const to = parseDate(searchParams.get("to"));
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;
    if (from || to) and.push({ date: dateFilter });

    if (search) {
      and.push({
        OR: [
          { name: { contains: search } },
          { merchantName: { contains: search } },
        ],
      });
    }

    const where: Prisma.TransactionWhereInput = and.length ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { account: { select: { name: true, mask: true } } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    // Bank-side Venmo cash-out deposits on this page get an expandable
    // breakdown of the categorized payments that were pooled into them.
    const cashoutCandidates = rows
      .filter(
        (t) =>
          t.source === "PLAID" &&
          t.amount < 0 &&
          /venmo/i.test(`${t.name} ${t.merchantName ?? ""}`)
      )
      .map((t) => ({ id: t.id, amount: t.amount }));
    const breakdowns = await getCashoutBreakdowns(cashoutCandidates);

    // Two extra queries per page: the refunds hanging off the purchases shown
    // here, and the purchases that the refunds shown here point at.
    const pageIds = rows.map((r) => r.id);
    const targetIds = [
      ...new Set(rows.map((r) => r.linkedToId).filter((v): v is string => v !== null)),
    ];
    const [refundRows, targetRows] = await Promise.all([
      prisma.transaction.findMany({
        where: { linkedToId: { in: pageIds } },
        select: {
          id: true, label: true, date: true, amount: true,
          name: true, merchantName: true, linkedToId: true,
        },
        orderBy: { date: "asc" },
      }),
      targetIds.length
        ? prisma.transaction.findMany({
            where: { id: { in: targetIds } },
            select: {
              id: true, label: true, name: true, merchantName: true,
              userCategory: true, pfcPrimary: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const refundsByPurchase = new Map<string, RefundDTO[]>();
    for (const r of refundRows) {
      const list = refundsByPurchase.get(r.linkedToId!) ?? [];
      list.push({
        id: r.id,
        label: r.label,
        date: r.date.toISOString(),
        amount: r.amount,
        name: r.merchantName ?? r.name,
      });
      refundsByPurchase.set(r.linkedToId!, list);
    }

    const targetsById = new Map<string, LinkedTargetDTO>(
      targetRows.map((t) => [
        t.id,
        {
          id: t.id,
          label: t.label,
          name: t.merchantName ?? t.name,
          category: t.userCategory ?? humanizePfc(t.pfcPrimary),
        },
      ])
    );

    const transactions = rows.map((t) => {
      const bd = breakdowns.get(t.id);
      const linkedTo = t.linkedToId ? targetsById.get(t.linkedToId) ?? null : null;
      const refunds = refundsByPurchase.get(t.id) ?? [];
      // A linked row shows its purchase's category; otherwise its own override.
      const { raw } = resolveLinkedCategory({
        amount: t.amount,
        userCategory: t.userCategory,
        linkedToCategory: linkedTo?.category ?? null,
      });
      // A userCategory override may carry a "Parent > Sub" subcategory; the
      // parent is the category, the sub replaces Plaid's detailed label.
      const uc = raw ? splitCategory(raw) : null;
      return {
        id: t.id,
        plaidTxId: t.plaidTxId,
        accountId: t.accountId,
        accountName: t.source === "VENMO" ? "Venmo" : t.account.name,
        accountMask: t.source === "VENMO" ? null : t.account.mask,
        amount: t.amount,
        date: t.date.toISOString(),
        name: t.name,
        merchantName: t.merchantName,
        category: uc ? uc.parent : humanizePfc(t.pfcPrimary),
        categoryDetailed: uc
          ? uc.sub
          : t.pfcDetailed
            ? humanizePfc(t.pfcDetailed)
            : null,
        userCategory: t.userCategory,
        // Plaid's own categorization, kept alongside the effective one so the
        // client can preview/revert overrides without refetching.
        plaidCategory: humanizePfc(t.pfcPrimary),
        plaidCategoryDetailed: t.pfcDetailed ? humanizePfc(t.pfcDetailed) : null,
        logoUrl: t.logoUrl,
        pending: t.pending,
        isTransfer: t.isTransfer,
        isFee: t.isFee,
        personalNote: t.personalNote,
        source: t.source,
        label: t.label,
        linkedTo,
        refunds,
        netAmount: netAmount(t.amount, refunds),
        breakdown: bd && (bd.slices.length > 0 || bd.priorBalance > 0)
          ? { slices: bd.slices, priorBalance: bd.priorBalance }
          : null,
      };
    });

    return NextResponse.json({
      transactions,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("[transactions]", err);
    return NextResponse.json(
      { error: "Failed to load transactions" },
      { status: 500 }
    );
  }
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}
