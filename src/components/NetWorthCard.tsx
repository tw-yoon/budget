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
    <div className="group-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="section-caption">
            Net worth
          </div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">
            {formatCurrency(summary.netWorth)}
          </div>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-muted2">
              Assets{" "}
              <span className="font-medium text-pos">
                {formatCurrency(summary.totalAssets)}
              </span>
            </span>
            <span className="text-muted2">
              Liabilities{" "}
              <span className="font-medium text-neg">
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
                  ? "text-warn"
                  : "text-dim2"
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
