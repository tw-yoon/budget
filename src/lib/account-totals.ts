import type { AccountDTO, AccountGroup, AccountsSummary } from "@/types";

export const LIABILITY_TYPES = new Set(["CREDIT", "LOAN"]);

// Render order + friendly labels. Assets first, then liabilities.
const TYPE_META: { type: string; label: string }[] = [
  { type: "DEPOSITORY", label: "Cash" },
  { type: "INVESTMENT", label: "Investments" },
  { type: "CREDIT", label: "Credit Cards" },
  { type: "LOAN", label: "Loans" },
  { type: "OTHER", label: "Other" },
];

const round = (n: number) => Math.round(n * 100) / 100;
const sum = (accounts: AccountDTO[]) => accounts.reduce((s, a) => s + a.currentBalance, 0);

/**
 * Groups and totals for GET /api/accounts. A disconnected bank's accounts are
 * still listed in their groups, but count toward no total: not a group
 * subtotal, assets, liabilities, net worth, the account count or the last
 * refresh time (docs/superpowers/specs/2026-10-02-disconnect-keeps-history-design.md).
 */
export function summarizeAccounts(accounts: AccountDTO[]): {
  groups: AccountGroup[];
  summary: AccountsSummary;
} {
  const live = accounts.filter((a) => !a.disconnected);

  // Group by type in the defined order; drop empty groups.
  const groups: AccountGroup[] = TYPE_META.map(({ type, label }) => {
    const inType = accounts.filter((a) => a.type === type);
    return {
      type,
      label,
      isLiability: LIABILITY_TYPES.has(type),
      subtotal: sum(inType.filter((a) => !a.disconnected)),
      accounts: inType,
    };
  }).filter((g) => g.accounts.length > 0);

  const totalAssets = sum(live.filter((a) => !a.isLiability));
  const totalLiabilities = sum(live.filter((a) => a.isLiability));
  const lastRefreshed = live.map((a) => a.balanceFetchedAt).sort().at(-1) ?? null;

  return {
    groups,
    summary: {
      totalAssets: round(totalAssets),
      totalLiabilities: round(totalLiabilities),
      netWorth: round(totalAssets - totalLiabilities),
      accountCount: live.length,
      lastRefreshed,
    },
  };
}
