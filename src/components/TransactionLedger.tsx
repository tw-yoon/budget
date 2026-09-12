"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountGroup, AccountsResponse, TransactionsResponse } from "@/types";
import { TransactionTable } from "./TransactionTable";
import { SyncButton } from "./SyncButton";

const PAGE_SIZE = 50;

export function TransactionLedger() {
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [hideInternal, setHideInternal] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [page, setPage] = useState(1);

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
  }, [page, hideInternal, debouncedSearch, accountId]);

  useEffect(() => {
    // Intentional data-fetch effect: refetch whenever page/filters change.
    // `load` flips loading state synchronously, which set-state-in-effect
    // flags — expected and fine for a fetch-on-change effect like this.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const selectedAccount = accountId
    ? accountGroups.flatMap((g) => g.accounts).find((a) => a.id === accountId)
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-black/55 dark:text-white/55">
            {total} {total === 1 ? "entry" : "entries"}
            {selectedAccount && ` · ${selectedAccount.displayName ?? selectedAccount.name}`}
            {hideInternal && " · transfers & fees hidden"}
          </p>
        </div>
        <SyncButton onSynced={load} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description or merchant…"
          className="w-full max-w-xs rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-black/40 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/40 dark:focus:border-white/40"
        />
        <select
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            setPage(1);
          }}
          className="max-w-56 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/15 dark:bg-transparent dark:focus:border-white/40 [&>*]:bg-white dark:[&>*]:bg-neutral-900"
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
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-black/70 dark:text-white/70">
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
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="rounded-lg border border-black/10 px-6 py-16 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : (
        <>
          <div className={loading ? "opacity-60 transition-opacity" : ""}>
            <TransactionTable transactions={data?.transactions ?? []} />
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border border-black/15 px-3 py-1.5 disabled:opacity-40 dark:border-white/15"
              >
                ← Previous
              </button>
              <span className="text-black/55 dark:text-white/55">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-black/15 px-3 py-1.5 disabled:opacity-40 dark:border-white/15"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
