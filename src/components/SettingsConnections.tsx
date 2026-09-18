"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountsResponse } from "@/types";
import { PlaidLink } from "./PlaidLink";
import { ConnectedBanks } from "./ConnectedBanks";
import { DebitCards } from "./DebitCards";

export function SettingsConnections() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Same endpoint Accounts reads: the response already carries `banks` and
  // `debitCards`, so administering connections needs no endpoint of its own.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      setData((await res.json()) as AccountsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional data-fetch effect on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-black/10 px-4 py-6 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
        Loading…
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-5 ${loading ? "opacity-60 transition-opacity" : ""}`}
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          Banks and debit cards. Accounts and transactions import from whatever
          is connected here.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <PlaidLink onConnected={load} />
        <PlaidLink
          product="investments"
          label="+ Connect investments (brokerage, 401k, HSA)"
          variant="link"
          onConnected={load}
        />
      </div>

      <DebitCards
        debitCards={data.debitCards}
        checkingAccounts={
          data.groups.find((g) => g.type === "DEPOSITORY")?.accounts ?? []
        }
        onChanged={load}
      />

      <ConnectedBanks banks={data.banks} onChanged={load} />
    </div>
  );
}
