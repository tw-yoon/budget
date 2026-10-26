"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import { joinCategory, splitCategory } from "@/lib/categories";
import { TransactionLinkPicker } from "./TransactionLinkPicker";

interface P2pTx {
  id: string;
  label: number | null;
  date: string;
  note: string;
  counterparty: string | null;
  direction: "in" | "out";
  amount: number;
  category: string;
  linkedTo: { id: string; label: number | null; name: string; category: string } | null;
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
  // Category name -> its subcategories, for the subcategory suggestions.
  const [subcategories, setSubcategories] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json || cancelled) return;
        const cats = json.categories as { name: string; subcategories: { name: string }[] }[];
        setSubcategories(new Map(cats.map((c) => [c.name, c.subcategories.map((s) => s.name)])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  const updateCategory = async (id: string, userCategory: string, userSubcategory: string | null) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            transactions: prev.transactions.map((t) =>
              t.id === id ? { ...t, category: joinCategory(userCategory, userSubcategory) } : t
            ),
          }
        : prev
    );
    try {
      const res = await fetch(`${endpoint}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCategory, userSubcategory }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to save category — reloading.");
        load();
      }
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
      if (IGNORED.has(splitCategory(t.category).parent)) continue; // ignore uncategorized/transfers
      if (t.direction === "out") out += t.amount;
      else inc += t.amount;
    }
    return { out, inc };
  }, [data]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1>{title}</h1>
          <p className="text-sm text-muted2">{subtitle}</p>
        </div>
        {showImport && (
          <button
            onClick={runImport}
            disabled={importing}
            className="btn btn-primary disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import / re-sync CSV"}
          </button>
        )}
      </header>

      {notice && (
        <div className="group-panel px-4 py-3 text-sm text-pos">
          {notice}
        </div>
      )}
      {error && (
        <div className="group-panel px-4 py-3 text-sm text-neg">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="group-panel px-6 py-16 text-center text-sm text-muted2">
          Loading…
        </div>
      ) : !data || data.transactions.length === 0 ? (
        <div className="group-panel px-6 py-16 text-center">
          <p className="text-sm font-medium">Nothing to categorize yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted2">
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

          <div className="group-panel overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="section-caption border-b border-line text-left">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => {
                  const { parent, sub } = splitCategory(t.category);
                  return (
                  <tr
                    key={t.id}
                    className="border-b border-line last:border-0 hover:bg-panel2"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-dim2">
                      {t.label ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted2">
                      {formatDate(t.date)}
                    </td>
                    <td className="px-4 py-3">{t.counterparty ?? "—"}</td>
                    <td className="px-4 py-3 text-muted2">
                      {t.note || "—"}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${
                        t.direction === "in"
                          ? "text-pos"
                          : "text-foreground"
                      }`}
                    >
                      {t.direction === "in" ? "+" : "−"}
                      {formatCurrency(t.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={parent}
                        disabled={t.linkedTo !== null}
                        // A new category starts without a subcategory.
                        onChange={(e) => updateCategory(t.id, e.target.value, null)}
                        className={`field disabled:opacity-60 ${
                          IGNORED.has(parent)
                            ? "text-dim2"
                            : ""
                        }`}
                      >
                        {data.categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                        {/* A linked row shows an inherited category that may not
                            be in this page's fixed list. */}
                        {!data.categories.includes(parent) && (
                          <option value={parent}>{parent}</option>
                        )}
                      </select>
                      {parent !== "Uncategorized" && (
                        <>
                          <input
                            // Remounts with the saved value whenever it changes.
                            key={t.category}
                            type="text"
                            defaultValue={sub ?? ""}
                            placeholder="Subcategory"
                            aria-label="Subcategory"
                            list={`p2p-subs-${t.id}`}
                            disabled={t.linkedTo !== null}
                            onBlur={(e) => {
                              const next = e.target.value.trim() || null;
                              if (next !== sub) updateCategory(t.id, parent, next);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            className="field w-36 disabled:opacity-60"
                          />
                          <datalist id={`p2p-subs-${t.id}`}>
                            {(subcategories.get(parent) ?? []).map((s) => (
                              <option key={s} value={s} />
                            ))}
                          </datalist>
                        </>
                      )}
                      </div>
                      {t.direction === "in" && (
                        <div className="mt-1">
                          <TransactionLinkPicker
                            transactionId={t.id}
                            linkedTo={t.linkedTo}
                            onLinked={load}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
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
      ? "text-pos"
      : tone === "out"
        ? "text-foreground"
        : "";
  return (
    <div className="group-panel px-4 py-3">
      <div className="section-caption">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}
