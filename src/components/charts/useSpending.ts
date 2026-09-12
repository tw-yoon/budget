"use client";

import { useEffect, useState } from "react";
import type { SpendingSeries } from "@/types";

// One shared fetch of the daily-spend series for the cumulative spending graph.
let cache: Promise<SpendingSeries> | null = null;

function load(): Promise<SpendingSeries> {
  if (!cache) {
    cache = fetch("/api/analytics/spending")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
        return res.json() as Promise<SpendingSeries>;
      })
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

export function useSpending() {
  const [data, setData] = useState<SpendingSeries | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      alive = false;
    };
  }, []);

  return { data, error, loading: !data && !error };
}
