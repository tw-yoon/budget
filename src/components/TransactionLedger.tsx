"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountGroup, AccountsResponse, TransactionsResponse } from "@/types";
import {
  TransactionTable,
  type SortColumn,
  type SortDir,
} from "./TransactionTable";
import { SyncButton } from "./SyncButton";

const PAGE_SIZE = 50;
const VIEW_KEY = "ledger-view";

export function TransactionLedger() {
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [hideInternal, setHideInternal] = useState(true);
  // Phrased as "show", so the unticked default is the quiet ledger: a
  // connected payment is the child side of a link, and its parent already
  // lists it and nets it out. Ticking the box brings the children back.
  const [showLinked, setShowLinked] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortColumn>("date");
  const [dir, setDir] = useState<SortDir>("desc");
  const [categories, setCategories] = useState<string[]>([]);
  // Category name -> its subcategories, declared or in use.
  const [subcategories, setSubcategories] = useState<Map<string, string[]>>(new Map());
  // Compact by default; this browser's last choice overrides on mount.
  const [view, setView] = useState<"compact" | "detailed">("compact");

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(VIEW_KEY) === "detailed") setView("detailed");
    } catch {}
  }, []);

  const chooseView = (v: "compact" | "detailed") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  // Load accounts once for the payment-account filter. If it fails the
  // dropdown just stays on "All accounts".
  useEffect(() => {
    let cancelled = false;
    fetch("/api/accounts")
      .then((res) => (res.ok ? (res.json() as Promise<AccountsResponse>) : null))
      .then((json) => {
        if (json && !cancelled) setAccountGroups(json.groups);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The editable category list, for the row editor's picker.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && !cancelled) {
          const cats = json.categories as { name: string; subcategories: { name: string }[] }[];
          setCategories(cats.map((c) => c.name));
          setSubcategories(
            new Map(cats.map((c) => [c.name, c.subcategories.map((s) => s.name)]))
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the search box so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        hideInternal: String(hideInternal),
        hideLinked: String(!showLinked),
        sort,
        dir,
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (accountId) params.set("accountId", accountId);

      const res = await fetch(`/api/transactions?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      setData((await res.json()) as TransactionsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, hideInternal, showLinked, debouncedSearch, accountId, sort, dir]);

  useEffect(() => {
    // Intentional data-fetch effect: refetch whenever page/filters change.
    // `load` flips loading state synchronously, which set-state-in-effect
    // flags — expected and fine for a fetch-on-change effect like this.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Server-side sort over a paged list: a change has to return to page 1, or
  // you land on page 7 of a completely different ordering.
  const handleSort = (column: SortColumn) => {
    if (column === sort) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(column);
      setDir("desc");
    }
    setPage(1);
  };

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const selectedAccount = accountId
    ? accountGroups.flatMap((g) => g.accounts).find((a) => a.id === accountId)
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1>Transactions</h1>
          <p className="text-sm text-muted2">
            {total} {total === 1 ? "entry" : "entries"}
            {selectedAccount && ` · ${selectedAccount.displayName ?? selectedAccount.name}`}
            {hideInternal && " · transfers & fees hidden"}
            {!showLinked && " · connected payments hidden"}
          </p>
        </div>
        <SyncButton onSynced={load} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, amount, date, note…"
          className="field w-full max-w-xs"
        />
        <select
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            setPage(1);
          }}
          className="field max-w-56"
        >
          <option value="">All accounts</option>
          {accountGroups.map((g) => (
            <optgroup key={g.type} label={g.label}>
              {g.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName ?? a.name}
                  {a.mask ? ` ····${a.mask}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted2">
          <input
            type="checkbox"
            checked={hideInternal}
            onChange={(e) => {
              setHideInternal(e.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 accent-current"
          />
          Hide transfers &amp; fees
        </label>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted2">
          <input
            type="checkbox"
            checked={showLinked}
            onChange={(e) => {
              setShowLinked(e.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 accent-current"
          />
          Show connected payments
        </label>
        <div className="ml-auto flex rounded-lg bg-panel2 p-0.5 text-sm">
          {(["compact", "detailed"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => chooseView(v)}
              aria-pressed={view === v}
              className={`rounded-md px-3 py-1.5 capitalize ${
                view === v ? "bg-panel font-medium shadow-sm" : "text-muted2"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="group-panel px-4 py-3 text-sm text-neg">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="group-panel px-6 py-16 text-center text-sm text-muted2">
          Loading…
        </div>
      ) : (
        <>
          <div className={loading ? "opacity-60 transition-opacity" : ""}>
            <TransactionTable
              transactions={data?.transactions ?? []}
              onChanged={load}
              categories={categories}
              subcategories={subcategories}
              detailed={view === "detailed"}
              sort={sort}
              dir={dir}
              onSort={handleSort}
            />
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 text-sm">
              {/* First/Last drop their words on a phone so all four buttons
                  fit beside the page count. */}
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                  aria-label="First page"
                  className="btn whitespace-nowrap disabled:opacity-40"
                >
                  «<span className="hidden sm:inline"> First</span>
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn whitespace-nowrap disabled:opacity-40"
                >
                  ← Previous
                </button>
              </div>
              <span className="text-center text-muted2">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="btn whitespace-nowrap disabled:opacity-40"
                >
                  Next →
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  aria-label="Last page"
                  className="btn whitespace-nowrap disabled:opacity-40"
                >
                  <span className="hidden sm:inline">Last </span>»
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
