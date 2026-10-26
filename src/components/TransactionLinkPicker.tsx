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
        <span className="text-muted2">Pays back</span>
        <span className="chip text-pos">
          #{linkedTo.label ?? "?"} {linkedTo.name} · {linkedTo.category}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => save(null)}
          className="btn text-neg disabled:opacity-50"
        >
          Disconnect
        </button>
        {error && <span className="text-neg">{error}</span>}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPicker}
        className="text-xs text-muted2 underline-offset-2 hover:underline"
      >
        Connect to a purchase…
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="text-muted2">Connect to a purchase</span>
      {candidates === null ? (
        <span className="text-dim2">Looking…</span>
      ) : candidates.length === 0 ? (
        <span className="text-dim2">
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
              className="btn h-auto w-full whitespace-normal text-left disabled:opacity-50"
            >
              <span className="text-dim2">#{c.label}</span>{" "}
              {formatDate(c.date)} · {c.name} · {formatCurrency(c.amount)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-dim2">#</span>
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
          className="field w-24"
        />
        <button
          type="button"
          disabled={busy || !typed}
          onClick={() => save(Number(typed))}
          className="btn btn-primary disabled:opacity-50"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn"
        >
          Cancel
        </button>
      </div>
      {error && <span className="text-neg">{error}</span>}
    </div>
  );
}
