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
    income: "text-pos",
    spend: "text-neg",
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="group-panel px-4 py-3"
        >
          <div className="section-caption">
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
