import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAccounts } from "../src/lib/account-totals.ts";
import { deleteConfirm, disconnectConfirm } from "../src/lib/bank-actions.ts";

function account(id, type, currentBalance, { disconnected = false, at = "2026-05-01T10:00:00.000Z" } = {}) {
  return {
    id,
    name: id,
    officialName: null,
    mask: null,
    type,
    subtype: null,
    currentBalance,
    availableBalance: null,
    balanceFetchedAt: at,
    institution: "Example Bank",
    isLiability: type === "CREDIT" || type === "LOAN",
    nextPaymentDueDate: null,
    lastStatementBalance: null,
    minimumPaymentAmount: null,
    paymentIsOverdue: null,
    displayName: null,
    manualDueDay: null,
    manualCreditLimit: null,
    disconnected,
  };
}

const accounts = [
  account("checking", "DEPOSITORY", 1000),
  account("old-savings", "DEPOSITORY", 500, { disconnected: true, at: "2026-06-01T00:00:00.000Z" }),
  account("card", "CREDIT", 200.5),
  account("old-card", "CREDIT", 75, { disconnected: true }),
  account("old-brokerage", "INVESTMENT", 9000, { disconnected: true }),
];

test("disconnected accounts count toward no total", () => {
  const { summary } = summarizeAccounts(accounts);
  assert.equal(summary.totalAssets, 1000);
  assert.equal(summary.totalLiabilities, 200.5);
  assert.equal(summary.netWorth, 799.5);
  assert.equal(summary.accountCount, 2);
});

test("disconnected accounts stay listed, outside their group's subtotal", () => {
  const { groups } = summarizeAccounts(accounts);
  assert.deepEqual(
    groups.map((g) => [g.type, g.subtotal, g.accounts.map((a) => a.id)]),
    [
      ["DEPOSITORY", 1000, ["checking", "old-savings"]],
      ["INVESTMENT", 0, ["old-brokerage"]],
      ["CREDIT", 200.5, ["card", "old-card"]],
    ]
  );
});

test("the last refresh ignores a disconnected bank's balances", () => {
  assert.equal(summarizeAccounts(accounts).summary.lastRefreshed, "2026-05-01T10:00:00.000Z");
  const onlyOld = summarizeAccounts([accounts[1]]);
  assert.equal(onlyOld.summary.lastRefreshed, null);
  assert.equal(onlyOld.summary.accountCount, 0);
  assert.equal(onlyOld.groups.length, 1);
});

const bank = { institution: "Example Bank", accountCount: 2, transactionCount: 1, disconnectedAt: null };

test("the Disconnect confirm says history is kept", () => {
  const { title, message } = disconnectConfirm(bank);
  assert.equal(title, "Disconnect Example Bank?");
  assert.match(message, /history is kept/);
  assert.match(message, /2 accounts/);
});

test("the Delete confirm on a connected bank names the counts and cannot be undone", () => {
  const { title, message } = deleteConfirm(bank);
  assert.equal(title, "Delete Example Bank?");
  assert.match(message, /disconnects the bank/);
  assert.match(message, /removes everything it recorded in this app: 2 accounts and 1 transaction,/);
  assert.match(message, /cannot be undone/);
});

test("the Delete History confirm on a disconnected bank", () => {
  const { title, message } = deleteConfirm({ ...bank, accountCount: 1, transactionCount: 40, disconnectedAt: "2026-05-01T00:00:00.000Z" });
  assert.equal(title, "Delete Example Bank's history?");
  assert.doesNotMatch(message, /disconnects/);
  assert.match(message, /1 account and 40 transactions/);
  assert.match(message, /cannot be undone/);
});
