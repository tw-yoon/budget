"use client";

import { useCallback, useEffect, useState } from "react";
import type { MergeAccountBrief, MergePreview, MergeTxBrief } from "@/types";
import { mergeConfirm } from "@/lib/bank-actions";
import { formatDate, formatSignedAmount } from "@/lib/format";

// The review behind "Merge into <bank>…" and "Review duplicates…": pair the
// disconnected bank's accounts with the reconnection's, tick the duplicate
// transactions, then merge. Nothing changes until Merge is confirmed.
// docs/superpowers/specs/2026-10-02-reconnect-merges-history-design.md

type Pair = { from: string; to: string };
type Dup = MergePreview["duplicates"][number];

const key = (d: Dup) => `${d.old.id}|${d.new.id}`;
const defaults = (p: MergePreview) => new Set(p.duplicates.filter((d) => d.confident).map(key));

const selectCls =
  "rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40";

function accountLabel(a: MergeAccountBrief) {
  return a.mask ? `${a.name} ··${a.mask}` : a.name;
}

export function MergeReview({
  fromItemId,
  intoItemId,
  onClose,
  onMerged,
}: {
  fromItemId: string;
  intoItemId: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [pairs, setPairs] = useState<Pair[] | null>(null); // null: the server's suggestions
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(
    async (chosen: Pair[] | null) => {
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ into: intoItemId });
        if (chosen) q.set("pairs", chosen.map((p) => `${p.from}:${p.to}`).join(","));
        const res = await fetch(`/api/plaid/items/${fromItemId}/merge?${q}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Failed (HTTP ${res.status})`);
        setPreview(body);
        setPairs(body.pairs);
        setTicked(defaults(body));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load the review");
      } finally {
        setLoading(false);
      }
    },
    [fromItemId, intoItemId]
  );

  useEffect(() => {
    // Intentional data-fetch effect on mount, as in useAccountsData.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  function choose(oldId: string, newId: string) {
    const next = (pairs ?? []).filter((p) => p.from !== oldId && p.to !== newId);
    if (newId) next.push({ from: oldId, to: newId });
    void load(next);
  }

  function toggle(d: Dup) {
    const next = new Set(ticked);
    if (next.has(key(d))) next.delete(key(d));
    else next.add(key(d));
    setTicked(next);
  }

  // A row already in a ticked pair can't be in another.
  const usedRows = new Set(
    (preview?.duplicates ?? []).filter((d) => ticked.has(key(d))).flatMap((d) => [d.old.id, d.new.id])
  );
  const blocked = (d: Dup) => !ticked.has(key(d)) && (usedRows.has(d.old.id) || usedRows.has(d.new.id));

  async function merge() {
    if (!preview) return;
    const dups = preview.duplicates.filter((d) => ticked.has(key(d)));
    const accounts = pairs ?? [];
    const { title, message } = mergeConfirm(
      preview.from.institution,
      preview.into.institution,
      accounts.length,
      dups.length
    );
    if (!confirm(`${title}\n\n${message}`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/plaid/items/${fromItemId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          into: intoItemId,
          accounts,
          duplicates: dups.map((d) => ({ keep: d.old.id, drop: d.new.id })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (HTTP ${res.status})`);
      setDone(`Merged. The database from just before was saved as prisma/backups/${body.snapshot}.`);
      onMerged();
      await load([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge");
    } finally {
      setSaving(false);
    }
  }

  const sure = preview?.duplicates.filter((d) => d.confident) ?? [];
  const unsure = preview?.duplicates.filter((d) => !d.confident) ?? [];
  const accountCount = pairs?.length ?? 0;
  const dupCount = ticked.size;

  return (
    <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-2.5 dark:border-white/10">
        <h2 className="text-sm font-semibold">
          {preview
            ? `Merge the disconnected ${preview.from.institution} into ${preview.into.institution}`
            : "Merge"}
        </h2>
        <button
          onClick={onClose}
          className="text-xs font-medium text-black/55 hover:underline dark:text-white/55"
        >
          Close
        </button>
      </div>

      {error && <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {done && <div className="px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400">{done}</div>}

      {!preview ? (
        <p className="px-4 py-4 text-sm text-black/45 dark:text-white/45">Loading…</p>
      ) : (
        <div className={`flex flex-col gap-4 px-4 py-3 text-sm ${loading ? "opacity-60" : ""}`}>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
              Accounts
            </h3>
            {preview.oldAccounts.length === 0 && preview.mergedAccounts.length === 0 && (
              <p className="text-black/45 dark:text-white/45">No accounts left to merge.</p>
            )}
            <div className="flex flex-col gap-1.5">
              {preview.oldAccounts.map((o) => {
                const chosen = pairs?.find((p) => p.from === o.id)?.to ?? "";
                const taken = new Set((pairs ?? []).filter((p) => p.from !== o.id).map((p) => p.to));
                const options = preview.newAccounts.filter((n) => n.type === o.type && !taken.has(n.id));
                return (
                  <div key={o.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {accountLabel(o)}
                      <span className="ml-2 text-xs text-black/45 dark:text-white/45">
                        {o.transactionCount} transactions
                      </span>
                    </span>
                    <span className="text-black/40 dark:text-white/40">→</span>
                    <select
                      value={chosen}
                      disabled={loading || saving}
                      onChange={(e) => choose(o.id, e.target.value)}
                      className={selectCls}
                    >
                      <option value="">Don&apos;t merge</option>
                      {options.map((n) => (
                        <option key={n.id} value={n.id}>
                          {accountLabel(n)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              {preview.mergedAccounts.map((a) => (
                <div key={a.id} className="text-black/55 dark:text-white/55">
                  {accountLabel(a)} · merged
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
              Duplicates
            </h3>
            {preview.duplicates.length === 0 ? (
              <p className="text-black/45 dark:text-white/45">No possible duplicates.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-black/50 dark:text-white/50">
                  Each pair is one transaction both connections recorded. Merging keeps the earlier
                  row, with its label, category, splits, links and notes.
                </p>
                {sure.length > 0 && (
                  <DupList dups={sure} ticked={ticked} blocked={blocked} onToggle={toggle} />
                )}
                {unsure.length > 0 && (
                  <>
                    <p className="mb-1 mt-3 text-xs font-medium text-black/60 dark:text-white/60">
                      Not sure — tick only if they are the same
                    </p>
                    <DupList dups={unsure} ticked={ticked} blocked={blocked} onToggle={toggle} />
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={merge}
              disabled={loading || saving || (accountCount === 0 && dupCount === 0)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "Merging…" : "Merge"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function DupList({
  dups,
  ticked,
  blocked,
  onToggle,
}: {
  dups: Dup[];
  ticked: Set<string>;
  blocked: (d: Dup) => boolean;
  onToggle: (d: Dup) => void;
}) {
  return (
    <div className="divide-y divide-black/[0.06] rounded-md border border-black/10 dark:divide-white/[0.06] dark:border-white/10">
      {dups.map((d) => (
        <label
          key={key(d)}
          className={`flex cursor-pointer items-start gap-3 px-3 py-2 ${blocked(d) ? "opacity-40" : ""}`}
        >
          <input
            type="checkbox"
            className="mt-1"
            checked={ticked.has(key(d))}
            disabled={blocked(d)}
            onChange={() => onToggle(d)}
          />
          <div className="min-w-0 flex-1">
            <TxLine tx={d.old} />
            <TxLine tx={d.new} dim />
          </div>
        </label>
      ))}
    </div>
  );
}

function TxLine({ tx, dim = false }: { tx: MergeTxBrief; dim?: boolean }) {
  return (
    <div className={`flex items-baseline gap-2 ${dim ? "text-xs text-black/50 dark:text-white/50" : ""}`}>
      <span className="w-12 shrink-0 tabular-nums text-black/40 dark:text-white/40">
        {tx.label != null ? `#${tx.label}` : ""}
      </span>
      <span className="shrink-0 tabular-nums">{formatDate(tx.date)}</span>
      <span className="min-w-0 flex-1 truncate">
        {tx.name}
        {tx.pending && " · pending"}
        {tx.edited && " · edited"}
      </span>
      <span className="shrink-0 tabular-nums">{formatSignedAmount(tx.amount).text}</span>
    </div>
  );
}
