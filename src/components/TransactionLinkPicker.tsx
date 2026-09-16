"use client";

import { useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import type { LinkedTargetDTO } from "@/types";

interface Candidate {
  id: string;
  label: number | null;
  date: string;
  name: string;
  amount: number;
  category: string;
}

/**
 * Connects a money-in row to the purchase it pays back. Suggestions come from
 * the server ranked, because the purchase behind a refund is usually not on the
 * page you are looking at; the number field is the escape hatch for the rest.
 */
export function TransactionLinkPicker({
  transactionId,
  linkedTo,
  onLinked,
}: {
  transactionId: string;
  linkedTo: LinkedTargetDTO | null;
  onLinked: (linked: { label: number | null; name: string } | null) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (label: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${transactionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedToLabel: label }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not connect");
      onLinked(body.linkedTo ?? null);
      setOpen(false);
      setTyped("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  const openPicker = async () => {
    setOpen(true);
    if (candidates !== null) return;
    try {
      const res = await fetch(`/api/transactions/${transactionId}/link-candidates`);
      const body = await res.json();
      setCandidates(res.ok ? body.candidates : []);
    } catch {
      setCandidates([]);
    }
  };

  if (linkedTo) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-black/45 dark:text-white/45">Pays back</span>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          #{linkedTo.label ?? "?"} {linkedTo.name} · {linkedTo.category}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => save(null)}
          className="rounded px-1.5 py-0.5 text-black/50 hover:bg-black/[0.06] disabled:opacity-50 dark:text-white/50 dark:hover:bg-white/10"
        >
          Disconnect
        </button>
        {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPicker}
        className="text-xs text-black/45 underline-offset-2 hover:underline dark:text-white/45"
      >
        Connect to a purchase…
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="text-black/45 dark:text-white/45">Connect to a purchase</span>
      {candidates === null ? (
        <span className="text-black/40 dark:text-white/40">Looking…</span>
      ) : candidates.length === 0 ? (
        <span className="text-black/40 dark:text-white/40">
          No likely purchase found — enter a number below.
        </span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => save(c.label)}
              className="rounded border border-black/15 px-1.5 py-1 text-left hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/[0.06]"
            >
              <span className="font-mono text-black/40 dark:text-white/40">#{c.label}</span>{" "}
              {formatDate(c.date)} · {c.name} · {formatCurrency(c.amount)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-black/40 dark:text-white/40">#</span>
        <input
          type="number"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed) save(Number(typed));
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="number"
          disabled={busy}
          className="w-24 rounded border border-black/15 bg-white px-1.5 py-1 dark:border-white/20 dark:bg-neutral-900"
        />
        <button
          type="button"
          disabled={busy || !typed}
          onClick={() => save(Number(typed))}
          className="rounded bg-black px-2 py-1 font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-1 text-black/50 hover:bg-black/[0.04] dark:text-white/50"
        >
          Cancel
        </button>
      </div>
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
