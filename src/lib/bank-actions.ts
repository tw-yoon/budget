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

/**
 * The Merge button's confirm in the reconnect-merge review
 * (docs/superpowers/specs/2026-10-02-reconnect-merges-history-design.md).
 */
export function mergeConfirm(
  from: string,
  into: string,
  accounts: number,
  duplicates: number
): { title: string; message: string } {
  const what = [
    accounts > 0 ? countNoun(accounts, "account") : null,
    duplicates > 0 ? countNoun(duplicates, "duplicate transaction") : null,
  ]
    .filter(Boolean)
    .join(" and ");
  return {
    title: `Merge ${what}?`,
    message:
      `History from the disconnected ${from} moves into ${into}. ` +
      `Merged rows keep your categories, splits, links and notes. ` +
      `A copy of the database is saved first, in prisma/backups.`,
  };
}
