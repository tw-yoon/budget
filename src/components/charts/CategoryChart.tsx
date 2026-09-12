"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useCashflow } from "./useCashflow";
import { useMonthWindow } from "./useMonthWindow";
import { WindowNav } from "./WindowNav";
import { formatCurrency } from "@/lib/format";
import { categoryColor } from "@/lib/colors";

interface Slice {
  category: string;
  amount: number;
}

// Collapse the long tail into a single "Other" slice (folding into an existing
// "Other" if the data already has one, e.g. from P2P payments).
function fold(slices: Slice[]): Slice[] {
  const top = slices.slice(0, 8);
  const rest = slices.slice(8);
  if (!rest.length) return top;
  const tail = rest.reduce((s, c) => s + c.amount, 0);
  const existing = top.find((c) => c.category === "Other");
  return existing
    ? top.map((c) => (c.category === "Other" ? { ...c, amount: c.amount + tail } : c))
    : [...top, { category: "Other", amount: tail }];
}

export function CategoryChart() {
  const { data, error, loading } = useCashflow();
  const total = data?.months.length ?? 0;
  const win = useMonthWindow(total, 1); // combines the windowed months into one pie

  const windowMonths = useMemo(
    () => (data ? data.months.slice(win.startIdx, win.view.end) : []),
    [data, win.startIdx, win.view.end]
  );
  const slices = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of windowMonths)
      for (const c of m.spend) map.set(c.category, (map.get(c.category) ?? 0) + c.amount);
    return fold(
      [...map.entries()]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
    );
  }, [windowMonths]);
  const sum = slices.reduce((s, c) => s + c.amount, 0);
  const rangeLabel =
    windowMonths.length === 0
      ? "—"
      : windowMonths.length === 1
        ? windowMonths[0].label
        : `${windowMonths[0].label} – ${windowMonths[windowMonths.length - 1].label}`;

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Spending by category</h3>
          <p className="text-xs text-black/50 dark:text-white/50">
            {rangeLabel}
            {windowMonths.length > 1 ? ` · ${windowMonths.length} months` : ""}
          </p>
        </div>
        <WindowNav onPan={win.pan} onZoom={win.zoom} {...win} />
      </div>

      {loading ? (
        <div className="flex h-52 items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>
      ) : error ? (
        <div className="flex h-52 items-center justify-center text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : slices.length === 0 ? (
        <div className="flex h-52 items-center justify-center text-sm text-black/50 dark:text-white/50">
          No spending in {rangeLabel}.
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
          <div className="relative h-52 w-52 shrink-0">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={slices} dataKey="amount" nameKey="category" innerRadius={62} outerRadius={88} paddingAngle={2} stroke="none">
                  {slices.map((s) => (
                    <Cell key={s.category} fill={categoryColor(s.category)} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v))}
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid rgba(0,0,0,0.1)" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs text-black/50 dark:text-white/50">Total</span>
              <span className="font-semibold tabular-nums">{formatCurrency(sum)}</span>
            </div>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
            {slices.map((s) => (
              <li key={s.category} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: categoryColor(s.category) }} />
                <span className="flex-1 truncate">{s.category}</span>
                <span className="text-black/45 dark:text-white/45">{Math.round((s.amount / (sum || 1)) * 100)}%</span>
                <span className="font-mono tabular-nums">{formatCurrency(s.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
