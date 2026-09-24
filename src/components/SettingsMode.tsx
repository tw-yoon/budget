"use client";

import { useProMode } from "./useProMode";
import type { ProMode } from "@/lib/pro-mode";

const MODES: { value: ProMode; label: string; blurb: string }[] = [
  {
    value: "normal",
    label: "Normal",
    blurb: "Summary cards, spending by category, and the monthly trend.",
  },
  {
    value: "pro",
    label: "Pro",
    blurb:
      "Everything in Normal, plus the income and tax organizer, the cash-flow diagram, the cumulative spending graph, and splitting one payment across categories in the ledger.",
  },
];

export function SettingsMode() {
  const { mode, choose } = useProMode();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Mode</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          How much detail the app shows.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => choose(m.value)}
            aria-pressed={mode === m.value}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              mode === m.value
                ? "border-foreground bg-black/[0.03] dark:bg-white/[0.06]"
                : "border-black/10 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {m.label}
              {mode === m.value && (
                <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-background">
                  Current
                </span>
              )}
            </span>
            <span className="mt-1 block text-sm text-black/55 dark:text-white/55">
              {m.blurb}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
