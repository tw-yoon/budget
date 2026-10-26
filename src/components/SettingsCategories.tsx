"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { humanizePfc } from "@/lib/format";
import { CategoryMap } from "@/components/CategoryMap";

interface Category {
  id: string;
  name: string;
  plaidPrimaries: string[];
  transactionCount: number;
  ruleCount: number;
  resolvedTransactionCount: number;
  subcategories: Subcategory[];
  splitCount: number;
}

interface Subcategory {
  name: string;
  declared: boolean;
  transactionCount: number;
  ruleCount: number;
  plaidLabels: { code: string; name: string }[];
  plaidTransactionCount: number;
  renamed: boolean;
}

interface UnmappedPrimary {
  pfcPrimary: string;
  transactionCount: number;
  examples?: { name: string; amount: number }[];
}

/** The `editing` key for a subcategory — category ids never contain a colon. */
const subKey = (categoryId: string, name: string) => `${categoryId}:${name}`;

/** Nothing but renamed Plaid labels, so deleting it only resets their names. */
const isResetOnly = (s: Subcategory) =>
  s.renamed && !s.declared && s.transactionCount + s.ruleCount === 0;

/**
 * Whether there is anything to delete. A Plaid label under Plaid's own name
 * is Plaid's — it can be renamed, not removed.
 */
const isDeletable = (s: Subcategory) =>
  s.declared || s.renamed || s.transactionCount + s.ruleCount > 0;

export function SettingsCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [primaries, setPrimaries] = useState<string[]>([]);
  const [unmappedPrimaries, setUnmappedPrimaries] = useState<UnmappedPrimary[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "map">("list");
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
          ? `Still used by ${body.transactionCount} transaction(s), ${body.ruleCount} rule(s), ${body.mappingCount} Plaid label(s) and ${body.splitCount} split(s) — rename this category onto another one to merge them first.`
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
          // movingResolved already contains movingTransactions (it is the same
          // direct count plus the Plaid-fallthrough group), so headlining it
          // loses nothing. movingSplits is disjoint from that figure — a
          // split-only category would otherwise read as "0 transactions" and
          // approving the merge would silently relabel every carve-out.
          const splitsNote = body.movingSplits ? ` and ${body.movingSplits} split(s)` : "";
          if (
            confirm(
              `Merge "${c.name}" into "${body.targetName}"?\n\n${body.movingResolved} transaction(s)${splitsNote} will report as "${body.targetName}" instead, and "${c.name}" will be removed.`
            )
          ) {
            await attempt(true);
          }
          return;
        }
        // A rename's only other failure shapes are plain { error } — the
        // transactionCount/ruleCount/mappingCount/splitCount shape is DELETE-only.
        setError(body.error ?? "Something went wrong");
        return;
      }
      const r = body as { merged: boolean; movedTransactions: number; movedSplits: number };
      const movedSplitsNote = r.movedSplits ? ` and ${r.movedSplits} split(s)` : "";
      setNotice(
        r.merged
          ? `Merged into "${trimmedName}" — ${r.movedTransactions} transaction(s)${movedSplitsNote} moved.`
          : `Renamed — ${r.movedTransactions} transaction(s)${movedSplitsNote} updated.`
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
      const r = body as {
        merged: boolean;
        movedTransactions: number;
        movedSplits: number;
      };
      const movedSplitsNote = r.movedSplits ? ` and ${r.movedSplits} split(s)` : "";
      setNotice(
        r.merged
          ? `Merged into "${to}" — ${r.movedTransactions} transaction(s)${movedSplitsNote} moved.`
          : `Renamed — ${r.movedTransactions} transaction(s)${movedSplitsNote} updated.`
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
    // Resetting renamed Plaid labels loses nothing, so it needs no warning.
    if (
      !isResetOnly(s) &&
      !confirm(
        `Delete "${c.name} > ${s.name}"?` +
          (inUse
            ? `\n\n${s.transactionCount} transaction(s) and ${s.ruleCount} rule(s) using it will fall back to "${c.name}".`
            : "") +
          (s.renamed ? `\n\nPlaid labels renamed to "${s.name}" go back to Plaid's name.` : "")
      )
    ) {
      return;
    }
    void call(
      `/api/categories/${c.id}/subcategories?name=${encodeURIComponent(s.name)}`,
      { method: "DELETE" },
      (b) => {
        const r = b as {
          movedTransactions: number;
          movedSplits: number;
          resetPlaidLabels: number;
        };
        const splitNote = r.movedSplits ? ` and ${r.movedSplits} split(s)` : "";
        if (r.movedTransactions || r.movedSplits)
          setNotice(
            `Deleted — ${r.movedTransactions} transaction(s)${splitNote} moved back to "${c.name}".`
          );
        else if (r.resetPlaidLabels) setNotice("Back to Plaid's name.");
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

  const unmappedSet = new Set(unmappedPrimaries.map((u) => u.pfcPrimary));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1>Categories</h1>
        <p className="text-sm text-muted2">
          Used by the ledger, Rules, Venmo and Zelle. Renaming one onto
          another merges them. Subcategories roll up into their category in
          Analytics. Plaid&rsquo;s own subcategories are listed too — rename
          one to change what uncategorized transactions show.
        </p>
      </header>

      {notice && (
        <div className="rounded-xl bg-pos/10 px-4 py-3 text-sm text-pos">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-neg/10 px-4 py-3 text-sm text-neg">
          {error}
        </div>
      )}

      {unmappedPrimaries.length > 0 && (
        <div className="rounded-xl bg-warn/10 px-4 py-3 text-sm">
          <p className="font-medium">
            {unmappedPrimaries.length} Plaid label
            {unmappedPrimaries.length === 1 ? "" : "s"} not mapped to a category:{" "}
            {unmappedPrimaries
              .map((u) => `${humanizePfc(u.pfcPrimary)} (${u.transactionCount})`)
              .join(", ")}
            .
          </p>
          <p className="mt-1 text-muted2">
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
          className="field w-56 py-2 text-sm"
        />
        <button
          type="submit"
          className="btn btn-primary py-2"
        >
          Add
        </button>
        <div className="ml-auto flex rounded-lg bg-panel2 p-0.5 text-sm">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 capitalize ${
                view === v ? "bg-panel font-medium shadow-sm" : "text-muted2"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </form>

      {/* Only the first load blanks the table: a reload after an edit keeps
          the rows (and the scroll position) in place. */}
      {view === "map" && categories.length > 0 ? (
        <CategoryMap
          categories={categories}
          primaries={primaries}
          unmapped={unmappedPrimaries}
          onToggle={(id, p) => {
            const c = categories.find((x) => x.id === id);
            if (c) togglePrimary(c, p);
          }}
        />
      ) : loading && categories.length === 0 ? (
        <div className="group-panel px-6 py-16 text-center text-sm text-muted2">
          Loading…
        </div>
      ) : (
        <div className="group-panel">
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="section-caption border-b-[0.5px] border-line text-left">
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
                  className="border-b-[0.5px] border-line last:border-0"
                >
                <tr className="align-top">
                  <td className="min-w-40 px-4 py-3 font-medium">
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
                        className="field w-44 px-1.5 py-1"
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
                  <td className="whitespace-nowrap px-4 py-3 text-muted2">
                    {c.resolvedTransactionCount} tx
                    {c.resolvedTransactionCount !== c.transactionCount && (
                      <span className="text-dim2">
                        {" "}
                        ({c.transactionCount} direct)
                      </span>
                    )}{" "}
                    · {c.ruleCount} rule
                    {c.ruleCount === 1 ? "" : "s"} · {c.splitCount} split
                    {c.splitCount === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {primaries.map((p) => {
                        const on = c.plaidPrimaries.includes(p);
                        const unmapped = unmappedSet.has(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => togglePrimary(c, p)}
                            title={unmapped ? "Not mapped to any category — click to map it here" : undefined}
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                              on
                                ? "bg-accent/15 text-accent"
                                : unmapped
                                ? "bg-warn/10 text-warn ring-1 ring-warn hover:bg-warn/20"
                                : "bg-panel2 text-dim2 hover:text-muted2"
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
                      className="btn px-2 py-1 text-xs"
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
                      className={`btn px-2 py-1 text-xs ${isReserved ? "" : "text-neg"}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {c.subcategories.map((sub) => {
                  const key = subKey(c.id, sub.name);
                  return (
                    <tr key={key} className="align-top">
                      <td className="py-1.5 pl-8 pr-4 text-muted2">
                        <div className="flex items-start gap-1.5">
                        <span className="text-dim2">↳</span>
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
                            className="field w-40 px-1.5 py-0.5"
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
                        {sub.plaidLabels.length > 0 && (
                          <span
                            className="chip mt-0.5"
                            title={`Plaid: ${sub.plaidLabels.map((l) => l.code).join(", ")}`}
                          >
                            {sub.renamed
                              ? `Plaid: ${sub.plaidLabels.map((l) => l.name).join(", ")}`
                              : "Plaid"}
                          </span>
                        )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-muted2">
                        {sub.transactionCount + sub.plaidTransactionCount} tx
                        {sub.plaidTransactionCount > 0 && sub.transactionCount > 0 && (
                          <span className="text-dim2">
                            {" "}
                            ({sub.transactionCount} direct)
                          </span>
                        )}{" "}
                        · {sub.ruleCount} rule
                        {sub.ruleCount === 1 ? "" : "s"}
                      </td>
                      <td />
                      <td className="px-4 py-1.5 text-right">
                        {isDeletable(sub) && (
                          <button
                            type="button"
                            onClick={() => deleteSub(c, sub)}
                            title={isResetOnly(sub) ? "Go back to Plaid's name" : undefined}
                            className="btn px-2 py-1 text-xs text-neg"
                          >
                            {isResetOnly(sub) ? "Reset" : "Delete"}
                          </button>
                        )}
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
                        <span className="text-dim2">↳</span>
                        <input
                          autoFocus
                          value={subDraft}
                          onChange={(e) => setSubDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setAddingSubTo(null);
                          }}
                          placeholder={`New subcategory of ${c.name}`}
                          className="field w-56 px-2 py-1 text-sm"
                        />
                        <button
                          type="submit"
                          className="btn btn-primary px-2.5 py-1 text-xs"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingSubTo(null)}
                          className="btn px-2 py-1 text-xs"
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
        </div>
      )}
    </div>
  );
}
