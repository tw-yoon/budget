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
        <div className="rounded-xl bg-neg/10 px-4 py-3 text-sm text-neg">
          {error}
        </div>
      ) : loading && cards.length === 0 ? (
        <div className="group-panel px-6 py-12 text-center text-sm text-muted2">
          Loading…
        </div>
      ) : (
        <>
          <BestCards cards={cards} />
          {cards.length === 0 && (
            <div className="group-panel px-6 py-12 text-center text-sm text-muted2">
              Add a card under Cards to see which one earns most where.
            </div>
          )}
        </>
      )}
    </div>
  );
}
