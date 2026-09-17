"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Category {
  id: string;
  name: string;
  plaidPrimaries: string[];
  transactionCount: number;
  ruleCount: number;
}

export function SettingsCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [primaries, setPrimaries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Set when Escape cancels an edit, so the blur that fires as the input
  // unmounts does not save the draft the user just abandoned.
  const cancelledEdit = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      const json = await res.json();
      setCategories(json.categories);
      setPrimaries(json.primaries);
      setError(null);
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

  const call = async (input: string, init: RequestInit, onOk?: (b: unknown) => void) => {
    setError(null);
    setNotice(null);
    const res = await fetch(input, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        body.transactionCount !== undefined
          ? `Still used by ${body.transactionCount} transaction(s), ${body.ruleCount} rule(s) and ${body.mappingCount} Plaid label(s) — reassign them first.`
          : (body.error ?? "Something went wrong")
      );
      return;
    }
    onOk?.(body);
    await load();
  };

  const rename = (c: Category, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === c.name) return setEditing(null);
    setEditing(null);

    // Whether this rename merges into an existing category is a decision only
    // the server can make correctly — this page's own category list can be
    // stale (another tab may have created a collision since the last load).
    // So the PATCH is sent unconfirmed first; a 409 carrying `merge: true`
    // means the server found a collision and is asking before it moves
    // anything, with counts fresh as of that request.
    const attempt = async (allowMerge: boolean) => {
      setError(null);
      setNotice(null);
      const res = await fetch(`/api/categories/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, allowMerge }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && body.merge) {
          if (
            confirm(
              `Merge "${c.name}" into "${body.targetName}"?\n\n${body.movingTransactions} transaction(s) and ${body.movingRules} rule(s) will move, and "${c.name}" will be removed.`
            )
          ) {
            await attempt(true);
          }
          return;
        }
        // A rename's only other failure shapes are plain { error } — the
        // transactionCount/ruleCount/mappingCount shape is DELETE-only.
        setError(body.error ?? "Something went wrong");
        return;
      }
      const r = body as { merged: boolean; movedTransactions: number };
      setNotice(
        r.merged
          ? `Merged into "${trimmedName}" — ${r.movedTransactions} transaction(s) moved.`
          : `Renamed — ${r.movedTransactions} transaction(s) updated.`
      );
      await load();
    };

    void attempt(false);
  };

  const togglePrimary = (c: Category, primary: string) => {
    const next = c.plaidPrimaries.includes(primary)
      ? c.plaidPrimaries.filter((p) => p !== primary)
      : [...c.plaidPrimaries, primary];
    void call(`/api/categories/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plaidPrimaries: next }),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          Categories — used by the ledger, Rules, Venmo and Zelle. Renaming one onto
          another merges them.
        </p>
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          void call("/api/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: adding.trim() }),
          });
          setAdding("");
        }}
        className="flex gap-2"
      >
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="New category"
          className="w-56 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40"
        />
        <button
          type="submit"
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black"
        >
          Add
        </button>
      </form>

      {loading ? (
        <div className="rounded-lg border border-black/10 px-6 py-16 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-black/50 dark:border-white/10 dark:text-white/50">
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Used by</th>
                <th className="px-4 py-3 font-medium">Plaid labels</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-black/[0.06] align-top last:border-0 dark:border-white/[0.06]"
                >
                  <td className="px-4 py-3 font-medium">
                    {editing === c.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => {
                          if (cancelledEdit.current) {
                            cancelledEdit.current = false;
                            return;
                          }
                          rename(c, draft);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") rename(c, draft);
                          if (e.key === "Escape") {
                            cancelledEdit.current = true;
                            setEditing(null);
                          }
                        }}
                        className="w-44 rounded border border-black/15 bg-white px-1.5 py-1 dark:border-white/20 dark:bg-neutral-900"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(c.id);
                          setDraft(c.name);
                        }}
                        className="hover:underline"
                        title="Rename (renaming onto another category merges them)"
                      >
                        {c.name}
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-black/55 dark:text-white/55">
                    {c.transactionCount} tx · {c.ruleCount} rule
                    {c.ruleCount === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {primaries.map((p) => {
                        const on = c.plaidPrimaries.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => togglePrimary(c, p)}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              on
                                ? "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
                                : "bg-black/[0.04] text-black/35 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-white/35"
                            }`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`Delete "${c.name}"?`)) return;
                        void call(`/api/categories/${c.id}`, { method: "DELETE" });
                      }}
                      className="rounded px-2 py-1 text-xs text-black/50 hover:bg-black/[0.06] dark:text-white/50 dark:hover:bg-white/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
