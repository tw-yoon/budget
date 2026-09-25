"use client";

import { BestCards } from "./BestCards";
import { RatesNote } from "./RatesNote";
import { useUserCards } from "./useUserCards";

export function BestCardsSection() {
  const { cards, loading, error } = useUserCards();

  return (
    <div className="flex flex-col gap-5">
      <RatesNote />
      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      ) : loading && cards.length === 0 ? (
        <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : (
        <>
          <BestCards cards={cards} />
          {cards.length === 0 && (
            <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
              Add a card under Cards to see which one earns most where.
            </div>
          )}
        </>
      )}
    </div>
  );
}
