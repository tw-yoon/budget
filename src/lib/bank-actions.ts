import type { BankSummary } from "@/types";

// Wording for the Connections page's Disconnect and Delete confirms. The
// iPhone's Settings → Connections ports these (ConnectionsView.swift).
// docs/superpowers/specs/2026-10-02-disconnect-keeps-history-design.md

type Bank = Pick<BankSummary, "institution" | "accountCount" | "transactionCount" | "disconnectedAt">;

export function countNoun(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function disconnectConfirm(bank: Bank): { title: string; message: string } {
  return {
    title: `Disconnect ${bank.institution}?`,
    message:
      `This revokes the Plaid connection, so nothing new comes in from this bank. ` +
      `Its history is kept: ${countNoun(bank.accountCount, "account")} and their transactions stay in this app, ` +
      `left out of your totals.`,
  };
}

/** "Delete…" on a connected bank, "Delete History…" on a disconnected one. */
export function deleteConfirm(bank: Bank): { title: string; message: string } {
  const counts = `${countNoun(bank.accountCount, "account")} and ${countNoun(bank.transactionCount, "transaction")}`;
  return bank.disconnectedAt
    ? {
        title: `Delete ${bank.institution}'s history?`,
        message:
          `This removes everything this bank recorded in this app: ${counts}, ` +
          `with their categories, splits and links. It cannot be undone.`,
      }
    : {
        title: `Delete ${bank.institution}?`,
        message:
          `This disconnects the bank and removes everything it recorded in this app: ${counts}, ` +
          `with their categories, splits and links. It cannot be undone.`,
      };
}
