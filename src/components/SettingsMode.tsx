"use client";

import { useProMode } from "./useProMode";
import { useTheme } from "./useTheme";
import type { ProMode } from "@/lib/pro-mode";
import type { Theme } from "@/lib/theme";

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

const THEMES: { value: Theme; label: string; blurb: string }[] = [
  { value: "light", label: "Light", blurb: "Always the paper palette." },
  { value: "dark", label: "Dark", blurb: "Always the terminal palette." },
  {
    value: "system",
    label: "System",
    blurb: "Follow whatever this device is set to, and change with it.",
  },
];

export function SettingsMode() {
  const { mode, choose } = useProMode();
  const { theme, choose: chooseTheme } = useTheme();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Mode</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          How much detail the app shows, and how it looks.
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

      <section className="flex flex-col gap-3 border-t border-black/10 pt-5 dark:border-white/10">
        <div>
          <h2 className="text-sm font-medium">Appearance</h2>
          <p className="text-sm text-black/55 dark:text-white/55">
            This follows you between browsers, like the rest of your settings.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => chooseTheme(t.value)}
              aria-pressed={theme === t.value}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                theme === t.value
                  ? "border-foreground bg-black/[0.03] dark:bg-white/[0.06]"
                  : "border-black/10 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {t.label}
                {theme === t.value && (
                  <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-background">
                    Current
                  </span>
                )}
              </span>
              <span className="mt-1 block text-sm text-black/55 dark:text-white/55">
                {t.blurb}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
