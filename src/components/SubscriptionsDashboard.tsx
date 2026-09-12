"use client";

import { useCallback, useEffect, useState } from "react";
import type { SubscriptionDTO, SubscriptionsResponse } from "@/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { CADENCES, CADENCE_LABELS } from "@/lib/subscriptions";

const inputCls =
  "rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-black/40 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/40 dark:focus:border-white/40";

export function SubscriptionsDashboard() {
  const [data, setData] = useState<SubscriptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [detectMsg, setDetectMsg] = useState("");
  const [detecting, setDetecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/subscriptions");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      setData((await res.json()) as SubscriptionsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function detect() {
    setDetecting(true);
    setDetectMsg("");
    try {
      const res = await fetch("/api/subscriptions/detect", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Detection failed");
      const failed = (d.errors ?? []) as { institution: string; error: string }[];
      setDetectMsg(
        `Found ${d.found} recurring charge${d.found === 1 ? "" : "s"}.` +
          (failed.length ? ` (${failed.map((f) => `${f.institution}: ${f.error}`).join("; ")})` : "")
      );
      await load();
    } catch (err) {
      setDetectMsg(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }

  const subs = data?.subscriptions ?? [];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-black/55 dark:text-white/55">
            {formatCurrency(data?.monthlyTotal ?? 0)}/mo across{" "}
            {subs.filter((s) => s.isActive).length} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={detect}
            disabled={detecting}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.04]"
          >
            {detecting ? "Detecting…" : "Detect from banks"}
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
          >
            + Add
          </button>
        </div>
      </header>

      {detectMsg && (
        <p className="text-xs text-black/55 dark:text-white/55">{detectMsg}</p>
      )}

      <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        Detection finds <strong>recurring charges</strong>{" "}
        from your transactions — it tries to skip rent, loans, and transfers,
        but isn&apos;t perfect. Delete anything that isn&apos;t a subscription.
      </p>

      {adding && <AddForm onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : subs.length === 0 ? (
        <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          No subscriptions yet. Hit <span className="font-medium">Detect from banks</span> or{" "}
          <span className="font-medium">+ Add</span>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {subs.map((s) => (
              <Row key={s.id} sub={s} onChanged={load} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ sub, onChanged }: { sub: SubscriptionDTO; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    await fetch(`/api/subscriptions/${sub.id}`, { method: "DELETE" });
    onChanged();
  }
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${sub.isActive ? "" : "opacity-60"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{sub.name}</span>
          <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-black/55 dark:bg-white/10 dark:text-white/55">
            {sub.source === "AUTO" ? "detected" : "manual"}
          </span>
          {!sub.isActive && (
            <span className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/40">
              inactive
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">
          {sub.cadenceLabel}
          {sub.accountName && ` · ${sub.accountName}`}
          {sub.nextDate && ` · next ${formatDate(sub.nextDate)}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-right">
        <div>
          <div className="font-mono text-sm tabular-nums">{formatCurrency(sub.amount)}</div>
          <div className="text-xs text-black/45 dark:text-white/45">
            {formatCurrency(sub.monthlyCost)}/mo
          </div>
        </div>
        <button
          onClick={remove}
          disabled={busy}
          aria-label="Delete subscription"
          className="text-black/30 hover:text-red-600 disabled:opacity-50 dark:text-white/30 dark:hover:text-red-400"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function AddForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState("MONTHLY");
  const [nextDate, setNextDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        amount: Number(amount),
        cadence,
        nextDate: nextDate || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to add");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="grid gap-2 sm:grid-cols-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Netflix)" required className={inputCls} />
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Amount" inputMode="decimal" required className={inputCls} />
        <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={inputCls}>
          {CADENCES.map((c) => (
            <option key={c} value={c}>{CADENCE_LABELS[c]}</option>
          ))}
        </select>
        <input value={nextDate} onChange={(e) => setNextDate(e.target.value)} type="date" className={inputCls} />
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2.5 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
          {busy ? "Adding…" : "Add subscription"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.04]">
          Cancel
        </button>
      </div>
    </form>
  );
}
