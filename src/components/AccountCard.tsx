"use client";

import { useState } from "react";
import type { AccountDTO } from "@/types";
import {
  formatCurrency,
  formatDate,
  daysUntil,
  nextMonthlyOccurrence,
} from "@/lib/format";

export function AccountCard({
  account,
  onChanged,
}: {
  account: AccountDTO;
  onChanged: () => void;
}) {
  const availableLabel = account.isLiability ? "Available credit" : "Available";
  const payment = paymentStatus(account);
  const isCredit = account.type === "CREDIT";
  const name = account.displayName ?? account.name;

  // Manual credit limit → available is derived as (limit − current balance).
  const available =
    account.manualCreditLimit != null
      ? account.manualCreditLimit - account.currentBalance
      : account.availableBalance;

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(account.displayName ?? "");
  const [dayInput, setDayInput] = useState(
    account.manualDueDay != null ? String(account.manualDueDay) : ""
  );
  const [limitInput, setLimitInput] = useState(
    account.manualCreditLimit != null ? String(account.manualCreditLimit) : ""
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: nameInput,
        ...(isCredit && {
          manualDueDay: dayInput === "" ? null : Number(dayInput),
          manualCreditLimit: limitInput === "" ? null : Number(limitInput),
        }),
      }),
    });
    setEditing(false);
    onChanged();
  }

  const hasOverrides =
    account.displayName != null ||
    account.manualDueDay != null ||
    account.manualCreditLimit != null;

  const inputCls =
    "rounded border border-black/15 bg-transparent px-1.5 py-0.5 outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40";

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        <div className="mt-0.5 truncate text-xs text-black/50 dark:text-white/50">
          {account.mask && <span>··{account.mask} · </span>}
          {account.subtype ?? account.type.toLowerCase()} · {account.institution}
        </div>

        {payment && (
          <div className={`mt-1 text-xs font-medium ${payment.className}`}>
            {payment.text}
          </div>
        )}

        {editing ? (
          <div className="mt-1.5 flex flex-col gap-1.5 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="w-16 text-black/55 dark:text-white/55">Name</span>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={account.name}
                className={`w-48 ${inputCls}`}
              />
            </label>
            {isCredit && (
              <label className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 text-black/55 dark:text-white/55">Due day</span>
                <input
                  value={dayInput}
                  onChange={(e) =>
                    setDayInput(e.target.value.replace(/\D/g, "").slice(0, 2))
                  }
                  inputMode="numeric"
                  placeholder="6"
                  className={`w-12 ${inputCls}`}
                />
                <span className="ml-1 text-black/55 dark:text-white/55">
                  Credit limit $
                </span>
                <input
                  value={limitInput}
                  onChange={(e) =>
                    setLimitInput(e.target.value.replace(/[^\d.]/g, ""))
                  }
                  inputMode="decimal"
                  placeholder="5000"
                  className={`w-24 ${inputCls}`}
                />
              </label>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={busy}
                className="rounded border border-black/15 px-1.5 py-0.5 hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.04]"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-black/45 hover:text-foreground dark:text-white/45"
              >
                Cancel
              </button>
              <span className="text-black/40 dark:text-white/40">
                (blank a field to clear it)
              </span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {hasOverrides ? "Edit" : "Edit / rename"}
          </button>
        )}
      </div>

      <div className="shrink-0 text-right">
        <div
          className={`font-mono tabular-nums ${
            account.isLiability ? "text-red-600 dark:text-red-400" : ""
          }`}
        >
          {formatCurrency(
            account.isLiability ? -account.currentBalance : account.currentBalance
          )}
        </div>
        {available != null && (
          <div className="mt-0.5 text-xs text-black/45 dark:text-white/45">
            {availableLabel} {formatCurrency(available)}
            {account.manualCreditLimit != null &&
              ` of ${formatCurrency(account.manualCreditLimit)} · manual`}
          </div>
        )}
      </div>
    </div>
  );
}

function paymentStatus(
  account: AccountDTO
): { text: string; className: string } | null {
  if (account.type !== "CREDIT") return null;

  const amber = "text-amber-600 dark:text-amber-400";
  const muted = "text-black/60 dark:text-white/60";
  const rel = (d: number) => (d === 0 ? "today" : `in ${d}d`);

  // Manual override wins — used when the issuer doesn't share a due date via
  // Plaid (e.g. Discover). Always a future recurring date, so never "overdue".
  if (account.manualDueDay != null) {
    const iso = nextMonthlyOccurrence(account.manualDueDay);
    const days = daysUntil(iso);
    return {
      text: `Payment due ${formatDate(iso)} · ${rel(days)} · manual`,
      className: days <= 7 ? amber : muted,
    };
  }

  if (!account.nextPaymentDueDate) return null;

  const min =
    account.minimumPaymentAmount && account.minimumPaymentAmount > 0
      ? ` · min ${formatCurrency(account.minimumPaymentAmount)}`
      : "";

  // Plaid's is_overdue is authoritative — don't infer "overdue" from the date.
  if (account.paymentIsOverdue) {
    return {
      text: `Payment overdue — was due ${formatDate(account.nextPaymentDueDate)}${min}`,
      className: "text-red-600 dark:text-red-400",
    };
  }

  const days = daysUntil(account.nextPaymentDueDate);
  if (days >= 0) {
    return {
      text: `Payment due ${formatDate(account.nextPaymentDueDate)} · ${rel(days)}${min}`,
      className: days <= 7 ? amber : muted,
    };
  }

  // Plaid's date is in the past but the card isn't overdue → the next statement
  // hasn't been issued yet. Project the recurring due day forward (estimated).
  const dueDay = new Date(account.nextPaymentDueDate).getUTCDate();
  const iso = nextMonthlyOccurrence(dueDay);
  const pdays = daysUntil(iso);
  return {
    text: `Payment due ${formatDate(iso)} · ${rel(pdays)} · est.`,
    className: pdays <= 7 ? amber : muted,
  };
}
