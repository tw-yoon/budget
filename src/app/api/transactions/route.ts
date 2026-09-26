import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { humanizePfc, humanizePfcDetailed } from "@/lib/format";
import { splitCategory } from "@/lib/categories";
import { getCashoutBreakdowns } from "@/services/venmo.service";
import {
  loadPlaidCategoryMap,
  loadPlaidDetailedNames,
} from "@/services/categories.service";
import { netAmount, resolveLinkedCategory } from "@/lib/links";
import { remainderOf } from "@/lib/splits";
import type { LinkedTargetDTO, RefundDTO } from "@/types";
import type { Prisma } from "@prisma/client";

// GET /api/transactions
//   ?page=1&limit=50
//   &accountId=<id>
//   &search=<text>            matches name OR merchantName
//   &from=<ISO>&to=<ISO>      date range (inclusive of the `to` timestamp)
//   &hideInternal=true        exclude rows flagged isTransfer or isFee
//   &hideLinked=true          exclude rows linked to a purchase (the children
//                             of a connected payment; the purchase itself stays)
//   &sort=date|label          ordering column (default date)
//   &dir=asc|desc             ordering direction (default desc)
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
    const hideLinked = searchParams.get("hideLinked") === "true";
    // Anything unrecognised falls back to the default rather than erroring —
    // these arrive from the querystring and are not worth a 400.
    const sort = searchParams.get("sort") === "label" ? "label" : "date";
    const dir: Prisma.SortOrder =
      searchParams.get("dir") === "asc" ? "asc" : "desc";

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

    // Hide the child side of a connection: a row whose linkedToId is set is a
    // payback or contribution belonging to some other purchase, and the
    // purchase already shows it in its own refund panel and nets it out of its
    // amount. The purchase itself is never hidden — only rows that point at
    // one. Deliberately placed after the hideInternal block, so when both are
    // on this AND clause overrides hideInternal's "keep anything linked"
    // exception: asking for linked rows to go means they go.
    if (hideLinked) and.push({ linkedToId: null });

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

    // Sorting by label is sorting by insertion order, which is NOT the same as
    // by date: a Venmo import backfills old transactions with fresh, high
    // numbers. That divergence is the reason both orderings are offered.
    // createdAt follows the same direction as date so the tiebreaker inside a
    // single day reads the same way round as the column being sorted.
    const orderBy: Prisma.TransactionOrderByWithRelationInput[] =
      sort === "label" ? [{ label: dir }] : [{ date: dir }, { createdAt: dir }];

    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          account: { select: { name: true, displayName: true, mask: true } },
          splits: {
            select: { id: true, amount: true, userCategory: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: orderBy,
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

    const [plaidMap, detailedNames] = await Promise.all([
      loadPlaidCategoryMap(),
      loadPlaidDetailedNames(),
    ]);
    const plaidName = (primary: string) => plaidMap.get(primary) ?? humanizePfc(primary);
    // Plaid's detailed label, under the name given it in Settings if any.
    const plaidSub = (detailed: string | null, primary: string) =>
      detailed
        ? detailedNames.get(detailed) ?? humanizePfcDetailed(detailed, primary)
        : null;

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
          // Deliberately the RAW userCategory, not split into parent/sub. This
          // value is fed back through resolveLinkedCategory below, where
          // splitCategory derives both the parent category and the subcategory
          // for a linked row. Splitting it here would strip the subcategory a
          // linked refund inherits.
          category: t.userCategory ?? plaidName(t.pfcPrimary),
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
      // Derived, never stored: the leftover follows the row's amount and its
      // category without anything having to write it down. Below a cent it is
      // float noise from summing the parts, not a leftover.
      const left = remainderOf(t.amount, t.splits);
      const splitRemainder =
        t.splits.length > 0 && Math.abs(left) >= 0.005 ? left : null;
      return {
        id: t.id,
        externalId: t.externalId,
        accountId: t.accountId,
        accountName:
          t.source === "VENMO" ? "Venmo" : t.account.displayName ?? t.account.name,
        accountMask: t.source === "VENMO" ? null : t.account.mask,
        amount: t.amount,
        date: t.date.toISOString(),
        name: t.name,
        merchantName: t.merchantName,
        category: uc ? uc.parent : plaidName(t.pfcPrimary),
        categoryDetailed: uc ? uc.sub : plaidSub(t.pfcDetailed, t.pfcPrimary),
        userCategory: t.userCategory,
        // Plaid's own categorization, kept alongside the effective one so the
        // client can preview/revert overrides without refetching.
        plaidCategory: plaidName(t.pfcPrimary),
        plaidCategoryDetailed: plaidSub(t.pfcDetailed, t.pfcPrimary),
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
        splits: t.splits.map((s) => {
          const sc = splitCategory(s.userCategory);
          return {
            id: s.id,
            amount: s.amount,
            category: sc.parent,
            subcategory: sc.sub,
            userCategory: s.userCategory,
          };
        }),
        splitRemainder,
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
