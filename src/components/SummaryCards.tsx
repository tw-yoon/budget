"use client";

import type { AnalyticsSummary } from "@/types";
import { formatCurrency } from "@/lib/format";

export function SummaryCards({ summary }: { summary: AnalyticsSummary }) {
  const cards = [
    { label: "Spent", value: formatCurrency(summary.totalSpent), tone: "neutral" },
    { label: "Income", value: formatCurrency(summary.totalIncome), tone: "income" },
    {
      label: "Net",
      value:
        summary.net >= 0
          ? `+${formatCurrency(summary.net)}`
          : formatCurrency(summary.net),
      tone: summary.net >= 0 ? "income" : "spend",
    },
    { label: "Transactions", value: String(summary.txCount), tone: "neutral" },
  ] as const;

  const toneClass: Record<string, string> = {
    neutral: "text-foreground",
    income: "text-green-600 dark:text-green-400",
    spend: "text-red-600 dark:text-red-400",
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/10"
        >
          <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
            {c.label}
          </div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass[c.tone]}`}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
