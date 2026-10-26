"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useCashflow } from "./useSeries";
import { useMonthWindow } from "./useMonthWindow";
import { WindowNav } from "./WindowNav";
import { formatCurrency, formatCompactCurrency } from "@/lib/format";
import { INCOME_COLOR, HUB_COLOR } from "@/lib/colors";

// Grid and ticks use the theme CSS vars so the chart follows light/dark.
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
    <div className="min-w-0 group-panel p-4 text-muted2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3>Monthly spending vs income</h3>
          <p className="text-xs text-muted2">{rangeLabel}</p>
        </div>
        <WindowNav onPan={win.pan} onZoom={win.zoom} {...win} />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted2">Loading…</div>
      ) : error ? (
        <div className="flex h-64 items-center justify-center text-sm text-neg">{error}</div>
      ) : (
        <div className="mt-3 h-64 w-full min-w-0">
          <ResponsiveContainer>
            <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v) => formatCompactCurrency(v)} tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} width={52} />
              <Tooltip
                formatter={(v) => formatCurrency(Number(v))}
                labelFormatter={(_, p) => p?.[0]?.payload?.full ?? ""}
                contentStyle={{ borderRadius: 10, fontSize: 12, border: "none", background: "var(--panel)", color: "var(--text)", fontFamily: "inherit", boxShadow: "0 2px 10px rgba(0,0,0,0.15)" }}
                cursor={{ fill: "var(--grid)", fillOpacity: 0.5 }}
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
