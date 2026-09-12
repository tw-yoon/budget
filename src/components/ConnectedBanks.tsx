"use client";

import { useState } from "react";
import type { BankSummary } from "@/types";
import { PlaidLink } from "./PlaidLink";

export function ConnectedBanks({
  banks,
  onChanged,
}: {
  banks: BankSummary[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (banks.length === 0) return null;

  async function disconnect(bank: BankSummary) {
    const ok = confirm(
      `Disconnect ${bank.institution}?\n\nThis removes its ${bank.accountCount} account(s) and their transactions from this app and revokes the Plaid connection. It cannot be undone (you'd reconnect to get the data back).`
    );
    if (!ok) return;
    setBusyId(bank.itemId);
    setError("");
    try {
      const res = await fetch(`/api/plaid/items/${bank.itemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (HTTP ${res.status})`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-2.5 dark:border-white/10">
        <h2 className="text-sm font-semibold">Connected institutions</h2>
        <div className="flex items-center gap-3">
          <PlaidLink label="+ Connect a bank" variant="link" onConnected={onChanged} />
          <PlaidLink
            product="investments"
            label="+ Connect investments"
            variant="link"
            onConnected={onChanged}
          />
        </div>
      </div>
      {error && (
        <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}
      <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {banks.map((bank) => (
          <div
            key={bank.itemId}
            className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium">{bank.institution}</span>
              <span className="ml-2 text-xs text-black/45 dark:text-white/45">
                {bank.accountCount} account{bank.accountCount !== 1 ? "s" : ""} · id …
                {bank.itemId.slice(-6)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <PlaidLink
                itemId={bank.itemId}
                label="Reconnect"
                variant="link"
                onConnected={onChanged}
              />
              <button
                onClick={() => disconnect(bank)}
                disabled={busyId === bank.itemId}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
              >
                {busyId === bank.itemId ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
