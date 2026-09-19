/**
 * Import a Venmo CSV statement into the same Transaction table the rest of the
 * app reads from, so categorized Venmo activity flows into the ledger and
 * analytics automatically.
 *
 * Two kinds of money live in a statement:
 *   - Payments/Charges  → imported as Transactions (source=VENMO). Sent money
 *     is spending; received money is a reimbursement that offsets a category.
 *   - Standard Transfers → the periodic cash-out of the Venmo balance to the
 *     bank. We do NOT import these; they already exist on the bank side as a
 *     single "Venmo" deposit (kept flagged isTransfer). Instead we reconcile:
 *     received payments accumulate in the balance and are pooled into the next
 *     cash-out, so we FIFO-allocate each received payment to the bank deposit
 *     it funded. That lets the ledger expand a lump deposit into its parts.
 */

import { prisma } from "@/lib/prisma";
import {
  findStatementFiles,
  parseStatements,
  suggestCategory,
  type VenmoRow,
} from "@/lib/venmo";
import { nextLabel } from "@/lib/next-label";

const APPROX = 0.005; // dollar tolerance when matching amounts

/** Bank-side Venmo cash-out deposits (money Venmo → checking), newest first. */
async function loadBankCashouts() {
  return prisma.transaction.findMany({
    where: {
      source: "PLAID",
      amount: { lt: 0 }, // inflow to the bank
      OR: [
        { name: { contains: "Venmo" } },
        { merchantName: { contains: "Venmo" } },
      ],
    },
    select: { id: true, amount: true, date: true, accountId: true },
    orderBy: { date: "asc" },
  });
}

interface ImportResult {
  imported: number;
  reconciledCashouts: number;
  unmatchedCashouts: number;
  accountHolder: string;
}

export async function importVenmoStatements(): Promise<ImportResult> {
  const files = findStatementFiles();
  if (files.length === 0) {
    return { imported: 0, reconciledCashouts: 0, unmatchedCashouts: 0, accountHolder: "" };
  }

  const { accountHolder, rows } = parseStatements(files);
  const payments = rows.filter((r) => r.type !== "Standard Transfer");
  const cashouts = rows.filter((r) => r.type === "Standard Transfer");

  // ── Match each CSV cash-out to its bank-side deposit (by amount) ───────────
  const bankCashouts = await loadBankCashouts();
  const usedBank = new Set<string>();
  const cashoutBankId = new Map<VenmoRow, string>();
  let unmatched = 0;
  for (const co of cashouts) {
    const match = bankCashouts.find(
      (b) => !usedBank.has(b.id) && Math.abs(Math.abs(b.amount) - co.amount) < APPROX
    );
    if (match) {
      usedBank.add(match.id);
      cashoutBankId.set(co, match.id);
    } else unmatched++;
  }

  // Where to hang the imported rows: the account that owns the Venmo deposits,
  // else any depository account.
  const accountId =
    bankCashouts[0]?.accountId ??
    (await prisma.account.findFirst({ where: { type: "depository" } }))?.id ??
    (await prisma.account.findFirst())?.id;
  if (!accountId) throw new Error("No account to attach Venmo transactions to");

  // ── FIFO: pool received payments into the cash-out that drained them ───────
  // Walk events in time order. Received payments queue up; each cash-out
  // consumes from the front until filled. The first cash-out is typically
  // short (it also drained balance carried in from before our statements) —
  // that shortfall stays uncategorized "prior balance".
  const allocation = new Map<string, string>(); // venmoId -> bank cash-out id
  const queue: { venmoId: string; remaining: number }[] = [];
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

  // ── Upsert payment rows (preserve any user category already set) ───────────
  let imported = 0;
  for (const p of payments) {
    const externalId = `venmo:${p.venmoId}`;
    // Plaid sign convention: positive = outflow. Sent => +, received => -.
    const amount = p.direction === "out" ? p.amount : -p.amount;
    const name = p.note || `Venmo ${p.direction === "out" ? "payment" : "received"}`;
    const fundsCashoutId = allocation.get(p.venmoId) ?? null;
    // Computed before the upsert so it is available to the `create` branch.
    // If the row already exists we take the update branch and this value goes
    // unused — no number is burned, since the maximum is unchanged.
    const label = await nextLabel();

    await prisma.transaction.upsert({
      where: { externalId },
      create: {
        externalId,
        accountId,
        amount,
        date: new Date(p.datetime),
        name,
        merchantName: p.counterparty || "Venmo",
        counterparty: p.counterparty || null,
        pfcPrimary: "UNCATEGORIZED",
        source: "VENMO",
        userCategory: suggestCategory(p.note, p.type, p.direction),
        userCategorySource: "VENMO",
        fundsCashoutId,
        isTransfer: false,
        isFee: false,
        pending: false,
        label,
      },
      update: {
        // Keep user edits to userCategory; refresh the mechanical fields.
        amount,
        date: new Date(p.datetime),
        name,
        merchantName: p.counterparty || "Venmo",
        counterparty: p.counterparty || null,
        fundsCashoutId,
      },
    });
    imported++;
  }

  return {
    imported,
    reconciledCashouts: cashoutBankId.size,
    unmatchedCashouts: unmatched,
    accountHolder,
  };
}

export interface CashoutBreakdownSlice {
  category: string;
  amount: number;
}

/**
 * For a set of bank-side Venmo cash-out transaction ids, return the categorized
 * received-payment breakdown that funded each, plus the leftover "prior
 * balance" (cash-out total minus what our statements account for).
 */
export async function getCashoutBreakdowns(
  cashouts: { id: string; amount: number }[]
): Promise<Map<string, { slices: CashoutBreakdownSlice[]; priorBalance: number }>> {
  const ids = cashouts.map((c) => c.id);
  const out = new Map<string, { slices: CashoutBreakdownSlice[]; priorBalance: number }>();
  if (ids.length === 0) return out;

  const children = await prisma.transaction.findMany({
    where: { source: "VENMO", fundsCashoutId: { in: ids } },
    select: { fundsCashoutId: true, userCategory: true, amount: true },
  });

  const byCashout = new Map<string, Map<string, number>>();
  for (const c of children) {
    if (!c.fundsCashoutId) continue;
    const cat = c.userCategory ?? "Uncategorized";
    const m = byCashout.get(c.fundsCashoutId) ?? new Map<string, number>();
    m.set(cat, (m.get(cat) ?? 0) + Math.abs(c.amount));
    byCashout.set(c.fundsCashoutId, m);
  }

  for (const co of cashouts) {
    const m = byCashout.get(co.id);
    const slices = m
      ? [...m.entries()]
          .map(([category, amount]) => ({ category, amount: round(amount) }))
          .sort((a, b) => b.amount - a.amount)
      : [];
    const accounted = slices.reduce((s, x) => s + x.amount, 0);
    const priorBalance = round(Math.max(0, Math.abs(co.amount) - accounted));
    out.set(co.id, { slices, priorBalance });
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
