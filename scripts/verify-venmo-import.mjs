/**
 * Verification + seed harness for the Venmo import. Runs the REAL parser
 * (src/lib/venmo.ts) and writes to the REAL database via Prisma, mirroring
 * src/services/venmo.service.ts, then prints the cash-out reconciliation so we
 * can confirm the numbers before relying on the in-app route.
 *
 *   DATABASE_URL="file:/abs/path/prisma/dev.db" node scripts/verify-venmo-import.mjs
 */

import { PrismaClient } from "@prisma/client";
import {
  findStatementFiles,
  parseStatements,
  suggestCategory,
} from "../src/lib/venmo.ts";

const APPROX = 0.005;
const prisma = new PrismaClient();

const files = findStatementFiles();
console.log(`Statement files: ${files.length}`);
const { accountHolder, rows } = parseStatements(files);
console.log(`Account holder: ${accountHolder} · ${rows.length} rows\n`);

const payments = rows.filter((r) => r.type !== "Standard Transfer");
const cashouts = rows.filter((r) => r.type === "Standard Transfer");

const bankCashouts = await prisma.transaction.findMany({
  where: {
    source: "PLAID",
    amount: { lt: 0 },
    OR: [{ name: { contains: "Venmo" } }, { merchantName: { contains: "Venmo" } }],
  },
  select: { id: true, amount: true, date: true, accountId: true },
  orderBy: { date: "asc" },
});
console.log(`Bank-side Venmo deposits found: ${bankCashouts.length}`);

const usedBank = new Set();
const cashoutBankId = new Map();
for (const co of cashouts) {
  const match = bankCashouts.find(
    (b) => !usedBank.has(b.id) && Math.abs(Math.abs(b.amount) - co.amount) < APPROX
  );
  if (match) {
    usedBank.add(match.id);
    cashoutBankId.set(co, match.id);
  }
}

const accountId =
  bankCashouts[0]?.accountId ??
  (await prisma.account.findFirst({ where: { type: "depository" } }))?.id ??
  (await prisma.account.findFirst())?.id;

// FIFO allocate received payments to the cash-out that drained them.
const allocation = new Map();
const queue = [];
const events = [...rows].sort((a, b) => a.datetime.localeCompare(b.datetime));
for (const e of events) {
  if (e.type === "Standard Transfer") {
    const bankId = cashoutBankId.get(e);
    let need = e.amount;
    while (need > APPROX && queue.length > 0) {
      const head = queue[0];
      const take = Math.min(head.remaining, need);
      if (bankId && !allocation.has(head.venmoId)) allocation.set(head.venmoId, bankId);
      head.remaining -= take;
      need -= take;
      if (head.remaining <= APPROX) queue.shift();
    }
  } else if (e.direction === "in") {
    queue.push({ venmoId: e.venmoId, remaining: e.amount });
  }
}

// Upsert payments (preserve existing userCategory).
let imported = 0;
for (const p of payments) {
  const plaidTxId = `venmo:${p.venmoId}`;
  const amount = p.direction === "out" ? p.amount : -p.amount;
  const name = p.note || `Venmo ${p.direction === "out" ? "payment" : "received"}`;
  await prisma.transaction.upsert({
    where: { plaidTxId },
    create: {
      plaidTxId,
      accountId,
      amount,
      date: new Date(p.datetime),
      name,
      merchantName: p.counterparty || "Venmo",
      counterparty: p.counterparty || null,
      pfcPrimary: "UNCATEGORIZED",
      source: "VENMO",
      userCategory: suggestCategory(p.note, p.type, p.direction),
      fundsCashoutId: allocation.get(p.venmoId) ?? null,
      isTransfer: false,
      isFee: false,
      pending: false,
    },
    update: {
      amount,
      date: new Date(p.datetime),
      name,
      merchantName: p.counterparty || "Venmo",
      counterparty: p.counterparty || null,
      fundsCashoutId: allocation.get(p.venmoId) ?? null,
    },
  });
  imported++;
}
console.log(`Upserted ${imported} Venmo payments.\n`);

// Reconciliation report per cash-out.
console.log("Cash-out reconciliation");
console.log("───────────────────────");
for (const co of [...cashouts].sort((a, b) => a.datetime.localeCompare(b.datetime))) {
  const bankId = cashoutBankId.get(co);
  const children = payments.filter(
    (p) => p.direction === "in" && allocation.get(p.venmoId) === bankId
  );
  const byCat = new Map();
  for (const c of children) byCat.set(c.suggested, (byCat.get(c.suggested) ?? 0) + c.amount);
  const accounted = [...byCat.values()].reduce((s, x) => s + x, 0);
  const prior = Math.max(0, co.amount - accounted);
  console.log(`\n  ${co.datetime.slice(0, 10)}  cash-out $${co.amount.toFixed(2)}  ${bankId ? "(matched bank deposit)" : "(NO bank match)"}`);
  for (const [cat, amt] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${cat.padEnd(16)} $${amt.toFixed(2)}`);
  }
  if (prior > APPROX) console.log(`      ${"Prior balance".padEnd(16)} $${prior.toFixed(2)}  (uncategorized)`);
  console.log(`      ${"= total".padEnd(16)} $${(accounted + prior).toFixed(2)}`);
}

const counts = await prisma.transaction.groupBy({ by: ["source"], _count: true });
console.log("\nDB rows by source:", counts.map((c) => `${c.source}=${c._count}`).join(", "));

await prisma.$disconnect();
