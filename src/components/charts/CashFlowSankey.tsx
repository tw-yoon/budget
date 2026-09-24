"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCashflow } from "./useCashflow";
import { useMonthWindow } from "./useMonthWindow";
import { WindowNav } from "./WindowNav";
import type { CashflowMonth } from "@/types";
import { formatCurrency, formatCompactCurrency } from "@/lib/format";
import { INCOME_COLOR, DRAW_COLOR, SAVED_COLOR, HUB_COLOR, categoryColor } from "@/lib/colors";

const TOP_SPEND = 7;
const TOP_INCOME = 5;
const DRAG_PX = 80;
const NARROW = 560;
const LABEL_MIN_H = 11;
// A band one pixel tall is impossible to point at, and those are exactly the
// ones with no room for a label — so every node carries an invisible hit area
// of at least this height. Kept under the node gap (`pad`) so a thin band's
// target cannot swallow its neighbour's.
const HIT_MIN_H = 9;

const kCompact = (n: number) => formatCompactCurrency(n);
const truncate = (s: string, max: number) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

interface Node {
  name: string;
  amount: number;
  color: string;
  // User-defined subcategory totals ("Parent > Sub" overrides). Rendered as a
  // second branch stage, but only in single-month view — with 2+ months there
  // isn't room for the extra detail.
  subs?: { name: string; amount: number }[];
}

function foldTail(items: Node[], top: number, otherName: string, otherColor: string): Node[] {
  if (items.length <= top) return items;
  const head = items.slice(0, top).map((i) => ({ ...i }));
  const tail = items.slice(top).reduce((s, i) => s + i.amount, 0);
  const existing = head.find((h) => h.name === otherName);
  if (existing) existing.amount += tail;
  else head.push({ name: otherName, amount: tail, color: otherColor });
  return head.sort((a, b) => b.amount - a.amount);
}

// A smooth filled ribbon (cubic bézier) between two vertical segments — the
// same shape recharts draws for Sankey links, but filled so it never balloons.
function ribbon(
  x0: number, t0: number, b0: number,
  x1: number, t1: number, b1: number
): string {
  const mx = (x0 + x1) / 2;
  return `M${x0},${t0} C${mx},${t0} ${mx},${t1} ${x1},${t1} L${x1},${b1} C${mx},${b1} ${mx},${b0} ${x0},${b0} Z`;
}

/** What the pointer is over, in container coordinates. */
interface Hover {
  x: number;
  y: number;
  month: string;
  name: string;
  /** Set when `name` is a subcategory, so the tooltip can show the pair. */
  parent?: string;
  amount: number;
  color: string;
  faded?: boolean; // the un-subcategorized remainder of a branched category
}

interface MonthVM {
  key: string;
  label: string;
  inflow: Node[]; // income sources, then a "Savings" drawdown if in deficit
  outflow: Node[]; // spend categories, then a "To savings" surplus
  incomeTotal: number;
  spendTotal: number;
  hubTotal: number; // = max(incomeTotal, spendTotal)
}

interface WindowModel {
  months: MonthVM[];
  maxHub: number;
  maxNodes: number;
  drawn: number; // net pulled from savings across the window (<0 = added)
}

function buildModel(windowMonths: CashflowMonth[]): WindowModel {
  const months: MonthVM[] = windowMonths.map((m) => {
    const income = foldTail(
      m.income.map((i) => ({ name: i.source, amount: i.amount, color: INCOME_COLOR })),
      TOP_INCOME,
      "Other income",
      INCOME_COLOR
    );
    const spend = foldTail(
      m.spend.map((c) => ({
        name: c.category,
        amount: c.amount,
        color: categoryColor(c.category),
        subs: c.subs,
      })),
      TOP_SPEND,
      "Other",
      categoryColor("Other")
    );
    const incomeTotal = income.reduce((s, i) => s + i.amount, 0);
    const spendTotal = spend.reduce((s, c) => s + c.amount, 0);
    const draw = Math.max(0, spendTotal - incomeTotal);
    const surplus = Math.max(0, incomeTotal - spendTotal);
    return {
      key: m.key,
      label: m.label,
      inflow: draw > 0 ? [...income, { name: "Savings", amount: draw, color: DRAW_COLOR }] : income,
      outflow: surplus > 0 ? [...spend, { name: "To savings", amount: surplus, color: SAVED_COLOR }] : spend,
      incomeTotal,
      spendTotal,
      hubTotal: Math.max(incomeTotal, spendTotal),
    };
  });

  return {
    months,
    maxHub: Math.max(1, ...months.map((m) => m.hubTotal)),
    maxNodes: Math.max(1, ...months.map((m) => Math.max(m.inflow.length, m.outflow.length))),
    drawn: months.reduce((s, m) => s + m.spendTotal - m.incomeTotal, 0),
  };
}

export function CashFlowSankey() {
  const { data, error, loading } = useCashflow();
  const series = data?.months ?? null;
  const total = series?.length ?? 0;
  const win = useMonthWindow(total, 2);
  const { view, startIdx, pan, zoom, panTo } = win;

  const [grabbing, setGrabbing] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [width, setWidth] = useState(0);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; startEnd: number } | null>(null);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((e) => setWidth(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setHover(null); // panning, not reading
    drag.current = { startX: e.clientX, startEnd: view.end };
    setGrabbing(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* stale pointer — drag still works without capture */
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const steps = Math.round((e.clientX - drag.current.startX) / DRAG_PX);
    panTo(drag.current.startEnd - steps);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setGrabbing(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // Hover handlers for one band. Pointer capture during a drag routes moves to
  // the container, so the only case to guard is the pointer that went down on
  // a band and is now panning.
  const track = (info: Omit<Hover, "x" | "y">) => {
    // Safe to read `hoverable` from above: track() only runs while building the
    // JSX below, long after that const is initialized.
    if (!hoverable) return {};
    const show = (e: React.PointerEvent<SVGElement>) => {
      if (drag.current) return;
      const box = chartRef.current?.getBoundingClientRect();
      if (!box) return;
      setHover({ ...info, x: e.clientX - box.left, y: e.clientY - box.top });
    };
    return {
      onPointerEnter: show,
      onPointerMove: show,
      onPointerLeave: () => setHover(null),
    };
  };

  const windowMonths = useMemo(
    () => (series ? series.slice(startIdx, view.end) : []),
    [series, startIdx, view.end]
  );
  const model = useMemo(() => buildModel(windowMonths), [windowMonths]);

  const hasFlow = model.months.some((m) => m.hubTotal > 0);
  const single = model.months.length === 1;
  const rangeLabel =
    model.months.length === 0
      ? "—"
      : single
        ? model.months[0].label
        : `${model.months[0].label} – ${model.months[model.months.length - 1].label}`;

  // Hovering is for the one- and two-month views. Past that a month is only a
  // few pixels wide, its bands are stacked too tightly to point at the one you
  // meant, and a tooltip chasing the pointer across a dozen months is noise —
  // that view is for the shape of the series, not for reading a single band.
  const hoverable = model.months.length <= 2;
  const narrow = width > 0 && width < NARROW;
  const labelMax = narrow ? 10 : 16;

  // ---- geometry (shared across the per-month Sankeys) ----
  const N = model.months.length || 1;
  const H = 372;
  const topPad = 22;
  const botPad = 30;
  const usableH = H - topPad - botPad;
  const nodeW = single ? 13 : 11;
  const pad = 7;
  const slotW = (width || 600) / N;
  const showLabels = single || slotW > 300;
  const showMonthEvery = Math.max(1, Math.ceil((narrow ? 60 : 80) / slotW));
  const showTotals = slotW > 70;
  const scale = (usableH - (model.maxNodes - 1) * pad) / model.maxHub * 0.92;
  // Single-month view branches subcategorized spend into a second stage. When
  // it does, branched categories are labelled on the LEFT of their node, so the
  // hub→node gap is widened to give those labels clear room off the hub.
  const showSubStage =
    single && !narrow && (model.months[0]?.outflow.some((n) => n.subs?.length) ?? false);
  const ribbonRun = single
    ? Math.min(showSubStage ? 150 : (narrow ? 44 : 90), slotW * 0.24)
    : Math.min(narrow ? 30 : 58, slotW * 0.2);
  const cxOf = (k: number) => slotW * (k + 0.5);

  return (
    <div className="rounded-lg border border-black/10 p-4 text-black/70 dark:border-white/10 dark:text-white/70">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Cash flow over time</h3>
          <p className="text-xs text-black/50 dark:text-white/50">
            {rangeLabel}
            {!single && model.months.length ? ` · ${model.months.length} months` : ""}
          </p>
        </div>
        {/* Clear the tooltip as the window changes: the band under the pointer
            is about to be a different one, or to stop listening altogether,
            and either way no leave event is coming for it. Dragging clears it
            on pointer-down for the same reason. */}
        <WindowNav
          onPan={(d) => {
            setHover(null);
            pan(d);
          }}
          onZoom={(d) => {
            setHover(null);
            zoom(d);
          }}
          {...win}
        />
      </div>

      <div
        ref={chartRef}
        onPointerDown={hasFlow ? onPointerDown : undefined}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`relative mt-3 w-full select-none ${hasFlow ? (grabbing ? "cursor-grabbing" : "cursor-grab") : ""}`}
        style={{ touchAction: "pan-y" }}
      >
        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>
        ) : error ? (
          <div className="flex h-72 items-center justify-center text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : total === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-black/50 dark:text-white/50">No transactions to chart.</div>
        ) : !hasFlow ? (
          <div className="flex h-72 flex-col items-center justify-center gap-1 text-sm text-black/50 dark:text-white/50">
            <span>No cash flow in {rangeLabel}.</span>
            <span className="text-xs">Drag or use the arrows to find activity.</span>
          </div>
        ) : width > 0 ? (
          <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} className="overflow-visible">
            {model.months.map((m, k) => {
              if (m.hubTotal <= 0) {
                return (k % showMonthEvery === 0) ? (
                  <text key={m.key} x={cxOf(k)} y={topPad - 8} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.4}>
                    {narrow ? m.label.replace(/ 20/, " '") : m.label}
                  </text>
                ) : null;
              }
              // Subcategory branch stage: single-month view only (see
              // showSubStage) — with 2+ months there's too much to read.
              const hasSubStage = showSubStage && m.outflow.some((n) => n.subs?.length);
              const subRun = 80;
              // Shift the whole diagram left a touch so the extra stage fits.
              const cx = cxOf(k) - (hasSubStage ? (subRun + nodeW) / 2 : 0);
              const hubH = m.hubTotal * scale;
              const hubTop = topPad + (usableH - hubH) / 2;
              const hubL = cx - nodeW / 2;
              const hubR = cx + nodeW / 2;
              const xInR = hubL - ribbonRun;
              const xSpL = hubR + ribbonRun;
              const xSubL = xSpL + nodeW + subRun;
              const els: React.ReactElement[] = [];

              // inflow side (left): income sources, then savings drawdown
              const inSpan = m.inflow.reduce((s, n) => s + n.amount * scale, 0) + (m.inflow.length - 1) * pad;
              let ny = topPad + (usableH - inSpan) / 2;
              let hy = hubTop;
              m.inflow.forEach((n, idx) => {
                const h = n.amount * scale;
                const inHover = { month: m.label, name: n.name, amount: n.amount, color: n.color };
                const inLabel = `${m.label} · ${n.name}: ${formatCurrency(n.amount)}`;
                els.push(
                  <path key={`ir-${k}-${idx}`} d={ribbon(xInR, ny, ny + h, hubL, hy, hy + h)} fill={n.color} fillOpacity={0.42} role="img" aria-label={inLabel} {...track(inHover)} />
                );
                els.push(<rect key={`in-${k}-${idx}`} x={xInR - nodeW} y={ny} width={nodeW} height={Math.max(1, h)} rx={2} fill={n.color} />);
                if (hoverable) els.push(
                  <rect key={`ih-${k}-${idx}`} x={xInR - nodeW - 3} y={ny + h / 2 - Math.max(h, HIT_MIN_H) / 2} width={nodeW + 6} height={Math.max(h, HIT_MIN_H)} fill="transparent" role="img" aria-label={inLabel} {...track(inHover)} />
                );
                if (showLabels && h >= LABEL_MIN_H)
                  els.push(
                    <text key={`il-${k}-${idx}`} x={xInR - nodeW - 5} y={ny + h / 2} textAnchor="end" dominantBaseline="central" fontSize={10} fill="currentColor">
                      {truncate(n.name, labelMax)} {kCompact(n.amount)}
                    </text>
                  );
                ny += h + pad;
                hy += h;
              });

              // outflow side (right): spend categories, then surplus to savings
              const outSpan = m.outflow.reduce((s, n) => s + n.amount * scale, 0) + (m.outflow.length - 1) * pad;
              let oy = topPad + (usableH - outSpan) / 2;
              hy = hubTop;
              let subCursor = topPad; // keeps adjacent categories' sub stacks from overlapping
              m.outflow.forEach((n, idx) => {
                const h = n.amount * scale;
                const outHover = { month: m.label, name: n.name, amount: n.amount, color: n.color };
                const outLabel = `${m.label} · ${n.name}: ${formatCurrency(n.amount)}`;
                els.push(
                  <path key={`or-${k}-${idx}`} d={ribbon(hubR, hy, hy + h, xSpL, oy, oy + h)} fill={n.color} fillOpacity={0.5} role="img" aria-label={outLabel} {...track(outHover)} />
                );
                els.push(<rect key={`on-${k}-${idx}`} x={xSpL} y={oy} width={nodeW} height={Math.max(1, h)} rx={2} fill={n.color} />);
                if (hoverable) els.push(
                  <rect key={`oh-${k}-${idx}`} x={xSpL - 3} y={oy + h / 2 - Math.max(h, HIT_MIN_H) / 2} width={nodeW + 6} height={Math.max(h, HIT_MIN_H)} fill="transparent" role="img" aria-label={outLabel} {...track(outHover)} />
                );

                // Branch this category into its subcategories; whatever wasn't
                // subcategorized flows on as a "rest" node ("Other <category>").
                const drawSubs = hasSubStage && n.subs?.length;
                if (drawSubs) {
                  const named = n.subs!;
                  const rest = n.amount - named.reduce((s, x) => s + x.amount, 0);
                  const parts = [
                    ...named.map((p) => ({ ...p, rest: false })),
                    ...(rest > 0.005 ? [{ name: "Other", amount: rest, rest: true }] : []),
                  ];
                  const subPad = 3;
                  const span = parts.reduce((s, p) => s + p.amount * scale, 0) + (parts.length - 1) * subPad;
                  let sy = Math.max(subCursor, oy + (h - span) / 2);
                  let py = oy; // cursor along the parent node's right edge
                  parts.forEach((p, j) => {
                    const sh = p.amount * scale;
                    const subHover = {
                      month: m.label,
                      name: p.rest ? "Other" : p.name,
                      parent: n.name,
                      amount: p.amount,
                      color: n.color,
                      faded: p.rest,
                    };
                    const subLabel = `${m.label} · ${n.name} › ${p.rest ? "Other" : p.name}: ${formatCurrency(p.amount)}`;
                    els.push(
                      <path key={`sr-${k}-${idx}-${j}`} d={ribbon(xSpL + nodeW, py, py + sh, xSubL, sy, sy + sh)} fill={n.color} fillOpacity={p.rest ? 0.18 : 0.34} role="img" aria-label={subLabel} {...track(subHover)} />
                    );
                    els.push(<rect key={`sn-${k}-${idx}-${j}`} x={xSubL} y={sy} width={nodeW} height={Math.max(1, sh)} rx={2} fill={n.color} fillOpacity={p.rest ? 0.5 : 0.85} />);
                    if (hoverable) els.push(
                      <rect key={`sh-${k}-${idx}-${j}`} x={xSubL - 3} y={sy + sh / 2 - Math.max(sh, HIT_MIN_H) / 2} width={nodeW + 6} height={Math.max(sh, HIT_MIN_H)} fill="transparent" role="img" aria-label={subLabel} {...track(subHover)} />
                    );
                    if (sh >= 8)
                      els.push(
                        <text key={`sl-${k}-${idx}-${j}`} x={xSubL + nodeW + 5} y={sy + sh / 2} textAnchor="start" dominantBaseline="central" fontSize={9.5} fill="currentColor" fillOpacity={p.rest ? 0.55 : 0.85} fontStyle={p.rest ? "italic" : "normal"}>
                        {truncate(p.name, labelMax)} {kCompact(p.amount)}
                      </text>
                      );
                    sy += sh + subPad;
                    py += sh;
                  });
                  subCursor = sy - subPad + pad;
                }

                // Category label. For branched categories it goes to the LEFT of
                // the spend node (the right side now holds the sub stage);
                // otherwise it sits to the right as usual.
                if (showLabels && h >= LABEL_MIN_H)
                  els.push(
                    drawSubs ? (
                      <text key={`ol-${k}-${idx}`} x={xSpL - 5} y={oy + h / 2} textAnchor="end" dominantBaseline="central" fontSize={10} fontWeight={600} fill="currentColor">
                        {truncate(n.name, labelMax)} {kCompact(n.amount)}
                      </text>
                    ) : (
                      <text key={`ol-${k}-${idx}`} x={xSpL + nodeW + 5} y={oy + h / 2} textAnchor="start" dominantBaseline="central" fontSize={10} fill="currentColor">
                        {truncate(n.name, labelMax)} {kCompact(n.amount)}
                      </text>
                    )
                  );
                oy += h + pad;
                hy += h;
              });

              // central total node
              els.push(
                <rect key={`hub-${k}`} x={hubL} y={hubTop} width={nodeW} height={Math.max(1, hubH)} rx={2} fill={HUB_COLOR} fillOpacity={0.92}
                  role="img" aria-label={`${m.label} · Total cash flow: ${formatCurrency(m.hubTotal)}`}
                  {...track({ month: m.label, name: "Total cash flow", amount: m.hubTotal, color: HUB_COLOR })} />
              );

              // labels
              if (k % showMonthEvery === 0)
                els.push(
                  <text key={`m-${k}`} x={cx} y={topPad - 8} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor">
                    {narrow ? m.label.replace(/ 20/, " '") : m.label}
                  </text>
                );
              if (showTotals)
                els.push(
                  <text key={`t-${k}`} x={cx} y={H - 12} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.65}>
                    <tspan fill={INCOME_COLOR}>in {kCompact(m.incomeTotal)}</tspan>
                    <tspan>{"  ·  "}</tspan>
                    <tspan>out {kCompact(m.spendTotal)}</tspan>
                  </text>
                );

              return <g key={m.key}>{els}</g>;
            })}
          </svg>
        ) : (
          <div className="h-72" />
        )}

        {/* Follows the pointer, and never receives it — a tooltip under the
            cursor would end its own hover. Flips to the left of the pointer
            near the right edge so it stays inside the chart. */}
        {hoverable && hover && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap border border-line bg-panel px-2 py-1.5 text-xs shadow-sm"
            style={{
              left: hover.x > (width || 0) - 190 ? undefined : hover.x + 14,
              right: hover.x > (width || 0) - 190 ? Math.max(0, (width || 0) - hover.x + 14) : undefined,
              top: Math.max(0, hover.y - 46),
            }}
          >
            <div className="text-[10px] uppercase tracking-wide text-black/45 dark:text-white/45">
              {hover.month}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-foreground">
              <span className="h-2 w-2 shrink-0" style={{ background: hover.color, opacity: hover.faded ? 0.5 : 1 }} />
              {hover.parent && (
                <span className="text-black/55 dark:text-white/55">{hover.parent} ›</span>
              )}
              <span className={hover.faded ? "italic" : "font-medium"}>{hover.name}</span>
            </div>
            <div className="mt-0.5 font-mono tabular-nums text-foreground">
              {formatCurrency(hover.amount)}
            </div>
          </div>
        )}
      </div>

      {hasFlow && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-black/55 dark:text-white/55">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: INCOME_COLOR }} />Income
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: HUB_COLOR }} />Total cash flow
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: DRAW_COLOR }} />From savings
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: SAVED_COLOR }} />To savings
          </span>
          {model.drawn > 0 ? (
            <span className="text-red-600 dark:text-red-400">
              Drew {formatCurrency(model.drawn)} from savings over this span
            </span>
          ) : model.drawn < 0 ? (
            <span className="text-blue-600 dark:text-blue-400">
              Added {formatCurrency(-model.drawn)} to savings over this span
            </span>
          ) : null}
          <span className="ml-auto hidden text-black/40 sm:inline dark:text-white/40">
            {hoverable ? "Hover for detail · drag to move" : "Drag to move"}
          </span>
        </div>
      )}
    </div>
  );
}
