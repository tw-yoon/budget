"use client";

import { FlightComparison } from "./FlightComparison";
import { useUserCards } from "./useUserCards";

export function FlightsSection() {
  const { cards, loading, error } = useUserCards();

  if (error)
    return (
      <div className="rounded-xl bg-neg/10 px-4 py-3 text-sm text-neg">
        {error}
      </div>
    );
  if (loading && cards.length === 0)
    return (
      <div className="group-panel px-6 py-12 text-center text-sm text-muted2">
        Loading…
      </div>
    );
  return <FlightComparison cards={cards} />;
}
