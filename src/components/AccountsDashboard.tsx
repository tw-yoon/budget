"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountsResponse } from "@/types";
import { formatCurrency } from "@/lib/format";
import { NetWorthCard } from "./NetWorthCard";
import { AccountCard } from "./AccountCard";
import { PlaidLink } from "./PlaidLink";
import { ConnectedBanks } from "./ConnectedBanks";
import { DebitCards } from "./DebitCards";

export function AccountsDashboard() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-black/10 px-6 py-16 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
        Loading…
      </div>
    );
  }

  if (data && data.summary.accountCount === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-black/10 px-6 py-16 text-center dark:border-white/10">
        <p className="text-sm font-medium">No accounts connected</p>
        <p className="mx-auto max-w-md text-sm text-black/55 dark:text-white/55">
          Connect a bank to import accounts and transactions. In sandbox, log in
          with <span className="font-medium">user_good</span> /{" "}
          <span className="font-medium">pass_good</span>.
        </p>
        <PlaidLink onConnected={load} />
        <PlaidLink
          product="investments"
          label="+ Connect investments (brokerage, 401k, HSA)"
          variant="link"
          onConnected={load}
        />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={`flex flex-col gap-5 ${loading ? "opacity-60 transition-opacity" : ""}`}>
      <NetWorthCard summary={data.summary} onRefreshed={load} />

      <div className="flex flex-col gap-4">
        {data.groups.map((group) => (
          <section
            key={group.type}
            className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
          >
            <div className="flex items-center justify-between border-b border-black/10 px-4 py-2.5 dark:border-white/10">
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <span className="font-mono text-sm tabular-nums text-black/60 dark:text-white/60">
                {formatCurrency(
                  group.isLiability ? -group.subtotal : group.subtotal
                )}
              </span>
            </div>
            <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
              {group.accounts.map((account) => (
                <AccountCard key={account.id} account={account} onChanged={load} />
              ))}
            </div>
          </section>
        ))}
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
