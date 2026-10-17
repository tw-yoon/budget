import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendUnique, isCreditCandidate, learnKeyword, matchesKeyword, parsePerkAnswer } from "@/lib/perk-credits";
import { parseCategories } from "@/services/benefits.service";
import { pairPerkCredits } from "@/services/perk-credits.service";

// PUT /api/perk-credits/:id — the owner's answer about a statement credit.
//   { decision: "yes", benefitId }   it fills this perk (learns a non-generic keyword, then pairs)
//   { decision: "no",  benefitId }   not this perk (detach; sticky)
//   { decision: "no",  benefitId: null } not a perk at all
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const answer = parsePerkAnswer(await req.json().catch(() => null));
    if (!answer) return bad("Expected { decision: \"yes\" | \"no\", benefitId }");

    const row = await prisma.transaction.findUnique({
      where: { id },
      select: {
        amount: true, accountId: true, name: true, merchantName: true, perkPaired: true,
        pending: true, isFee: true, pfcDetailed: true,
      },
    });
    if (!row) return bad("Not found", 404);
    // Money out, pending rows, fees and card payments never fill a perk.
    if (!isCreditCandidate(row)) return bad("That transaction cannot fill a perk");

    const benefit = answer.benefitId
      ? await prisma.userBenefit.findUnique({
          where: { id: answer.benefitId },
          select: { matchText: true, perkActiveFrom: true, card: { select: { accountId: true } } },
        })
      : null;
    if (answer.benefitId && !benefit) return bad("Perk not found", 404);
    if (benefit && benefit.card.accountId !== row.accountId) return bad("That perk is on another card");

    if (answer.decision === "YES") {
      // Flat-value perks count by switch, not by transactions.
      if (benefit!.perkActiveFrom) return bad("That perk is not filled by credits");
      const keywords = parseCategories(benefit!.matchText);
      const next = matchesKeyword(keywords, row) ? keywords : appendUnique(keywords, learnKeyword(row));
      await prisma.$transaction([
        prisma.transaction.update({
          where: { id },
          data: { benefitDecision: "YES", benefitId: answer.benefitId },
        }),
        ...(next !== keywords
          ? [prisma.userBenefit.update({ where: { id: answer.benefitId }, data: { matchText: JSON.stringify(next) } })]
          : []),
      ]);
      await pairPerkCredits({ only: id });
    } else {
      await prisma.transaction.update({
        where: { id },
        data: {
          benefitDecision: "NO",
          benefitId: answer.benefitId,
          // Undo a pairing this feature made; links the owner made stay.
          ...(row.perkPaired && { linkedToId: null, perkPaired: false, userCategorySource: null }),
        },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[perk-credits PUT]", err);
    return NextResponse.json({ error: "Failed to save the answer" }, { status: 500 });
  }
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
