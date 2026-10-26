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
      "Everything in Normal, plus the income and tax organizer, the cash-flow diagram, the cumulative spending graph, the flight comparison under Benefits, and splitting one payment across categories in the ledger.",
  },
];

const THEMES: { value: Theme; label: string; blurb: string }[] = [
  { value: "light", label: "Light", blurb: "Always light." },
  { value: "dark", label: "Dark", blurb: "Always dark." },
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
        <h1>Mode</h1>
        <p className="text-sm text-muted2">
          How much detail the app shows, and how it looks.
        </p>
      </header>

      <div className="group-panel">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => choose(m.value)}
            aria-pressed={mode === m.value}
            className={`group-row block w-full text-left transition-colors hover:bg-panel2 ${
              mode === m.value ? "bg-panel2" : ""
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {m.label}
              {mode === m.value && (
                <span className="chip">
                  Current
                </span>
              )}
            </span>
            <span className="mt-1 block text-sm text-muted2">
              {m.blurb}
            </span>
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <div>
          <h2>Appearance</h2>
          <p className="text-sm text-muted2">
            This follows you between browsers, like the rest of your settings.
          </p>
        </div>
        <div className="group-panel">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => chooseTheme(t.value)}
              aria-pressed={theme === t.value}
              className={`group-row block w-full text-left transition-colors hover:bg-panel2 ${
                theme === t.value ? "bg-panel2" : ""
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {t.label}
                {theme === t.value && (
                  <span className="chip">
                    Current
                  </span>
                )}
              </span>
              <span className="mt-1 block text-sm text-muted2">
                {t.blurb}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
