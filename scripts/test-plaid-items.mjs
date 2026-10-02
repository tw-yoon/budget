import test from "node:test";
import assert from "node:assert/strict";
import { deleteItemHistory, disconnectItem, pickConnectedItems } from "../src/lib/plaid-items.ts";

// An in-memory stand-in for the database: one bank with two accounts and
// their transactions, plus a second bank that must never be touched.
function world({ disconnectedAt = null } = {}) {
  const db = {
    items: [
      { itemId: "item-a", institution: "Example Bank", disconnectedAt },
      { itemId: "item-b", institution: "Sample Credit Union", disconnectedAt: null },
    ],
    accounts: [
      { id: "acc-1", itemId: "item-a" },
      { id: "acc-2", itemId: "item-a" },
      { id: "acc-3", itemId: "item-b" },
    ],
    transactions: [
      { id: "t1", accountId: "acc-1" },
      { id: "t2", accountId: "acc-1" },
      { id: "t3", accountId: "acc-2" },
      { id: "t4", accountId: "acc-3" },
    ],
    syncLogs: [{ itemId: "item-a" }, { itemId: "item-b" }],
  };
  const store = {
    async findItem(itemId) {
      return db.items.find((i) => i.itemId === itemId) ?? null;
    },
    async markDisconnected(itemId, at) {
      db.items.find((i) => i.itemId === itemId).disconnectedAt = at;
    },
    async deleteHistory(itemId) {
      const ids = db.accounts.filter((a) => a.itemId === itemId).map((a) => a.id);
      const before = db.transactions.length;
      db.transactions = db.transactions.filter((t) => !ids.includes(t.accountId));
      db.accounts = db.accounts.filter((a) => a.itemId !== itemId);
      db.syncLogs = db.syncLogs.filter((l) => l.itemId !== itemId);
      db.items = db.items.filter((i) => i.itemId !== itemId);
      return { removedAccounts: ids.length, removedTransactions: before - db.transactions.length };
    },
  };
  const calls = [];
  const plaid = {
    async revoke(itemId) {
      calls.push(["revoke", itemId]);
    },
    deleteToken(itemId) {
      calls.push(["deleteToken", itemId]);
    },
  };
  return { db, store, plaid, calls };
}

const NOW = new Date("2026-03-04T05:06:07.000Z");

test("disconnect keeps every row and sets the flag", async () => {
  const { db, store, plaid, calls } = world();
  const res = await disconnectItem("item-a", store, plaid, NOW);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    ok: true,
    institution: "Example Bank",
    disconnectedAt: "2026-03-04T05:06:07.000Z",
  });
  assert.equal(db.items.length, 2);
  assert.equal(db.accounts.length, 3);
  assert.equal(db.transactions.length, 4);
  assert.equal(db.syncLogs.length, 2);
  assert.equal(db.items[0].disconnectedAt, NOW);
  assert.deepEqual(calls, [["revoke", "item-a"], ["deleteToken", "item-a"]]);
});

test("disconnect is idempotent: a disconnected bank is left alone", async () => {
  const earlier = new Date("2026-01-02T00:00:00.000Z");
  const { db, store, plaid, calls } = world({ disconnectedAt: earlier });
  const res = await disconnectItem("item-a", store, plaid, NOW);
  assert.equal(res.status, 200);
  assert.equal(res.body.disconnectedAt, earlier.toISOString());
  assert.equal(db.items[0].disconnectedAt, earlier);
  assert.deepEqual(calls, []);
});

test("disconnect still goes through when Plaid or the token store fails", async () => {
  const { db, store, plaid } = world();
  plaid.revoke = async () => {
    throw new Error("ITEM_NOT_FOUND");
  };
  plaid.deleteToken = () => {
    throw new Error("no token");
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const res = await disconnectItem("item-a", store, plaid, NOW);
    assert.equal(res.status, 200);
  } finally {
    console.warn = warn;
  }
  assert.equal(db.items[0].disconnectedAt, NOW);
});

test("an unknown bank is a 404 for both actions", async () => {
  const { store, plaid, calls } = world();
  assert.equal((await disconnectItem("nope", store, plaid)).status, 404);
  assert.equal((await deleteItemHistory("nope", store, plaid)).status, 404);
  assert.deepEqual(calls, []);
});

test("deleting a disconnected bank's history removes only that bank, without calling Plaid", async () => {
  const { db, store, plaid, calls } = world({ disconnectedAt: NOW });
  const res = await deleteItemHistory("item-a", store, plaid);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    ok: true,
    institution: "Example Bank",
    removedAccounts: 2,
    removedTransactions: 3,
  });
  assert.deepEqual(db.items.map((i) => i.itemId), ["item-b"]);
  assert.deepEqual(db.accounts.map((a) => a.id), ["acc-3"]);
  assert.deepEqual(db.transactions.map((t) => t.id), ["t4"]);
  assert.deepEqual(db.syncLogs, [{ itemId: "item-b" }]);
  assert.deepEqual(calls, []);
});

test("deleting a connected bank disconnects it first, in one step", async () => {
  const { db, store, plaid, calls } = world();
  const res = await deleteItemHistory("item-a", store, plaid);
  assert.equal(res.status, 200);
  assert.equal(res.body.removedAccounts, 2);
  assert.equal(res.body.removedTransactions, 3);
  assert.deepEqual(calls, [["revoke", "item-a"], ["deleteToken", "item-a"]]);
  assert.deepEqual(db.items.map((i) => i.itemId), ["item-b"]);
});

const items = [
  { itemId: "a", institution: "Example Bank", disconnectedAt: null },
  { itemId: "b", institution: "Sample Credit Union", disconnectedAt: NOW },
  { itemId: "c", institution: "Demo Savings", disconnectedAt: null },
];

test("sync and refresh skip disconnected banks", () => {
  const picked = pickConnectedItems(items);
  assert.equal(picked.ok, true);
  assert.deepEqual(picked.items.map((i) => i.itemId), ["a", "c"]);
});

test("asking for a disconnected bank by id is a clear 409", () => {
  const picked = pickConnectedItems(items.filter((i) => i.itemId === "b"), "b");
  assert.equal(picked.ok, false);
  assert.equal(picked.status, 409);
  assert.match(picked.error, /Sample Credit Union is disconnected/);
});

test("asking for a connected bank by id picks just that bank", () => {
  const picked = pickConnectedItems(items.filter((i) => i.itemId === "c"), "c");
  assert.deepEqual(picked.items.map((i) => i.itemId), ["c"]);
});

test("no connected bank at all is the old 404", () => {
  const picked = pickConnectedItems([items[1]]);
  assert.equal(picked.ok, false);
  assert.equal(picked.status, 404);
  assert.equal(pickConnectedItems([], "zzz").status, 404);
});
