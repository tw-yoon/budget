"use client";

import type { UserCardDTO } from "@/types";
import {
  BONUS_CATEGORIES,
  REWARD_CATEGORY_LABELS,
  effectiveRate,
  formatRate,
} from "@/lib/rewards";
import { ISSUER_LABELS } from "@/lib/categories";
import { CardArt } from "./CardArt";

function shortLabel(c: UserCardDTO) {
  if (c.displayName) return c.displayName;
  return `${ISSUER_LABELS[c.issuer] ?? c.issuer}${c.name ? " " + c.name : ""}`;
}

/** The card's image, named on hover. */
function Face({ card, width }: { card: UserCardDTO; width: number }) {
  return (
    <CardArt
      issuer={card.issuer}
      last4={card.last4}
      name={card.name}
      src={card.artUrl}
      width={width}
      label={shortLabel(card)}
    />
  );
}

export function BestCards({ cards }: { cards: UserCardDTO[] }) {
  const hasRates = cards.some((c) => c.rewardRates.length > 0);
  if (cards.length === 0 || !hasRates) return null;

  const rows = BONUS_CATEGORIES.map((category) => {
    const ranked = cards
      .map((c) => ({ card: c, ...effectiveRate(c.rewardRates, category) }))
      .sort((a, b) => b.multiplier - a.multiplier);
    return { category, ranked };
  });

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Best card by category</h2>
        <span className="text-xs text-black/45 dark:text-white/45">
          ranked by raw rate · points and cashback aren&apos;t directly comparable
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map(({ category, ranked }) => {
          const best = ranked[0];
          const runners = ranked.slice(1, 3);
          return (
            <div
              key={category}
              className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10"
            >
              <div className="text-[11px] uppercase tracking-wide text-black/45 dark:text-white/45">
                {REWARD_CATEGORY_LABELS[category]}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <Face card={best.card} width={64} />
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {formatRate(best.multiplier, best.unit)}
                  {!best.isBonus && (
                    <span className="text-black/40 dark:text-white/40"> base</span>
                  )}
                </span>
              </div>
              {runners.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/45 dark:text-white/45">
                  {runners.map((r) => (
                    <span key={r.card.id} className="flex items-center gap-1.5">
                      <Face card={r.card} width={28} />
                      <span className="font-mono tabular-nums">
                        {formatRate(r.multiplier, r.unit)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
