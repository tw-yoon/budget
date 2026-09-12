"use client";

import { useEffect, useState } from "react";
import type { CashflowSeries } from "@/types";

// One shared fetch of the wide cash-flow series, reused by every analytics
// chart that windows over it (the Sankey, the category pie, the trend bars).
let cache: Promise<CashflowSeries> | null = null;

function load(): Promise<CashflowSeries> {
  if (!cache) {
    cache = fetch("/api/analytics/cashflow")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
        return res.json() as Promise<CashflowSeries>;
      })
      .catch((err) => {
        cache = null; // let the next mount retry
        throw err;
      });
  }
  return cache;
}

export function useCashflow() {
  const [data, setData] = useState<CashflowSeries | null>(null);
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
