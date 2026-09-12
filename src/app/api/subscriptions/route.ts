import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CADENCES, CADENCE_LABELS, monthlyCost } from "@/lib/subscriptions";

const round = (n: number) => Math.round(n * 100) / 100;
const VALID_CADENCE = new Set<string>(CADENCES);

// GET /api/subscriptions — list + total monthly cost (active subs only).
export async function GET() {
  try {
    const subs = await prisma.subscription.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    const accountIds = [
      ...new Set(subs.map((s) => s.accountId).filter((x): x is string => !!x)),
    ];
    const accounts = accountIds.length
      ? await prisma.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, name: true, displayName: true },
        })
      : [];
    const nameMap = new Map(
      accounts.map((a) => [a.id, a.displayName ?? a.name])
    );

    const subscriptions = subs.map((s) => ({
      id: s.id,
      name: s.name,
      amount: s.amount,
      cadence: s.cadence,
      cadenceLabel: CADENCE_LABELS[s.cadence] ?? s.cadence,
      monthlyCost: round(monthlyCost(s.amount, s.cadence)),
      nextDate: s.nextDate?.toISOString() ?? null,
      merchantName: s.merchantName,
      accountName: s.accountId ? nameMap.get(s.accountId) ?? null : null,
      source: s.source,
      isActive: s.isActive,
    }));

    const monthlyTotal = round(
      subscriptions
        .filter((s) => s.isActive)
        .reduce((sum, s) => sum + s.monthlyCost, 0)
    );

    return NextResponse.json({ subscriptions, monthlyTotal });
  } catch (err) {
    console.error("[subscriptions GET]", err);
    return NextResponse.json({ error: "Failed to load subscriptions" }, { status: 500 });
  }
}

// POST /api/subscriptions — add one manually.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const amount = Number(body.amount);
    const cadence = String(body.cadence ?? "MONTHLY").toUpperCase();
    const nextDate = body.nextDate ? new Date(body.nextDate) : null;

    if (!name) return bad("Name is required");
    if (!Number.isFinite(amount) || amount <= 0) return bad("Amount must be a positive number");
    if (!VALID_CADENCE.has(cadence)) return bad("Invalid cadence");
    if (nextDate && isNaN(nextDate.getTime())) return bad("Invalid next date");

    const sub = await prisma.subscription.create({
      data: { name, amount, cadence, nextDate, source: "MANUAL", isActive: true },
    });
    return NextResponse.json({ id: sub.id });
  } catch (err) {
    console.error("[subscriptions POST]", err);
    return NextResponse.json({ error: "Failed to add subscription" }, { status: 500 });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
