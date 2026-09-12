/**
 * Re-syncs a card you already own against its entry in the preset catalog.
 *
 * Cards seed their rates and credits from a preset at add time, so a card added
 * before the catalog was corrected keeps the old data forever. This backfills
 * the difference without touching anything you've customized:
 *
 *   - benefits are matched by name (case-insensitive); missing ones are created
 *   - an existing benefit's amount / notes / matchText are updated to the preset
 *   - rate notes are updated for categories the card already has
 *   - nothing is ever deleted, and perk switches / manual logs are left alone
 *
 * Usage:
 *   node scripts/sync-card-preset.mjs <preset-slug> <last4>          # dry run
 *   node scripts/sync-card-preset.mjs <preset-slug> <last4> --apply
 */

import { PrismaClient } from "@prisma/client";
import { CARD_PRESETS } from "../src/data/card-presets.ts";

const [slug, last4, ...flags] = process.argv.slice(2);
const apply = flags.includes("--apply");

if (!slug || !last4) {
  console.error("Usage: node scripts/sync-card-preset.mjs <preset-slug> <last4> [--apply]");
  process.exit(1);
}

const preset = CARD_PRESETS.find((p) => p.slug === slug);
if (!preset) {
  console.error(`Unknown preset "${slug}". Known slugs:`);
  for (const p of CARD_PRESETS) console.error(`  ${p.slug}`);
  process.exit(1);
}

const prisma = new PrismaClient();
const norm = (s) => s.trim().toLowerCase();
const money = (n) => `$${n.toFixed(2)}`;

const card = await prisma.userCard.findFirst({
  where: { last4 },
  include: { benefits: true, rewardRates: true },
});

if (!card) {
  console.error(`No card ending ··${last4}.`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`${apply ? "Syncing" : "Dry run —"} ${card.name ?? card.issuer} ··${card.last4} → ${preset.slug}\n`);

const byName = new Map(card.benefits.map((b) => [norm(b.name), b]));
const changes = [];

for (const p of preset.benefits ?? []) {
  const existing = byName.get(norm(p.name));
  const matchText = p.matchText?.length ? JSON.stringify(p.matchText) : "[]";

  if (!existing) {
    changes.push({
      what: `+ add    ${p.name} — ${money(p.amount)} ${p.period}${p.perk ? " (perk, switched off)" : ""}`,
      run: () =>
        prisma.userBenefit.create({
          data: {
            userCardId: card.id,
            name: p.name,
            amount: p.amount,
            period: p.period,
            notes: p.notes ?? null,
            matchText,
          },
        }),
    });
    continue;
  }

  const diffs = [];
  if (existing.amount !== p.amount) diffs.push(`${money(existing.amount)} → ${money(p.amount)}`);
  if (existing.period !== p.period) diffs.push(`${existing.period} → ${p.period}`);
  if (existing.matchText !== matchText) diffs.push(`match ${existing.matchText} → ${matchText}`);
  if ((existing.notes ?? "") !== (p.notes ?? "")) diffs.push("notes rewritten");
  if (!diffs.length) continue;

  changes.push({
    what: `~ update ${p.name} — ${diffs.join("; ")}`,
    run: () =>
      prisma.userBenefit.update({
        where: { id: existing.id },
        data: { amount: p.amount, period: p.period, notes: p.notes ?? null, matchText },
      }),
  });
}

// Rate notes only — multipliers a user has hand-edited are left as they are.
for (const r of preset.rates) {
  const existing = card.rewardRates.find((x) => x.category === r.category);
  if (!existing) continue;
  if ((existing.notes ?? "") === (r.notes ?? "")) continue;
  changes.push({
    what: `~ note   ${r.category} rate — ${r.notes ?? "(cleared)"}`,
    run: () => prisma.rewardRate.update({ where: { id: existing.id }, data: { notes: r.notes ?? null } }),
  });
}

if (!changes.length) {
  console.log("Benefits and rates already in sync.");
} else {
  for (const c of changes) console.log(c.what);
}

if (apply) {
  for (const c of changes) await c.run();
  const reordered = await restorePresetOrder();
  const parts = [];
  if (changes.length) parts.push(`${changes.length} change${changes.length === 1 ? "" : "s"}`);
  if (reordered) parts.push(`reordered ${reordered} benefit${reordered === 1 ? "" : "s"}`);
  console.log(parts.length ? `\nApplied ${parts.join(", ")}.` : "\nNothing to do.");
} else if (changes.length) {
  console.log(`\n${changes.length} change${changes.length === 1 ? "" : "s"} pending. Re-run with --apply.`);
}

/**
 * The UI lists benefits by createdAt, so a benefit re-added after a delete lands
 * at the bottom instead of its slot. Re-stamp everything the preset knows about
 * onto consecutive timestamps in preset order, anchored to the card's earliest
 * benefit. Benefits you added yourself aren't in the preset, so they keep their
 * own createdAt and still sort after.
 */
async function restorePresetOrder() {
  const rows = await prisma.userBenefit.findMany({ where: { userCardId: card.id } });
  const order = (preset.benefits ?? []).map((b) => norm(b.name));
  if (!order.length) return 0;

  const known = rows.filter((r) => order.includes(norm(r.name)));
  if (known.length < 2) return 0;

  const base = Math.min(...known.map((r) => r.createdAt.getTime()));
  let moved = 0;
  for (const r of known) {
    const want = new Date(base + order.indexOf(norm(r.name)));
    if (r.createdAt.getTime() === want.getTime()) continue;
    await prisma.userBenefit.update({ where: { id: r.id }, data: { createdAt: want } });
    moved++;
  }
  return moved;
}

await prisma.$disconnect();
