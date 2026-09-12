"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnalyticsResult } from "@/types";
import { SummaryCards } from "./SummaryCards";
import { CategoryChart } from "./charts/CategoryChart";
import { MonthlyTrendChart } from "./charts/MonthlyTrendChart";
import { CashFlowSankey } from "./charts/CashFlowSankey";
import { SpendingGraph } from "./charts/SpendingGraph";

const RANGES = [3, 6, 12] as const;

export function AnalyticsDashboard() {
  // The top range drives the summary cards only; each chart below navigates
  // months on its own.
  const [months, setMonths] = useState<number>(6);
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics?months=${months}`);
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      setData((await res.json()) as AnalyticsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    // Intentional data-fetch effect: refetch when the range changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-black/55 dark:text-white/55">
            Summary over the last {months} months
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-black/15 p-0.5 dark:border-white/15">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setMonths(r)}
              className={`rounded px-3 py-1 text-sm transition-colors ${
                months === r
                  ? "bg-foreground text-background"
                  : "text-black/60 hover:text-foreground dark:text-white/60"
              }`}
            >
              {r}m
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="rounded-lg border border-black/10 px-4 py-6 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : ""}>
          <SummaryCards summary={data.summary} />
        </div>
      ) : null}

      <CashFlowSankey />
      <SpendingGraph />
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryChart />
        <MonthlyTrendChart />
      </div>
    </div>
  );
}
