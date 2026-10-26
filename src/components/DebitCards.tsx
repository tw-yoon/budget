"use client";

import { useState } from "react";
import type { AccountDTO, DebitCardDTO } from "@/types";
import { formatCurrency } from "@/lib/format";

const inputCls = "field text-sm placeholder:text-dim2";

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
    <section className="group-panel">
      <div className="flex items-center justify-between border-b-[0.5px] border-line px-4 py-2.5">
        <h2>Debit cards</h2>
        {!adding && checkingAccounts.length > 0 && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-medium text-accent hover:underline"
          >
            + Add debit card
          </button>
        )}
      </div>

      {debitCards.length === 0 && !adding ? (
        <p className="px-4 py-4 text-sm text-dim2">
          {checkingAccounts.length === 0
            ? "Connect a checking account first, then add the debit card linked to it."
            : "No debit cards yet."}
        </p>
      ) : (
        <div>
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
    <div className="group-row flex items-center justify-between gap-4 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{card.name}</span>
        <span className="ml-2 text-xs text-dim2">
          ··{card.last4} · draws from {card.accountName}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {card.available != null && (
          <span className="text-xs tabular-nums text-muted2">
            {formatCurrency(card.available)} available
          </span>
        )}
        <button
          onClick={remove}
          disabled={busy}
          className="btn text-neg"
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
      className="border-t-[0.5px] border-line px-4 py-3"
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
      {error && <p className="mt-2 text-sm text-neg">{error}</p>}
      <div className="mt-2.5 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary"
        >
          {busy ? "Adding…" : "Add debit card"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
