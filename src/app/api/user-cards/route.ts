import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserCardsWithProgress } from "@/services/benefits.service";
import { CARD_PRESETS } from "@/data/card-presets";

const ISSUERS = new Set(["AMEX", "CHASE", "DISCOVER"]);

export async function GET() {
  try {
    const cards = await getUserCardsWithProgress();
    return NextResponse.json({ cards });
  } catch (err) {
    console.error("[user-cards GET]", err);
    return NextResponse.json({ error: "Failed to load cards" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const last4 = String(body.last4 ?? "").trim();
    const year = parseInt(String(body.membershipStartYear), 10);
    const monthRaw = parseInt(String(body.membershipStartMonth), 10);
    const month = Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null;

    // A preset fixes the issuer + name and seeds earning rates and credits.
    const preset = body.presetSlug
      ? CARD_PRESETS.find((p) => p.slug === body.presetSlug)
      : null;
    if (body.presetSlug && !preset) return bad("Unknown card preset");

    const issuer = preset ? preset.issuer : String(body.issuer ?? "").toUpperCase();
    const name = preset
      ? preset.name
      : body.name
        ? String(body.name).trim()
        : null;

    if (!ISSUERS.has(issuer)) return bad("Issuer must be AMEX, CHASE, or DISCOVER");
    if (!/^\d{4}$/.test(last4)) return bad("Last 4 must be exactly 4 digits");
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 1980 || year > currentYear)
      return bad("Enter a valid membership start year");

    // Annual fee: explicit override wins, else the preset's published fee.
    const feeRaw = Number(body.annualFee);
    const annualFee = Number.isFinite(feeRaw) && feeRaw >= 0 ? feeRaw : preset?.annualFee ?? 0;

    // Auto-link to a synced account whose mask matches the entered last 4.
    const account = await prisma.account.findFirst({ where: { mask: last4 } });

    const card = await prisma.userCard.create({
      data: {
        issuer,
        name,
        last4,
        membershipStartYear: year,
        membershipStartMonth: month,
        annualFee,
        accountId: account?.id ?? null,
        ...(preset && {
          rewardRates: {
            create: preset.rates.map((r) => ({
              category: r.category,
              multiplier: r.multiplier,
              unit: r.unit,
              notes: r.notes ?? null,
            })),
          },
          ...(preset.benefits?.length && {
            benefits: {
              // Perks seed switched off (perkActiveFrom stays null) — they're
              // worth nothing until actually activated with the issuer.
              create: preset.benefits.map((b) => ({
                name: b.name,
                amount: b.amount,
                period: b.period,
                notes: b.notes ?? null,
                matchText: b.matchText?.length ? JSON.stringify(b.matchText) : "[]",
              })),
            },
          }),
        }),
      },
    });

    return NextResponse.json({
      id: card.id,
      linked: !!account,
      ratesAdded: preset?.rates.length ?? 0,
      benefitsAdded: preset?.benefits?.length ?? 0,
    });
  } catch (err) {
    console.error("[user-cards POST]", err);
    return NextResponse.json({ error: "Failed to add card" }, { status: 500 });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
