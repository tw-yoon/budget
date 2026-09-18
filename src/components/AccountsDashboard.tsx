"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { NetWorthCard } from "./NetWorthCard";
import { AccountCard } from "./AccountCard";
import { useAccountsData } from "./useAccountsData";

export function AccountsDashboard() {
  const { data, loading, error, reload } = useAccountsData();

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
          Connect a bank under Settings to import accounts and transactions. In
          sandbox, log in with <span className="font-medium">user_good</span> /{" "}
          <span className="font-medium">pass_good</span>.
        </p>
        <Link
          href="/settings/connections"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Connect a bank
        </Link>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={`flex flex-col gap-5 ${loading ? "opacity-60 transition-opacity" : ""}`}>
      <NetWorthCard summary={data.summary} onRefreshed={reload} />

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
                <AccountCard key={account.id} account={account} onChanged={reload} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
