"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserCardDTO, UserCardsResponse } from "@/types";
import { ISSUERS, ISSUER_LABELS, MONTH_NAMES } from "@/lib/categories";
import { CARD_PRESETS } from "@/data/card-presets";
import { UserCardItem } from "./benefits/UserCardItem";
import { BestCards } from "./benefits/BestCards";
import { FlightComparison } from "./benefits/FlightComparison";

const inputClass =
  "rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-black/40 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/40 dark:focus:border-white/40";

// Expand a 1–2 digit year ("26" -> 2026) to a full year. Values at or before the
// current 2-digit year map to 20xx; later ones to 19xx (e.g. "98" -> 1998).
// A 4-digit input is used as-is.
function toFullYear(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return NaN;
  if (raw.length > 2) return n;
  const cy = new Date().getFullYear();
  const century = Math.floor(cy / 100) * 100; // 2000
  return n <= cy % 100 ? century + n : century - 100 + n;
}

export function BenefitsDashboard() {
  const [cards, setCards] = useState<UserCardDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/user-cards");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      const data = (await res.json()) as UserCardsResponse;
      setCards(data.cards);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional data-fetch effect on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const move = useCallback(
    async (id: string, dir: "up" | "down") => {
      setCards((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        const swap = dir === "up" ? idx - 1 : idx + 1;
        if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[swap]] = [next[swap], next[idx]];
        // Persist the new order (fire-and-forget; optimistic update above).
        fetch("/api/user-cards/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: next.map((c) => c.id) }),
        }).catch(() => {});
        return next;
      });
    },
    []
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        Earning rates are pre-filled from a <strong>~2025 snapshot</strong> and
        statement credits are whatever you enter — always verify current terms
        with your issuer. Credit progress is <strong>estimated</strong> from
        matched transactions on linked cards.
      </div>

      <BestCards cards={cards} />

      <AddCardForm onAdded={load} />

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      ) : loading && cards.length === 0 ? (
        <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          No cards yet. Add one above to start tracking its benefits.
        </div>
      ) : (
        <div className={`flex flex-col gap-4 ${loading ? "opacity-60 transition-opacity" : ""}`}>
          {cards.map((card, i) => (
            <UserCardItem
              key={card.id}
              card={card}
              onChanged={load}
              onMove={move}
              canMoveUp={i > 0}
              canMoveDown={i < cards.length - 1}
            />
          ))}
        </div>
      )}

      <FlightComparison cards={cards} />
    </div>
  );
}

function AddCardForm({ onAdded }: { onAdded: () => void }) {
  const [presetSlug, setPresetSlug] = useState(""); // "" = custom card
  const [issuer, setIssuer] = useState<string>("AMEX");
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isCustom = presetSlug === "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const membershipStartYear = toFullYear(year);
    // The month drives where a monthly credit's twelve-cell strip starts, so
    // months before you held the card aren't shown. Optional — without it the
    // strip falls back to January.
    const membershipStartMonth = parseInt(month, 10) || null;
    const payload = isCustom
      ? { issuer, name: name || null, last4, membershipStartYear, membershipStartMonth }
      : { presetSlug, last4, membershipStartYear, membershipStartMonth };

    const res = await fetch("/api/user-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to add card");
      return;
    }
    setPresetSlug("");
    setName("");
    setLast4("");
    setMonth("");
    setYear("");
    onAdded();
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-black/10 p-4 dark:border-white/10"
    >
      <div className="text-sm font-medium">Add a card</div>

      <select
        value={presetSlug}
        onChange={(e) => setPresetSlug(e.target.value)}
        className={`mt-3 w-full ${inputClass}`}
      >
        <option value="">Custom card (enter rates yourself)</option>
        {ISSUERS.map((iss) => (
          <optgroup key={iss} label={ISSUER_LABELS[iss]}>
            {CARD_PRESETS.filter((p) => p.issuer === iss).map((p) => (
              <option key={p.slug} value={p.slug}>
                {ISSUER_LABELS[p.issuer]} {p.name} — auto-fills rates
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {isCustom && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {ISSUERS.map((i) => (
              <button
                type="button"
                key={i}
                onClick={() => setIssuer(i)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  issuer === i
                    ? "bg-foreground text-background"
                    : "border border-black/15 text-black/70 hover:bg-black/[0.03] dark:border-white/15 dark:text-white/70 dark:hover:bg-white/[0.04]"
                }`}
              >
                {ISSUER_LABELS[i]}
              </button>
            ))}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Card name (optional, e.g. Platinum)"
            className={`mt-2 w-full ${inputClass}`}
          />
        </>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="Last 4 digits"
          inputMode="numeric"
          required
          className={inputClass}
        />
        <div className="flex items-center gap-1">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Membership start month"
            className={`flex-1 ${inputClass}`}
          >
            <option value="">Month…</option>
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <input
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 2))}
            placeholder="YY"
            aria-label="Membership start year"
            inputMode="numeric"
            maxLength={2}
            required
            className={`w-16 ${inputClass}`}
          />
        </div>
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-3 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add card"}
      </button>
    </form>
  );
}
