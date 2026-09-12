"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { useSpending } from "./useSpending";
import { WindowNav } from "./WindowNav";
import { formatCurrency, formatCompactCurrency } from "@/lib/format";
import { INCOME_COLOR, DRAW_COLOR } from "@/lib/colors";
import { loadSynced, pushSynced } from "@/lib/ui-state";

const UNDER = INCOME_COLOR; // green — under the limit
const OVER = DRAW_COLOR; // red — over the limit
const AVG_COLOR = "#94a3b8"; // grey — long-run average
const CMP_COLOR = "#64748b"; // darker grey — comparison overlay
const LIMIT_KEY = "spendingMonthlyLimit";

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate(); // m is 1-based
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const niceCeil = (n: number) => {
  if (n <= 0) return 500;
  const step = n > 4000 ? 1000 : n > 1000 ? 500 : n > 200 ? 100 : 50;
  return Math.ceil(n / step) * step;
};

interface MonthRef {
  y: number;
  m: number;
  key: string;
  label: string;
}

export function SpendingGraph() {
  const { data, error, loading } = useSpending();
  const days = useMemo(() => data?.days ?? [], [data]);

  // Calendar months + per-day spend lookup + a sensible default limit.
  const { months, byMonth, defaultLimit, currentKey } = useMemo(() => {
    const byMonth = new Map<string, Map<number, number>>();
    for (const d of days) {
      const mk = d.date.slice(0, 7);
      const day = Number(d.date.slice(8, 10));
      if (!byMonth.has(mk)) byMonth.set(mk, new Map());
      const dm = byMonth.get(mk)!;
      dm.set(day, (dm.get(day) ?? 0) + d.amount);
    }
    const keys = [...byMonth.keys()].sort();
    const months: MonthRef[] = [];
    if (keys.length) {
      const [minY, minM] = keys[0].split("-").map(Number);
      const [maxY, maxM] = keys[keys.length - 1].split("-").map(Number);
      let y = minY;
      let m = minM;
      while (y < maxY || (y === maxY && m <= maxM)) {
        months.push({
          y, m, key: `${y}-${pad(m)}`,
          label: new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }),
        });
        m += 1;
        if (m > 12) { m = 1; y += 1; }
      }
    }
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const totals = months
      .filter((mo) => mo.key < currentKey)
      .map((mo) => [...(byMonth.get(mo.key)?.values() ?? [])].reduce((a, b) => a + b, 0))
      .filter((t) => t > 0);
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 3000;
    return { months, byMonth, defaultLimit: Math.max(500, Math.round(avg / 250) * 250), currentKey };
  }, [days]);

  const [selRaw, setSelRaw] = useState<number | null>(null); // null = latest
  const sel = selRaw === null ? months.length - 1 : Math.min(Math.max(0, selRaw), months.length - 1);
  const selMonth = months[sel] ?? null;
  const [compareMode, setCompareMode] = useState<"lastMonth" | "lastYear">("lastMonth");

  const [limitOverride, setLimitOverride] = useState<number | null>(null);
  useEffect(() => {
    // Read the saved limit once on mount (client-only, so it can't be the
    // initial state without a hydration mismatch). Server copy wins; this
    // browser's localStorage is the fallback and seeds the server once.
    let cancelled = false;
    (async () => {
      const v = await loadSynced(LIMIT_KEY);
      if (!cancelled && v != null && v !== "" && !Number.isNaN(Number(v))) {
        setLimitOverride(Number(v));
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const limit = limitOverride ?? defaultLimit;
  const setLimit = (v: number) => {
    setLimitOverride(v);
    pushSynced(LIMIT_KEY, v);
  };

  const compareLabel = compareMode === "lastMonth" ? "Last month" : "Last year";

  const chart = useMemo(() => {
    if (!selMonth) return null;
    const cumOf = (y: number, m: number): number[] => {
      const dm = byMonth.get(`${y}-${pad(m)}`);
      const D = daysInMonth(y, m);
      const arr: number[] = [];
      let c = 0;
      for (let d = 1; d <= D; d++) {
        c += dm?.get(d) ?? 0;
        arr.push(Math.round(c * 100) / 100);
      }
      return arr;
    };

    const { y, m, key } = selMonth;
    const D = daysInMonth(y, m);
    const now = new Date();
    const elapsed = key === currentKey ? now.getDate() : D;
    const cur = cumOf(y, m);

    // long-run average over complete (past) months
    const complete = months.filter((mo) => mo.key < currentKey);
    const avg: number[] = [];
    for (let i = 0; i < 31; i++) {
      let s = 0;
      let c = 0;
      for (const mo of complete) {
        const a = cumOf(mo.y, mo.m);
        if (i < a.length) { s += a[i]; c += 1; }
      }
      avg.push(c ? Math.round((s / c) * 100) / 100 : NaN);
    }

    // comparison month
    let cy = y;
    let cm = m;
    if (compareMode === "lastMonth") { cm = m - 1; if (cm < 1) { cm = 12; cy = y - 1; } }
    else { cy = y - 1; }
    const cmp = cumOf(cy, cm);

    const rows = [];
    for (let d = 1; d <= D; d++) {
      rows.push({
        day: d,
        current: d <= elapsed ? cur[d - 1] : null,
        avg: Number.isNaN(avg[d - 1]) ? null : avg[d - 1],
        compare: d - 1 < cmp.length ? cmp[d - 1] : null,
      });
    }

    const peak = cur[elapsed - 1] ?? 0;
    const cumFirst = cur[0] ?? 0;
    const maxV = Math.max(limit, peak, ...avg.filter((v) => !Number.isNaN(v)), ...cmp, 0);
    const top = niceCeil(maxV * 1.06);
    return {
      rows, top, peak, spent: peak, D,
      splitFill: peak > 0 ? clamp01(1 - limit / peak) : 0,
      splitLine: peak > cumFirst ? clamp01((peak - limit) / (peak - cumFirst)) : peak > limit ? 1 : 0,
      ticks: [1, 5, 10, 15, 20, 25, D].filter((t, i, a) => t <= D && a.indexOf(t) === i),
    };
  }, [selMonth, months, byMonth, compareMode, limit, currentKey]);

  const over = chart ? chart.spent > limit : false;

  // Use the split gradient only when the line actually crosses the limit;
  // otherwise a solid color, so a zero-width red stop can't leak a hairline of
  // red at the top of an all-green (under-limit) month.
  const lineCrosses = !!chart && chart.splitLine > 0 && chart.splitLine < 1;
  const fillCrosses = !!chart && chart.splitFill > 0 && chart.splitFill < 1;
  const lineStroke = lineCrosses ? "url(#spendLine)" : !chart || chart.splitLine <= 0 ? UNDER : OVER;
  const areaFill = fillCrosses ? "url(#spendFill)" : !chart || chart.splitFill <= 0 ? UNDER : OVER;

  return (
    <div className="rounded-lg border border-black/10 p-4 text-black/60 dark:border-white/10 dark:text-white/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Spending</h3>
          <p className="text-xs text-black/50 dark:text-white/50">{selMonth?.label ?? "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-black/55 dark:text-white/55">
            Limit
            <span className="inline-flex items-center rounded-md border border-black/15 px-2 py-1 text-foreground dark:border-white/15">
              $
              <input
                type="number"
                min={0}
                step={50}
                value={limit}
                onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 bg-transparent text-right tabular-nums outline-none"
              />
            </span>
          </label>
          <div className="flex gap-1 rounded-md border border-black/15 p-0.5 dark:border-white/15">
            {(["lastMonth", "lastYear"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setCompareMode(mode)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  compareMode === mode
                    ? "bg-foreground text-background"
                    : "text-black/60 hover:text-foreground dark:text-white/60"
                }`}
              >
                {mode === "lastMonth" ? "Last month" : "Last year"}
              </button>
            ))}
          </div>
          <WindowNav
            onPan={(dir) => setSelRaw(sel + dir)}
            canEarlier={sel > 0}
            canLater={sel < months.length - 1}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>
      ) : error ? (
        <div className="flex h-64 items-center justify-center text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : !chart || chart.peak === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-black/50 dark:text-white/50">
          No spending in {selMonth?.label ?? "this month"}.
        </div>
      ) : (
        <>
          <div className="mt-3 h-64 w-full min-w-0">
            <ResponsiveContainer>
              <ComposedChart data={chart.rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={OVER} stopOpacity={0.22} />
                    <stop offset={chart.splitFill} stopColor={OVER} stopOpacity={0.22} />
                    <stop offset={chart.splitFill} stopColor={UNDER} stopOpacity={0.2} />
                    <stop offset="1" stopColor={UNDER} stopOpacity={0.2} />
                  </linearGradient>
                  <linearGradient id="spendLine" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={OVER} />
                    <stop offset={chart.splitLine} stopColor={OVER} />
                    <stop offset={chart.splitLine} stopColor={UNDER} />
                    <stop offset="1" stopColor={UNDER} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} vertical={false} />
                <XAxis dataKey="day" type="number" domain={[1, chart.D]} ticks={chart.ticks} tick={{ fill: "currentColor", fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, chart.top]} tickFormatter={(v) => formatCompactCurrency(v)} tick={{ fill: "currentColor", fontSize: 12 }} tickLine={false} axisLine={false} width={52} />
                <Tooltip
                  formatter={(v) => (v == null ? "—" : formatCurrency(Number(v)))}
                  labelFormatter={(d) => `Day ${d}`}
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid rgba(0,0,0,0.1)" }}
                />
                <ReferenceLine
                  y={limit}
                  stroke="currentColor"
                  strokeOpacity={0.45}
                  strokeDasharray="5 4"
                  label={{ value: `Limit ${formatCompactCurrency(limit)}`, position: "insideTopRight", fontSize: 10, fill: "currentColor" }}
                />
                <Line dataKey="avg" name="Average" stroke={AVG_COLOR} strokeWidth={1.5} dot={false} connectNulls />
                <Line dataKey="compare" name={compareLabel} stroke={CMP_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                <Area dataKey="current" name="This month" stroke={lineStroke} strokeWidth={2.5} fill={areaFill} fillOpacity={fillCrosses ? 1 : 0.18} dot={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-black/55 dark:text-white/55">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm" style={{ background: `linear-gradient(90deg, ${UNDER}, ${OVER})` }} />
              This month {formatCurrency(chart.spent)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ background: AVG_COLOR }} />
              Average
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: CMP_COLOR }} />
              {compareLabel}
            </span>
            <span className={over ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
              {over
                ? `${formatCurrency(chart.spent - limit)} over the ${formatCurrency(limit)} limit`
                : `${formatCurrency(limit - chart.spent)} left of the ${formatCurrency(limit)} limit`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
