"use client";

import { useState } from "react";
import type { AccountDTO, DebitCardDTO } from "@/types";
import { formatCurrency } from "@/lib/format";

const inputCls =
  "rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-black/40 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/40 dark:focus:border-white/40";

export function DebitCards({
  debitCards,
  checkingAccounts,
  onChanged,
}: {
  debitCards: DebitCardDTO[];
  checkingAccounts: AccountDTO[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-2.5 dark:border-white/10">
        <h2 className="text-sm font-semibold">Debit cards</h2>
        {!adding && checkingAccounts.length > 0 && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            + Add debit card
          </button>
        )}
      </div>

      {debitCards.length === 0 && !adding ? (
        <p className="px-4 py-4 text-sm text-black/45 dark:text-white/45">
          {checkingAccounts.length === 0
            ? "Connect a checking account first, then add the debit card linked to it."
            : "No debit cards yet."}
        </p>
      ) : (
        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {debitCards.map((card) => (
            <Row key={card.id} card={card} onChanged={onChanged} />
          ))}
        </div>
      )}

      {adding && (
        <AddForm
          accounts={checkingAccounts}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function Row({ card, onChanged }: { card: DebitCardDTO; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!confirm(`Remove debit card ${card.name} ··${card.last4}?`)) return;
    setBusy(true);
    await fetch(`/api/debit-cards/${card.id}`, { method: "DELETE" });
    onChanged();
  }
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{card.name}</span>
        <span className="ml-2 text-xs text-black/45 dark:text-white/45">
          ··{card.last4} · draws from {card.accountName}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {card.available != null && (
          <span className="font-mono text-xs tabular-nums text-black/55 dark:text-white/55">
            {formatCurrency(card.available)} available
          </span>
        )}
        <button
          onClick={remove}
          disabled={busy}
          className="text-xs text-black/40 hover:text-red-600 disabled:opacity-50 dark:text-white/40 dark:hover:text-red-400"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function AddForm({
  accounts,
  onDone,
  onCancel,
}: {
  accounts: AccountDTO[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/debit-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, last4, accountId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to add debit card");
      return;
    }
    onDone();
  }

  return (
    <form
      onSubmit={submit}
      className="border-t border-black/10 bg-black/[0.015] px-4 py-3 dark:border-white/10 dark:bg-white/[0.02]"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Card name (e.g. Chase Debit)"
          required
          className={inputCls}
        />
        <input
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="Last 4 digits"
          inputMode="numeric"
          required
          className={inputCls}
        />
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className={inputCls}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName ?? a.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2.5 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add debit card"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.04]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
