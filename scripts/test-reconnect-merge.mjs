import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAccountPairs,
  checkDuplicatePairs,
  confirmMerge,
  findDuplicates,
  isCandidate,
  mergeLinks,
  mergedAccountSettings,
  mergedTransactionFields,
  nameSimilarity,
  parsePairsParam,
  previewMerge,
  suggestAccountPairs,
} from "../src/lib/reconnect-merge.ts";

// docs/superpowers/specs/2026-10-02-reconnect-merges-history-design.md

const acct = (id, itemId, over = {}) => ({
  id,
  itemId,
  name: "Example Checking",
  mask: "0002",
  type: "DEPOSITORY",
  subtype: "checking",
  displayName: null,
  manualDueDay: null,
  manualCreditLimit: null,
  transactionCount: 0,
  ...over,
});

let seq = 0;
const tx = (accountId, date, amount, name, over = {}) => ({
  id: over.id ?? `t${++seq}`,
  accountId,
  externalId: over.externalId ?? `ext-${seq}`,
  source: "PLAID",
  label: seq,
  amount,
  date: new Date(`${date}T00:00:00.000Z`),
  name,
  merchantName: null,
  pending: false,
  priorItemId: null,
  userCategory: null,
  userCategorySource: null,
  personalNote: null,
  counterparty: null,
  linkedToId: null,
  fundsCashoutId: null,
  splitCount: 0,
  ...over,
});

// ─── Accounts ────────────────────────────────────────────────────────────────

test("accounts pair on a unique type, subtype and mask", () => {
  const olds = [
    acct("o1", "old"),
    acct("o2", "old", { name: "Sample Rewards Card", mask: "0003", type: "CREDIT", subtype: "credit card" }),
    acct("o3", "old", { name: "No Mask Savings", mask: null, subtype: "savings" }),
  ];
  const news = [
    acct("n1", "new"),
    acct("n2", "new", { name: "Sample Rewards Card", mask: "0003", type: "CREDIT", subtype: "credit card" }),
    acct("n3", "new", { name: "No Mask Savings", mask: null, subtype: "savings" }),
  ];
  assert.deepEqual(suggestAccountPairs(olds, news), [
    { from: "o1", to: "n1" },
    { from: "o2", to: "n2" },
  ]);
});

test("two accounts with the same mask are left for the owner", () => {
  const olds = [acct("o1", "old"), acct("o2", "old", { name: "Second Checking" })];
  const news = [acct("n1", "new"), acct("n2", "new", { name: "Second Checking" })];
  assert.deepEqual(suggestAccountPairs(olds, news), []);
  // One side twice, the other once: still ambiguous.
  assert.deepEqual(suggestAccountPairs(olds, [acct("n1", "new")]), []);
});

test("owner pairs must be same type, one-to-one, and from the right banks", () => {
  const olds = [acct("o1", "old"), acct("o2", "old", { type: "CREDIT" })];
  const news = [acct("n1", "new"), acct("n2", "new")];
  assert.equal(checkAccountPairs([{ from: "o1", to: "n2" }], olds, news), null);
  assert.match(checkAccountPairs([{ from: "o2", to: "n1" }], olds, news), /different kinds/);
  assert.match(
    checkAccountPairs([{ from: "o1", to: "n1" }, { from: "o1", to: "n2" }], olds, news),
    /only once/
  );
  assert.match(checkAccountPairs([{ from: "n1", to: "n2" }], olds, news), /disconnected bank/);
  assert.match(checkAccountPairs([{ from: "o1", to: "o2" }], olds, news), /connected bank/);
});

test("account settings: the old account's, else the new one's", () => {
  const o = acct("o1", "old", { displayName: "Bills", manualDueDay: null });
  const n = acct("n1", "new", { displayName: "Other", manualDueDay: 12, manualCreditLimit: 500 });
  assert.deepEqual(mergedAccountSettings(o, n), {
    displayName: "Bills",
    manualDueDay: 12,
    manualCreditLimit: 500,
  });
});

// ─── Transactions ────────────────────────────────────────────────────────────

test("name similarity: same merchant, shared words, or nothing", () => {
  assert.equal(
    nameSimilarity({ name: "x", merchantName: "Sample Mart" }, { name: "y", merchantName: "SAMPLE MART" }),
    1
  );
  assert.ok(
    nameSimilarity({ name: "SAMPLE MART #123 SPRINGFIELD", merchantName: null }, { name: "Sample Mart 456 Springfield", merchantName: null }) >= 0.5
  );
  assert.equal(nameSimilarity({ name: "Sample Mart", merchantName: null }, { name: "Example Cafe", merchantName: null }), 0);
});

test("a candidate needs the same amount, a close date, a similar name, and a posted new row", () => {
  const o = tx("o1", "2026-03-10", 12.34, "Sample Mart");
  assert.ok(isCandidate(o, tx("n1", "2026-03-13", 12.34, "SAMPLE MART")));
  assert.ok(!isCandidate(o, tx("n1", "2026-03-14", 12.34, "Sample Mart")), "4 days apart");
  assert.ok(!isCandidate(o, tx("n1", "2026-03-10", 12.35, "Sample Mart")), "a cent off");
  assert.ok(!isCandidate(o, tx("n1", "2026-03-10", 12.34, "Example Cafe")), "different name");
  assert.ok(!isCandidate(o, tx("n1", "2026-03-10", 12.34, "Sample Mart", { pending: true })), "new still pending");
  assert.ok(isCandidate({ ...o, pending: true }, tx("n1", "2026-03-11", 12.34, "Sample Mart")), "old pending is fine");
  assert.ok(!isCandidate({ ...o, source: "VENMO" }, tx("n1", "2026-03-10", 12.34, "Sample Mart")), "Venmo");
});

const one = () => "acc";

test("a lone match is confident; identical twins are not", () => {
  const olds = [
    tx("o", "2026-03-01", 40, "Sample Mart", { id: "a" }),
    tx("o", "2026-03-05", 4.5, "Example Cafe", { id: "b1" }),
    tx("o", "2026-03-05", 4.5, "Example Cafe", { id: "b2" }),
  ];
  const news = [
    tx("n", "2026-03-01", 40, "SAMPLE MART", { id: "A" }),
    tx("n", "2026-03-05", 4.5, "Example Cafe", { id: "B1" }),
    tx("n", "2026-03-05", 4.5, "Example Cafe", { id: "B2" }),
  ];
  const c = findDuplicates(olds, news, one);
  const sure = c.filter((x) => x.confident).map((x) => `${x.old.id}-${x.new.id}`);
  assert.deepEqual(sure, ["a-A"]);
  assert.equal(c.filter((x) => !x.confident).length, 4, "every twin pairing is listed, none ticked");
});

test("the nearest date settles repeated charges, and settling cascades", () => {
  const olds = [
    tx("o", "2026-03-01", 9.99, "Sample Streaming", { id: "x1" }),
    tx("o", "2026-03-02", 9.99, "Sample Streaming", { id: "x2" }),
  ];
  const news = [
    tx("n", "2026-03-01", 9.99, "Sample Streaming", { id: "X1" }),
    tx("n", "2026-03-04", 9.99, "Sample Streaming", { id: "X2" }),
  ];
  const c = findDuplicates(olds, news, one);
  assert.deepEqual(
    c.filter((x) => x.confident).map((x) => `${x.old.id}-${x.new.id}`).sort(),
    ["x1-X1", "x2-X2"]
  );
  assert.equal(c.filter((x) => !x.confident).length, 0);
});

test("rows on different merged accounts never pair", () => {
  const olds = [tx("o1", "2026-03-01", 40, "Sample Mart")];
  const news = [tx("n2", "2026-03-01", 40, "Sample Mart")];
  const group = (t) => ({ o1: "o1", n1: "o1", o2: "o2", n2: "o2" })[t.accountId];
  assert.equal(findDuplicates(olds, news, group).length, 0);
});

test("a confirm may tick any candidate, but each row once", () => {
  const olds = [tx("o", "2026-03-05", 4.5, "Example Cafe", { id: "b1" }), tx("o", "2026-03-05", 4.5, "Example Cafe", { id: "b2" })];
  const news = [tx("n", "2026-03-05", 4.5, "Example Cafe", { id: "B1" }), tx("n", "2026-03-05", 4.5, "Example Cafe", { id: "B2" })];
  const c = findDuplicates(olds, news, one);
  assert.equal(checkDuplicatePairs([{ keep: "b1", drop: "B2" }, { keep: "b2", drop: "B1" }], c), null);
  assert.match(checkDuplicatePairs([{ keep: "b1", drop: "B1" }, { keep: "b1", drop: "B2" }], c), /only once/);
  assert.match(checkDuplicatePairs([{ keep: "B1", drop: "b1" }], c), /not a possible duplicate/);
});

// ─── What the survivor keeps ─────────────────────────────────────────────────

test("category: the stronger source wins, a tie keeps the old row's", () => {
  const k = tx("o", "2026-03-01", 1, "a", { userCategory: "Groceries", userCategorySource: "RULE" });
  const d = tx("n", "2026-03-01", 1, "a", { userCategory: "Dining", userCategorySource: "MANUAL" });
  assert.equal(mergedTransactionFields(k, d).userCategory, "Dining");
  assert.equal(mergedTransactionFields({ ...k, userCategorySource: "MANUAL" }, d).userCategory, "Groceries");
  assert.equal(mergedTransactionFields(k, { ...d, userCategorySource: "RULE" }).userCategory, "Groceries");
  const none = mergedTransactionFields(tx("o", "2026-03-01", 1, "a"), tx("n", "2026-03-01", 1, "a"));
  assert.equal(none.userCategory, null);
  assert.equal(none.userCategorySource, null);
});

test("notes are both kept; links, counterparty and splits fall back to the new row", () => {
  const k = tx("o", "2026-03-01", 1, "a", { personalNote: "for the trip", splitCount: 0 });
  const d = tx("n", "2026-03-01", 1, "a", {
    personalNote: "shared with Sample Person",
    linkedToId: "p1",
    userCategory: "Dining",
    userCategorySource: "LINK",
    counterparty: "Sample Person",
    splitCount: 2,
  });
  const f = mergedTransactionFields(k, d);
  assert.equal(f.personalNote, "for the trip\nshared with Sample Person");
  assert.equal(f.linkedToId, "p1");
  assert.equal(f.userCategorySource, "LINK");
  assert.equal(f.counterparty, "Sample Person");
  assert.equal(f.moveSplits, true);
  assert.equal(mergedTransactionFields({ ...k, splitCount: 1 }, d).moveSplits, false);
  assert.equal(mergedTransactionFields(k, { ...d, personalNote: "for the trip" }).personalNote, "for the trip");
  // A link between the pair itself is dropped, not carried onto the survivor.
  assert.equal(mergedTransactionFields({ ...k, linkedToId: d.id }, { ...d, linkedToId: null }).linkedToId, null);
});

// ─── Preview and confirm ─────────────────────────────────────────────────────

function world() {
  const db = {
    items: [
      { itemId: "old", institution: "Example Bank", disconnectedAt: new Date("2026-02-01T00:00:00Z") },
      { itemId: "new", institution: "Example Bank", disconnectedAt: null },
      { itemId: "other", institution: "Sample Credit Union", disconnectedAt: null },
    ],
    accounts: [
      acct("o1", "old"),
      acct("o2", "old", { name: "Sample Rewards Card", mask: "0003", type: "CREDIT", subtype: "credit card" }),
      acct("n1", "new"),
      acct("n2", "new", { name: "Sample Rewards Card", mask: "0003", type: "CREDIT", subtype: "credit card" }),
    ],
    transactions: [
      tx("o1", "2026-01-20", 40, "Sample Mart", { id: "old-a" }),
      tx("o1", "2026-01-25", 4.5, "Example Cafe", { id: "old-b", userCategory: "Dining", userCategorySource: "MANUAL" }),
      tx("o1", "2025-12-01", 100, "Sample Mart", { id: "old-early" }),
      tx("n1", "2026-01-20", 40, "SAMPLE MART", { id: "new-a" }),
      tx("n1", "2026-01-25", 4.5, "EXAMPLE CAFE", { id: "new-b" }),
      tx("n1", "2026-02-10", 7, "Example Cafe", { id: "new-later" }),
    ],
    merges: [],
  };
  const calls = [];
  const store = {
    async findItem(itemId) {
      return db.items.find((i) => i.itemId === itemId) ?? null;
    },
    async listAccounts(itemId) {
      return db.accounts.filter((a) => a.itemId === itemId);
    },
    async mergedAccountIds(from, into) {
      return db.merges.filter((m) => m.fromItemId === from && m.intoItemId === into).flatMap((m) => m.accountIds);
    },
    async listTransactions(ids) {
      return db.transactions.filter((t) => ids.includes(t.accountId));
    },
    snapshotFails: false,
    async snapshot(at) {
      calls.push(["snapshot"]);
      if (store.snapshotFails) throw new Error("disk full");
      return `pre-merge-${at.getTime()}.db`;
    },
    async apply(plan) {
      calls.push(["apply", plan]);
      // Just enough of the real thing to drive a second review.
      for (const { survivor, removed } of plan.accounts) {
        for (const t of db.transactions) {
          if (t.accountId === survivor.id && t.source === "PLAID") t.priorItemId = plan.fromItemId;
          if (t.accountId === removed.id) t.accountId = survivor.id;
        }
        db.accounts = db.accounts.filter((a) => a.id !== removed.id);
        survivor.itemId = plan.intoItemId;
      }
      for (const { keep, drop } of plan.duplicates) {
        db.transactions = db.transactions.filter((t) => t.id !== drop.id);
        keep.priorItemId = null;
      }
      db.merges.push({
        fromItemId: plan.fromItemId,
        intoItemId: plan.intoItemId,
        accountIds: plan.accounts.map((a) => a.survivor.id),
      });
    },
  };
  return { db, store, calls };
}

const NOW = new Date("2026-03-04T05:06:07.000Z");

test("preview suggests the pairs and the duplicates, and changes nothing", async () => {
  const { store, calls } = world();
  const res = await previewMerge("old", "new", null, store);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.pairs, [
    { from: "o1", to: "n1" },
    { from: "o2", to: "n2" },
  ]);
  const d = res.body.duplicates.map((x) => [x.old.id, x.new.id, x.confident]);
  assert.deepEqual(d, [
    ["old-b", "new-b", true],
    ["old-a", "new-a", true],
  ]);
  assert.equal(res.body.duplicates[0].old.edited, true);
  assert.equal(calls.length, 0);
});

test("preview with explicit pairs uses exactly those (empty means none)", async () => {
  const { store } = world();
  const res = await previewMerge("old", "new", [], store);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.pairs, []);
  assert.deepEqual(res.body.duplicates, []);
  assert.deepEqual(parsePairsParam(null), null);
  assert.deepEqual(parsePairsParam(""), []);
  assert.deepEqual(parsePairsParam("o1:n1,o2:n2"), [
    { from: "o1", to: "n1" },
    { from: "o2", to: "n2" },
  ]);
});

test("preview and confirm refuse the wrong banks", async () => {
  const { store } = world();
  assert.equal((await previewMerge("nope", "new", null, store)).status, 404);
  assert.equal((await previewMerge("old", null, null, store)).status, 400);
  assert.equal((await previewMerge("new", "other", null, store)).status, 409, "from is connected");
  assert.equal((await previewMerge("old", "old", null, store)).status, 409, "into itself");
  store.findItem = async (id) =>
    id === "new" ? { itemId: "new", institution: "Example Bank", disconnectedAt: NOW } : world().store.findItem(id);
  assert.equal((await previewMerge("old", "new", null, store)).status, 409, "into is disconnected");
});

test("confirm checks the body, snapshots, then hands the store the plan", async () => {
  const { store, calls } = world();
  assert.equal((await confirmMerge("old", null, store, NOW)).status, 400);
  assert.equal((await confirmMerge("old", { into: "new" }, store, NOW)).status, 400, "nothing to merge");
  assert.equal(
    (await confirmMerge("old", { into: "new", accounts: [{ from: "o1" }] }, store, NOW)).status,
    400
  );
  assert.equal(
    (await confirmMerge("old", { into: "new", accounts: [{ from: "o1", to: "n1" }], duplicates: [{ keep: "old-a", drop: "new-later" }] }, store, NOW)).status,
    400,
    "not a candidate"
  );
  assert.equal(calls.length, 0, "nothing written by a refused confirm");

  const res = await confirmMerge(
    "old",
    {
      into: "new",
      accounts: [{ from: "o1", to: "n1" }],
      duplicates: [{ keep: "old-a", drop: "new-a" }],
    },
    store,
    NOW
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    ok: true,
    mergedAccounts: 1,
    mergedDuplicates: 1,
    snapshot: `pre-merge-${NOW.getTime()}.db`,
  });
  assert.deepEqual(calls.map((c) => c[0]), ["snapshot", "apply"]);
  const plan = calls[1][1];
  assert.equal(plan.accounts[0].survivor.id, "o1");
  assert.equal(plan.accounts[0].removed.id, "n1");
  assert.equal(plan.duplicates[0].keep.id, "old-a");
  assert.equal(plan.duplicates[0].drop.id, "new-a");
  assert.equal(plan.snapshotFile, `pre-merge-${NOW.getTime()}.db`);
});

test("a failed snapshot merges nothing", async () => {
  const { store, calls } = world();
  store.snapshotFails = true;
  const res = await confirmMerge("old", { into: "new", accounts: [{ from: "o1", to: "n1" }] }, store, NOW);
  assert.equal(res.status, 500);
  assert.match(res.body.error, /nothing was merged/);
  assert.deepEqual(calls.map((c) => c[0]), ["snapshot"]);
});

test("after a merge, a second review finds the duplicates left on the merged account", async () => {
  const { store, db } = world();
  // Merge the accounts only, ticking no duplicates.
  const first = await confirmMerge("old", { into: "new", accounts: [{ from: "o1", to: "n1" }] }, store, NOW);
  assert.equal(first.status, 200);
  assert.equal(db.accounts.find((a) => a.id === "o1").itemId, "new");

  const res = await previewMerge("old", "new", [], store);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.mergedAccounts.map((a) => a.id), ["o1"]);
  assert.deepEqual(
    res.body.duplicates.map((x) => [x.old.id, x.new.id, x.confident]),
    [
      ["old-b", "new-b", true],
      ["old-a", "new-a", true],
    ]
  );
  // A duplicates-only confirm is allowed.
  const again = await confirmMerge(
    "old",
    { into: "new", accounts: [], duplicates: [{ keep: "old-b", drop: "new-b" }] },
    store,
    NOW
  );
  assert.equal(again.status, 200);
  assert.equal(again.body.mergedDuplicates, 1);
  const left = await previewMerge("old", "new", [], store);
  assert.deepEqual(left.body.duplicates.map((x) => x.old.id), ["old-a"]);
});

// ─── Banks list ──────────────────────────────────────────────────────────────

test("banks: merge targets by name, merged-from history, emptied banks hidden", () => {
  const at = new Date("2026-03-01T00:00:00Z");
  const banks = [
    { itemId: "old", institution: "Example Bank", accountCount: 1, disconnectedAt: at },
    { itemId: "older", institution: "Example Bank", accountCount: 0, disconnectedAt: at },
    { itemId: "gone", institution: "Example Bank", accountCount: 0, disconnectedAt: at },
    { itemId: "new", institution: "example bank ", accountCount: 2, disconnectedAt: null },
    { itemId: "other", institution: "Sample Credit Union", accountCount: 1, disconnectedAt: null },
  ];
  const merges = [
    { fromItemId: "older", intoItemId: "new", createdAt: new Date("2026-03-02T00:00:00Z") },
    { fromItemId: "older", intoItemId: "new", createdAt: new Date("2026-03-03T00:00:00Z") },
  ];
  const m = mergeLinks(banks, merges);
  assert.deepEqual(m.get("old"), {
    hidden: false,
    mergeInto: [{ itemId: "new", institution: "example bank " }],
    mergedFrom: [],
  });
  assert.equal(m.get("older").hidden, true);
  assert.equal(m.get("gone").hidden, false, "empty but never merged: still listed, so it can be deleted");
  assert.deepEqual(m.get("gone").mergeInto, []);
  assert.deepEqual(m.get("new").mergedFrom, [
    { itemId: "older", institution: "Example Bank", mergedAt: "2026-03-03T00:00:00.000Z" },
  ]);
  assert.deepEqual(m.get("other").mergeInto, []);
});
