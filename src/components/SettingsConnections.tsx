"use client";

import { PlaidLink } from "./PlaidLink";
import { ConnectedBanks } from "./ConnectedBanks";
import { DebitCards } from "./DebitCards";
import { useAccountsData } from "./useAccountsData";

export function SettingsConnections() {
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
      <div className="rounded-lg border border-black/10 px-4 py-6 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
        Loading…
      </div>
    );
  }

  if (!data) return null;

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

      {data.banks.length === 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <PlaidLink onConnected={reload} />
          <PlaidLink
            product="investments"
            label="+ Connect investments (brokerage, 401k, HSA)"
            variant="link"
            onConnected={reload}
          />
        </div>
      )}

      <DebitCards
        debitCards={data.debitCards}
        checkingAccounts={
          data.groups.find((g) => g.type === "DEPOSITORY")?.accounts ?? []
        }
        onChanged={reload}
      />

      <ConnectedBanks banks={data.banks} onChanged={reload} />
    </div>
  );
}
