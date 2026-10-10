"use client";

import { useEffect, useState } from "react";
import type { CashflowSeries, SpendingSeries } from "@/types";

// One shared fetch per series, reused by every chart that windows over it.
function sharedSeries<T>(url: string) {
  let cache: Promise<T> | null = null;

  function load(): Promise<T> {
    cache ??= fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
        return res.json() as Promise<T>;
      })
      .catch((err) => {
        cache = null; // let the next mount retry
        throw err;
      });
    return cache;
  }

  return function useSeries() {
    const [data, setData] = useState<T | null>(null);
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
  };
}

/** The wide cash-flow series: the Sankey, the category pie, the trend bars. */
export const useCashflow = sharedSeries<CashflowSeries>("/api/analytics/cashflow");

/** The daily-spend series for the cumulative spending graph. */
export const useSpending = sharedSeries<SpendingSeries>("/api/analytics/spending");
