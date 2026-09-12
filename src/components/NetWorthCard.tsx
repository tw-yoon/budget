"use client";

import type { AccountsSummary } from "@/types";
import { formatCurrency, formatRelativeTime, isStale } from "@/lib/format";
import { RefreshBalancesButton } from "./RefreshBalancesButton";

export function NetWorthCard({
  summary,
  onRefreshed,
}: {
  summary: AccountsSummary;
  onRefreshed: () => void;
}) {
  const stale = summary.lastRefreshed ? isStale(summary.lastRefreshed) : false;

  return (
    <div className="rounded-xl border border-black/10 p-5 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
            Net worth
          </div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">
            {formatCurrency(summary.netWorth)}
          </div>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-black/60 dark:text-white/60">
              Assets{" "}
              <span className="font-medium text-green-600 dark:text-green-400">
                {formatCurrency(summary.totalAssets)}
              </span>
            </span>
            <span className="text-black/60 dark:text-white/60">
              Liabilities{" "}
              <span className="font-medium text-red-600 dark:text-red-400">
                {formatCurrency(summary.totalLiabilities)}
              </span>
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <RefreshBalancesButton onRefreshed={onRefreshed} />
          {summary.lastRefreshed && (
            <span
              className={`text-xs ${
                stale
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-black/45 dark:text-white/45"
              }`}
            >
              {stale ? "⚠ " : ""}Balances updated {formatRelativeTime(summary.lastRefreshed)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
