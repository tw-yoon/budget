"use client";

import { useState } from "react";
import type { BankSummary } from "@/types";
import { deleteConfirm, disconnectConfirm } from "@/lib/bank-actions";
import { formatDate } from "@/lib/format";
import { PlaidLink } from "./PlaidLink";
import { MergeReview } from "./MergeReview";

type Action = "disconnect" | "delete";

export function ConnectedBanks({
  banks,
  onChanged,
}: {
  banks: BankSummary[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<{ itemId: string; action: Action } | null>(null);
  const [error, setError] = useState("");
  // The open reconnect-merge review, if any.
  const [review, setReview] = useState<{ from: string; into: string } | null>(null);

  if (banks.length === 0) return null;

  // Disconnect keeps the bank's history; Delete removes it (and, on a
  // connected bank, disconnects it in the same step).
  async function run(bank: BankSummary, action: Action) {
    const { title, message } =
      action === "disconnect" ? disconnectConfirm(bank) : deleteConfirm(bank);
    if (!confirm(`${title}\n\n${message}`)) return;
    setBusy({ itemId: bank.itemId, action });
    setError("");
    try {
      const url =
        action === "disconnect"
          ? `/api/plaid/items/${bank.itemId}`
          : `/api/plaid/items/${bank.itemId}/history`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (HTTP ${res.status})`);
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : action === "disconnect"
            ? "Failed to disconnect"
            : "Failed to delete"
      );
    } finally {
      setBusy(null);
    }
  }

  const isBusy = (bank: BankSummary, action: Action) =>
    busy?.itemId === bank.itemId && busy.action === action;

  return (
    <section className="group-panel">
      <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-line px-4 py-2.5">
        <h2>Connected institutions</h2>
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
        <div className="px-4 py-2 text-sm text-neg">{error}</div>
      )}
      <div>
        {banks.map((bank) => (
          <div
            key={bank.itemId}
            className="group-row flex items-center justify-between gap-4 text-sm"
          >
            <div className="min-w-0">
              <span className={`font-medium ${bank.disconnectedAt ? "opacity-50" : ""}`}>
                {bank.institution}
              </span>
              <span className="ml-2 text-xs text-dim2">
                {bank.disconnectedAt && (
                  <>Disconnected {formatDate(bank.disconnectedAt)} · </>
                )}
                {bank.accountCount} account{bank.accountCount !== 1 ? "s" : ""} · id …
                {bank.itemId.slice(-6)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {bank.mergeInto.map((target) => (
                <button
                  key={target.itemId}
                  onClick={() => setReview({ from: bank.itemId, into: target.itemId })}
                  disabled={busy?.itemId === bank.itemId}
                  className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                >
                  Merge into {target.institution}
                  {bank.mergeInto.length > 1 && ` …${target.itemId.slice(-6)}`}…
                </button>
              ))}
              {bank.mergedFrom.map((source) => (
                <button
                  key={source.itemId}
                  onClick={() => setReview({ from: source.itemId, into: bank.itemId })}
                  title={`Merged from the disconnected ${source.institution} on ${formatDate(source.mergedAt)}`}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Review duplicates…
                </button>
              ))}
              {!bank.disconnectedAt && (
                <>
                  <PlaidLink
                    itemId={bank.itemId}
                    label="Reconnect"
                    variant="link"
                    onConnected={onChanged}
                  />
                  <button
                    onClick={() => run(bank, "disconnect")}
                    disabled={busy?.itemId === bank.itemId}
                    className="btn text-neg"
                  >
                    {isBusy(bank, "disconnect") ? "Disconnecting…" : "Disconnect"}
                  </button>
                </>
              )}
              <button
                onClick={() => run(bank, "delete")}
                disabled={busy?.itemId === bank.itemId}
                className="btn text-neg"
              >
                {isBusy(bank, "delete")
                  ? "Deleting…"
                  : bank.disconnectedAt
                    ? "Delete History…"
                    : "Delete…"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {review && (
        <div className="border-t-[0.5px] border-line p-3">
          <MergeReview
            key={`${review.from}|${review.into}`}
            fromItemId={review.from}
            intoItemId={review.into}
            onClose={() => setReview(null)}
            onMerged={onChanged}
          />
        </div>
      )}
    </section>
  );
}
