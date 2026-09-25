"use client";

import { FlightComparison } from "./FlightComparison";
import { useUserCards } from "./useUserCards";

export function FlightsSection() {
  const { cards, loading, error } = useUserCards();

  if (error)
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
        {error}
      </div>
    );
  if (loading && cards.length === 0)
    return (
      <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
        Loading…
      </div>
    );
  return <FlightComparison cards={cards} />;
}
