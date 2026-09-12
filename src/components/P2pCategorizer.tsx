"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";

interface P2pTx {
  id: string;
  date: string;
  note: string;
  counterparty: string | null;
  direction: "in" | "out";
  amount: number;
  category: string;
}

interface P2pResponse {
  transactions: P2pTx[];
  categories: string[];
}

interface Props {
  title: string;
  subtitle: string;
  endpoint: string; // e.g. "/api/venmo" or "/api/zelle"
  // Venmo imports from CSV; Zelle rides the bank feed and has nothing to import.
  showImport?: boolean;
  emptyHint: React.ReactNode;
}

// Categories that mean "don't count this as spending".
const IGNORED = new Set(["Uncategorized", "Transfer"]);

export function P2pCategorizer({ title, subtitle, endpoint, showImport, emptyHint }: Props) {
  const [data, setData] = useState<P2pResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      setData((await res.json()) as P2pResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const runImport = async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${endpoint}/import`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Import failed");
      setNotice(
        body.imported > 0
          ? `Imported ${body.imported} payments · reconciled ${body.reconciledCashouts} cash-out${body.reconciledCashouts === 1 ? "" : "s"}.`
          : "No statements found in your Downloads folder."
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const updateCategory = async (id: string, userCategory: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            transactions: prev.transactions.map((t) =>
              t.id === id ? { ...t, category: userCategory } : t
            ),
          }
        : prev
    );
    try {
      await fetch(`${endpoint}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCategory }),
      });
    } catch {
      setError("Failed to save category — reloading.");
      load();
    }
  };

  const totals = useMemo(() => {
    const txns = data?.transactions ?? [];
    let out = 0;
    let inc = 0;
    for (const t of txns) {
      if (IGNORED.has(t.category)) continue; // ignore uncategorized/transfers
      if (t.direction === "out") out += t.amount;
      else inc += t.amount;
    }
    return { out, inc };
  }, [data]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-black/55 dark:text-white/55">{subtitle}</p>
        </div>
        {showImport && (
          <button
            onClick={runImport}
            disabled={importing}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.05]"
          >
            {importing ? "Importing…" : "Import / re-sync CSV"}
          </button>
        )}
      </header>

      {notice && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-lg border border-black/10 px-6 py-16 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : !data || data.transactions.length === 0 ? (
        <div className="rounded-lg border border-black/10 px-6 py-16 text-center dark:border-white/10">
          <p className="text-sm font-medium">Nothing to categorize yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-black/55 dark:text-white/55">
            {emptyHint}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Sent (categorized)" value={formatCurrency(totals.out)} tone="out" />
            <Stat label="Received (categorized)" value={formatCurrency(totals.inc)} tone="in" />
            <Stat label="Net spend" value={formatCurrency(totals.out - totals.inc)} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-black/50 dark:border-white/10 dark:text-white/50">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-black/[0.06] last:border-0 hover:bg-black/[0.02] dark:border-white/[0.06] dark:hover:bg-white/[0.03]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-black/55 dark:text-white/55">
                      {formatDate(t.date)}
                    </td>
                    <td className="px-4 py-3">{t.counterparty ?? "—"}</td>
                    <td className="px-4 py-3 text-black/60 dark:text-white/60">
                      {t.note || "—"}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums ${
                        t.direction === "in"
                          ? "text-green-600 dark:text-green-400"
                          : "text-black/80 dark:text-white/80"
                      }`}
                    >
                      {t.direction === "in" ? "+" : "−"}
                      {formatCurrency(t.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={t.category}
                        onChange={(e) => updateCategory(t.id, e.target.value)}
                        className={`rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40 ${
                          IGNORED.has(t.category)
                            ? "text-black/40 dark:text-white/40"
                            : ""
                        }`}
                      >
                        {data.categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "in" | "out";
}) {
  const color =
    tone === "in"
      ? "text-green-600 dark:text-green-400"
      : tone === "out"
        ? "text-black/80 dark:text-white/80"
        : "";
  return (
    <div className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
      <div className="text-xs text-black/50 dark:text-white/50">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}
