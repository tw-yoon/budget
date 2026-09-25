"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserCardDTO, UserCardsResponse } from "@/types";

/**
 * The card list, loaded per page.
 *
 * Every Benefits page needs the same cards, and each fetches its own copy: the
 * pages are separate routes now, so there is no common mount to hang a shared
 * one off, and a single request to a local server is not worth a provider for.
 */
export function useUserCards() {
  const [cards, setCards] = useState<UserCardDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/user-cards");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      const data = (await res.json()) as UserCardsResponse;
      setCards(data.cards);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional data-fetch effect on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const move = useCallback(async (id: string, dir: "up" | "down") => {
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      const swap = dir === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      // Persist the new order (fire-and-forget; optimistic update above).
      fetch("/api/user-cards/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map((c) => c.id) }),
      }).catch(() => {});
      return next;
    });
  }, []);

  return { cards, loading, error, load, move };
}
