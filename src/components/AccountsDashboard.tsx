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
      <div className="group-panel px-4 py-3 text-sm text-neg">
        {error}
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="group-panel px-6 py-16 text-center text-sm text-muted2">
        Loading…
      </div>
    );
  }

  // No accounts at all. (summary.accountCount leaves out disconnected banks,
  // whose accounts are still listed below.)
  if (data && data.groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 group-panel px-6 py-16 text-center">
        <p className="text-sm font-medium">No accounts connected</p>
        <p className="mx-auto max-w-md text-sm text-muted2">
          Connect a bank under Settings to import accounts and transactions. In
          sandbox, log in with <span className="font-medium">user_good</span> /{" "}
          <span className="font-medium">pass_good</span>.
        </p>
        <Link
          href="/settings/connections"
          className="btn btn-primary"
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
            className="group-panel"
          >
            <div className="flex items-center justify-between border-b border-line px-[14px] py-2.5">
              <h2>{group.label}</h2>
              <span className="text-sm tabular-nums text-muted2">
                {formatCurrency(
                  group.isLiability ? -group.subtotal : group.subtotal
                )}
              </span>
            </div>
            <div>
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
