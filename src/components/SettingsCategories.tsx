"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { humanizePfc } from "@/lib/format";

interface Category {
  id: string;
  name: string;
  plaidPrimaries: string[];
  transactionCount: number;
  ruleCount: number;
  resolvedTransactionCount: number;
  subcategories: Subcategory[];
}

interface Subcategory {
  name: string;
  declared: boolean;
  transactionCount: number;
  ruleCount: number;
}

interface UnmappedPrimary {
  pfcPrimary: string;
  transactionCount: number;
}

/** The `editing` key for a subcategory — category ids never contain a colon. */
const subKey = (categoryId: string, name: string) => `${categoryId}:${name}`;

export function SettingsCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [primaries, setPrimaries] = useState<string[]>([]);
  const [unmappedPrimaries, setUnmappedPrimaries] = useState<UnmappedPrimary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  // A category id, or subKey() for a subcategory.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // The category whose "add subcategory" input is open.
  const [addingSubTo, setAddingSubTo] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState("");
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
      setUnmappedPrimaries(json.unmappedPrimaries ?? []);
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
          ? `Still used by ${body.transactionCount} transaction(s), ${body.ruleCount} rule(s) and ${body.mappingCount} Plaid label(s) — rename this category onto another one to merge them first.`
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
              `Merge "${c.name}" into "${body.targetName}"?\n\n${body.movingResolved} transaction(s) will report as "${body.targetName}" instead, and "${c.name}" will be removed.`
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

  const renameSub = (c: Category, s: Subcategory, name: string) => {
    const to = name.trim();
    setEditing(null);
    if (!to || to === s.name) return;

    // Same handshake as a category rename: whether `to` already exists under
    // this category is the server's call, and a 409 with `merge: true` asks.
    const attempt = async (allowMerge: boolean) => {
      setError(null);
      setNotice(null);
      const res = await fetch(`/api/categories/${c.id}/subcategories`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: s.name, to, allowMerge }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && body.merge) {
          if (
            confirm(
              `Merge "${s.name}" into "${body.targetName}"?\n\n${body.movingTransactions} transaction(s) and ${body.movingRules} rule(s) will move to "${c.name} > ${body.targetName}".`
            )
          ) {
            await attempt(true);
          }
          return;
        }
        setError(body.error ?? "Something went wrong");
        return;
      }
      const r = body as { merged: boolean; movedTransactions: number };
      setNotice(
        r.merged
          ? `Merged into "${to}" — ${r.movedTransactions} transaction(s) moved.`
          : `Renamed — ${r.movedTransactions} transaction(s) updated.`
      );
      await load();
    };

    void attempt(false);
  };

  const addSub = (c: Category) => {
    const name = subDraft.trim();
    if (!name) return;
    setAddingSubTo(null);
    setSubDraft("");
    void call(`/api/categories/${c.id}/subcategories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };

  const deleteSub = (c: Category, s: Subcategory) => {
    const inUse = s.transactionCount + s.ruleCount > 0;
    if (
      !confirm(
        `Delete "${c.name} > ${s.name}"?` +
          (inUse
            ? `\n\n${s.transactionCount} transaction(s) and ${s.ruleCount} rule(s) using it will fall back to "${c.name}".`
            : "")
      )
    ) {
      return;
    }
    void call(
      `/api/categories/${c.id}/subcategories?name=${encodeURIComponent(s.name)}`,
      { method: "DELETE" },
      (b) => {
        const moved = (b as { movedTransactions: number }).movedTransactions;
        if (moved) setNotice(`Deleted — ${moved} transaction(s) moved back to "${c.name}".`);
      }
    );
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
        <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          Used by the ledger, Rules, Venmo and Zelle. Renaming one onto
          another merges them. Subcategories roll up into their category in
          Analytics.
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

      {unmappedPrimaries.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          <p className="font-medium">
            {unmappedPrimaries.length} Plaid label
            {unmappedPrimaries.length === 1 ? "" : "s"} not mapped to a category:{" "}
            {unmappedPrimaries
              .map((u) => `${humanizePfc(u.pfcPrimary)} (${u.transactionCount})`)
              .join(", ")}
            .
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-400/80">
            Those transactions report under Plaid&rsquo;s own wording instead of one of your
            categories, and won&rsquo;t follow if you rename a category later.
          </p>
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

      {/* Only the first load blanks the table: a reload after an edit keeps
          the rows (and the scroll position) in place. */}
      {loading && categories.length === 0 ? (
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
            {/* One <tbody> per category, so a category and its subcategory
                rows share a single border below them. */}
            {categories.map((c) => {
                const isReserved = c.name === "Transfer";
                return (
                <tbody
                  key={c.id}
                  className="border-b border-black/[0.06] last:border-0 dark:border-white/[0.06]"
                >
                <tr className="align-top">
                  <td className="px-4 py-3 font-medium">
                    {isReserved ? (
                      <span
                        title='"Transfer" controls how transactions are excluded from spending — it cannot be renamed or deleted'
                      >
                        {c.name}
                      </span>
                    ) : editing === c.id ? (
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
                          if (e.key === "Enter") {
                            // rename() unmounts this input, and that unmount
                            // fires blur — without this the save would run
                            // twice, and on a merge the second attempt hits the
                            // just-deleted row and reports a false failure.
                            cancelledEdit.current = true;
                            rename(c, draft);
                          }
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
                        // text-left because a <button> centres its text by
                        // default, which only shows on names long enough to
                        // wrap — they sat centred while their neighbours
                        // stayed flush left.
                        className="text-left hover:underline"
                        title="Rename (renaming onto another category merges them)"
                      >
                        {c.name}
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-black/55 dark:text-white/55">
                    {c.resolvedTransactionCount} tx
                    {c.resolvedTransactionCount !== c.transactionCount && (
                      <span className="text-black/35 dark:text-white/35">
                        {" "}
                        ({c.transactionCount} direct)
                      </span>
                    )}{" "}
                    · {c.ruleCount} rule
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
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setAddingSubTo(c.id);
                        setSubDraft("");
                      }}
                      className="rounded px-2 py-1 text-xs text-black/50 hover:bg-black/[0.06] dark:text-white/50 dark:hover:bg-white/10"
                    >
                      Add sub
                    </button>
                    <button
                      type="button"
                      disabled={isReserved}
                      onClick={() => {
                        const declared = c.subcategories.filter((sub) => sub.declared).length;
                        const also = declared
                          ? ` Its ${declared} subcategor${declared === 1 ? "y" : "ies"} will go too.`
                          : "";
                        if (!confirm(`Delete "${c.name}"?${also}`)) return;
                        void call(`/api/categories/${c.id}`, { method: "DELETE" });
                      }}
                      title={
                        isReserved
                          ? '"Transfer" controls how transactions are excluded from spending — it cannot be renamed or deleted'
                          : undefined
                      }
                      className="rounded px-2 py-1 text-xs text-black/50 hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-white/50 dark:hover:bg-white/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {c.subcategories.map((sub) => {
                  const key = subKey(c.id, sub.name);
                  return (
                    <tr key={key} className="align-top">
                      <td className="py-1.5 pl-8 pr-4 text-black/70 dark:text-white/70">
                        <div className="flex items-start gap-1.5">
                        <span className="text-black/25 dark:text-white/25">↳</span>
                        {editing === key ? (
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => {
                              if (cancelledEdit.current) {
                                cancelledEdit.current = false;
                                return;
                              }
                              renameSub(c, sub, draft);
                            }}
                            onKeyDown={(e) => {
                              // Same double-save guard as the category input.
                              if (e.key === "Enter") {
                                cancelledEdit.current = true;
                                renameSub(c, sub, draft);
                              }
                              if (e.key === "Escape") {
                                cancelledEdit.current = true;
                                setEditing(null);
                              }
                            }}
                            className="w-40 rounded border border-black/15 bg-white px-1.5 py-0.5 dark:border-white/20 dark:bg-neutral-900"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(key);
                              setDraft(sub.name);
                            }}
                            className="text-left hover:underline"
                            title="Rename (renaming onto another subcategory merges them)"
                          >
                            {sub.name}
                          </button>
                        )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-black/55 dark:text-white/55">
                        {sub.transactionCount} tx · {sub.ruleCount} rule
                        {sub.ruleCount === 1 ? "" : "s"}
                      </td>
                      <td />
                      <td className="px-4 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => deleteSub(c, sub)}
                          className="rounded px-2 py-1 text-xs text-black/50 hover:bg-black/[0.06] dark:text-white/50 dark:hover:bg-white/10"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {addingSubTo === c.id && (
                  <tr>
                    <td colSpan={4} className="py-1.5 pb-3 pl-8 pr-4">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          addSub(c);
                        }}
                        className="flex items-center gap-2"
                      >
                        <span className="text-black/25 dark:text-white/25">↳</span>
                        <input
                          autoFocus
                          value={subDraft}
                          onChange={(e) => setSubDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setAddingSubTo(null);
                          }}
                          placeholder={`New subcategory of ${c.name}`}
                          className="w-56 rounded border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-neutral-900"
                        />
                        <button
                          type="submit"
                          className="rounded bg-black px-2.5 py-1 text-xs font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingSubTo(null)}
                          className="rounded px-2 py-1 text-xs text-black/50 hover:bg-black/[0.06] dark:text-white/50 dark:hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </form>
                    </td>
                  </tr>
                )}
                </tbody>
                );
              })}
          </table>
        </div>
      )}
    </div>
  );
}
