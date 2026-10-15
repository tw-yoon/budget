"use client";

import { useState } from "react";
import { humanizePfc } from "@/lib/format";

interface Props {
  categories: { id: string; name: string; plaidPrimaries: string[] }[];
  primaries: string[];
  unmapped: { pfcPrimary: string; transactionCount: number; examples?: { name: string; amount: number }[] }[];
  /** Map `primary` to `categoryId`, or unmap it when it is already there. */
  onToggle: (categoryId: string, primary: string) => void;
}

const ROW = 32; // px per row; lines are drawn from row centres
const GAP = 160; // px between the two columns, where the lines run

/**
 * Plaid labels on the left, categories on the right, a line per mapping. Click a
 * label, then a category, to connect them; click its current category to cut it.
 */
export function CategoryMap({ categories, primaries, unmapped, onToggle }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const unmappedBy = new Map(unmapped.map((u) => [u.pfcPrimary, u]));
  const owner = new Map(categories.flatMap((c) => c.plaidPrimaries.map((p) => [p, c.id] as const)));
  const catIndex = new Map(categories.map((c, i) => [c.id, i]));
  const height = Math.max(primaries.length, categories.length) * ROW;
  const y = (i: number) => i * ROW + ROW / 2;
  const picked = selected ? unmappedBy.get(selected) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-black/50 dark:text-white/50">
        {selected
          ? `Now click the category for ${humanizePfc(selected)} (click its current one to disconnect, or the label again to cancel).`
          : "Click a Plaid label, then the category it belongs to. Amber labels aren't connected yet."}
      </p>
      {picked?.examples && picked.examples.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-medium">
            {humanizePfc(picked.pfcPrimary)} · {picked.transactionCount} tx, e.g.{" "}
          </span>
          {picked.examples
            .map((e) => `${e.name} (${e.amount < 0 ? "+" : "−"}$${Math.abs(e.amount).toFixed(2)})`)
            .join(" · ")}
        </div>
      )}
      <div className="overflow-x-auto">
        <div className="flex min-w-[560px]" style={{ height }}>
          <ul className="flex-1">
            {primaries.map((p) => {
              const u = unmappedBy.get(p);
              const isSel = selected === p;
              return (
                <li key={p} style={{ height: ROW }} className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setSelected(isSel ? null : p)}
                    className={`truncate rounded px-2 py-0.5 text-xs ${
                      isSel
                        ? "bg-black text-white dark:bg-white dark:text-black"
                        : u
                        ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/40"
                        : "text-black/70 hover:bg-black/[0.06] dark:text-white/70 dark:hover:bg-white/10"
                    }`}
                  >
                    {humanizePfc(p)}
                    {u && ` (${u.transactionCount})`}
                  </button>
                </li>
              );
            })}
          </ul>
          <svg width={GAP} height={height} className="shrink-0" aria-hidden>
            {primaries.map((p, i) => {
              const ci = catIndex.get(owner.get(p) ?? "");
              if (ci === undefined) return null;
              const active = selected === p;
              return (
                <path
                  key={p}
                  d={`M6 ${y(i)} C${GAP / 2} ${y(i)}, ${GAP / 2} ${y(ci)}, ${GAP - 6} ${y(ci)}`}
                  fill="none"
                  strokeWidth={active ? 2.5 : 1.25}
                  className={active ? "stroke-black dark:stroke-white" : "stroke-sky-500/60"}
                />
              );
            })}
            {primaries.map((p, i) => (
              <circle
                key={p}
                cx={6}
                cy={y(i)}
                r={4}
                className={unmappedBy.has(p) ? "fill-amber-500" : owner.has(p) ? "fill-sky-500" : "fill-black/25 dark:fill-white/25"}
              />
            ))}
            {categories.map((c, i) => (
              <circle
                key={c.id}
                cx={GAP - 6}
                cy={y(i)}
                r={4}
                className={c.plaidPrimaries.length ? "fill-sky-500" : "fill-black/25 dark:fill-white/25"}
              />
            ))}
          </svg>
          <ul className="flex-1">
            {categories.map((c) => (
              <li key={c.id} style={{ height: ROW }} className="flex items-center">
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => {
                    if (!selected) return;
                    onToggle(c.id, selected);
                    setSelected(null);
                  }}
                  className={`truncate rounded px-2 py-0.5 text-xs ${
                    selected
                      ? owner.get(selected) === c.id
                        ? "bg-sky-100 text-sky-700 hover:bg-red-100 hover:text-red-700 dark:bg-sky-500/15 dark:text-sky-300"
                        : "text-black/80 ring-1 ring-black/15 hover:bg-sky-100 dark:text-white/80 dark:ring-white/20 dark:hover:bg-sky-500/15"
                      : "text-black/70 dark:text-white/70"
                  }`}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
