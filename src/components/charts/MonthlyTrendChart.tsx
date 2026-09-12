"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useCashflow } from "./useCashflow";
import { useMonthWindow } from "./useMonthWindow";
import { WindowNav } from "./WindowNav";
import { formatCurrency, formatCompactCurrency } from "@/lib/format";
import { INCOME_COLOR, HUB_COLOR } from "@/lib/colors";

// Axis ticks and grid inherit `currentColor`, so the wrapper's text color
// (black/white at low opacity) makes the chart adapt to light/dark mode.
export function MonthlyTrendChart() {
  const { data, error, loading } = useCashflow();
  const total = data?.months.length ?? 0;
  const win = useMonthWindow(total, 6);

  const bars = useMemo(() => {
    if (!data) return [];
    return data.months.slice(win.startIdx, win.view.end).map((m) => ({
      label: m.label.split(" ")[0], // short month for the axis
      full: m.label,
      income: m.income.reduce((s, i) => s + i.amount, 0),
      spent: m.spend.reduce((s, c) => s + c.amount, 0),
    }));
  }, [data, win.startIdx, win.view.end]);

  const rangeLabel =
    bars.length === 0 ? "—" : bars.length === 1 ? bars[0].full : `${bars[0].full} – ${bars[bars.length - 1].full}`;

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-black/10 p-4 text-black/60 dark:border-white/10 dark:text-white/60">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Monthly spending vs income</h3>
          <p className="text-xs text-black/50 dark:text-white/50">{rangeLabel}</p>
        </div>
        <WindowNav onPan={win.pan} onZoom={win.zoom} {...win} />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>
      ) : error ? (
        <div className="flex h-64 items-center justify-center text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="mt-3 h-64 w-full min-w-0">
          <ResponsiveContainer>
            <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "currentColor", fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v) => formatCompactCurrency(v)} tick={{ fill: "currentColor", fontSize: 12 }} tickLine={false} axisLine={false} width={52} />
              <Tooltip
                formatter={(v) => formatCurrency(Number(v))}
                labelFormatter={(_, p) => p?.[0]?.payload?.full ?? ""}
                contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid rgba(0,0,0,0.1)" }}
                cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} />
              <Bar dataKey="spent" name="Spent" fill={HUB_COLOR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
