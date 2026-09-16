# Transaction Labels and Refund Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every transaction a permanent display number, and let an inflow that is really a refund or payback point at the purchase it offsets and inherit that purchase's category.

**Architecture:** Two new columns on `Transaction` — `label` (a permanent serial) and `linkedToId` (a self-relation, many refunds to one purchase). The refund stores no category of its own; its effective category is derived through the link at read time, so it cannot drift and linking works before or after the purchase is categorized. All link logic lives in one dependency-free module, `src/lib/links.ts`, so it is unit-testable without a database.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, Prisma 5 over SQLite, Tailwind 4, `node:test` (built in, no new dependency).

**Spec:** `docs/superpowers/specs/2026-09-16-transaction-labels-and-links-design.md`

## Global Constraints

- **Read the bundled docs first.** `AGENTS.md` requires reading the relevant guide in `node_modules/next/dist/docs/` before writing code. This version of Next differs from training data. Route handler params are `{ params }: { params: Promise<{ id: string }> }` and must be awaited — this is confirmed current and is what the existing routes already do. Match existing route style; do not switch to the newer `RouteContext<'/path'>` helper.
- **Plaid sign convention, everywhere:** `amount > 0` means money LEFT the account (a purchase). `amount < 0` means money came IN (a refund, payback, or income). Getting this backwards silently inverts the whole feature.
- **`src/lib/links.ts` must have zero imports.** Node 24 strips TypeScript types natively, so `node:test` can import it directly — but only if it has no `@/` alias imports to resolve. Keep formatting and database concerns in the callers.
- **Never reuse a label.** A deleted transaction leaves a permanent gap.
- **Back up `prisma/dev.db` before migrating.** It holds real financial data and the self-relation makes Prisma rebuild the table.
- **After all code changes, run `bash Budget.command --no-open`** — Budget serves a prebuilt bundle and will otherwise serve stale code.

---

### Task 1: Label column, backfill, and assignment

Both columns ship in this one migration even though `linkedToId` is not used until Task 2. Two separate migrations would mean two SQLite table rebuilds against a database holding real data, for no benefit.

**Files:**
- Modify: `prisma/schema.prisma` (the `Transaction` model)
- Create: `prisma/migrations/<timestamp>_transaction_labels_and_links/migration.sql`
- Create: `src/lib/labels.ts` (pure, import-free — the test runner loads it directly)
- Create: `src/lib/next-label.ts` (the Prisma half, kept separate so `labels.ts` stays import-free)
- Create: `scripts/test-links.mjs`
- Modify: `package.json` (the `test` script)
- Modify: `src/services/sync.service.ts:90-118` (the `create` branch of the upsert)
- Modify: `src/services/venmo.service.ts:117-140` (the `create` branch of the upsert)

**Interfaces:**
- Consumes: nothing.
- Produces: `nextLabelFrom(maxLabel: number | null): number` from `src/lib/labels.ts`, and `nextLabel(): Promise<number>` from `src/lib/next-label.ts`. `Transaction.label: number | null` and `Transaction.linkedToId: string | null` in the Prisma schema.

- [ ] **Step 1: Back up the database**

```bash
cp prisma/dev.db "prisma/backups/pre-tx-labels-$(date +%Y%m%dT%H%M%S).db"
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-links.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { nextLabelFrom } from "../src/lib/labels.ts";

test("first label is 1 when no transaction is labelled yet", () => {
  assert.equal(nextLabelFrom(null), 1);
});

test("next label follows the current maximum", () => {
  assert.equal(nextLabelFrom(412), 413);
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node --test scripts/test-links.mjs`
Expected: FAIL — cannot resolve `../src/lib/labels.ts`.

- [ ] **Step 4: Add the columns to the schema**

In `prisma/schema.prisma`, inside `model Transaction`, after the `fundsCashoutId` line:

```prisma
  // Permanent display serial, shown left of the date in the ledger. Assigned
  // once and never reused: a deleted transaction leaves a gap, so a number
  // written down somewhere never changes meaning. Nullable only because SQLite
  // cannot add a NOT NULL UNIQUE column to a populated table without a rebuild.
  label Int? @unique

  // A money-in row (refund, partial refund, Venmo/Zelle payback) points at the
  // purchase it offsets. Many refunds may share one purchase. The refund holds
  // no category of its own — it derives one through this link.
  linkedToId String?
```

And alongside the existing `account` relation:

```prisma
  linkedTo Transaction?  @relation("TxRefunds", fields: [linkedToId], references: [id], onDelete: SetNull)
  refunds  Transaction[] @relation("TxRefunds")
```

And add to the index block:

```prisma
  @@index([linkedToId])
```

- [ ] **Step 5: Generate the migration without applying it**

```bash
npx prisma migrate dev --create-only --name transaction_labels_and_links
```

- [ ] **Step 6: Append the backfill to the generated migration**

Open the new file under `prisma/migrations/`. Prisma will have emitted a table rebuild (create new table, copy rows, drop old, rename). Append this to the very end, so it runs *after* the rebuild:

```sql
-- Backfill: oldest transaction is #1. Ordering by date then createdAt keeps
-- the numbering deterministic when several rows share a date.
UPDATE "Transaction" SET "label" = (SELECT rn FROM
  (SELECT id, ROW_NUMBER() OVER (ORDER BY "date" ASC, "createdAt" ASC) rn FROM "Transaction") s
  WHERE s.id = "Transaction"."id");
```

- [ ] **Step 7: Apply the migration**

```bash
npx prisma migrate dev
```

- [ ] **Step 8: Verify the backfill produced contiguous, unique labels**

```bash
npx prisma db execute --stdin <<'SQL'
SELECT COUNT(*) AS rows, COUNT(label) AS labelled,
       COUNT(DISTINCT label) AS distinct_labels,
       MIN(label) AS lo, MAX(label) AS hi FROM "Transaction";
SQL
```
Expected: `rows` = `labelled` = `distinct_labels`, `lo` = 1, `hi` = `rows`. If any differ, stop — the backfill did not run after the rebuild.

- [ ] **Step 9: Implement the label helper**

Create `src/lib/labels.ts`:

```ts
/**
 * Display serials for transactions. Kept free of imports so `node:test` can
 * load it directly under Node's native type stripping.
 */

/** The serial that follows a given maximum. Pure, for testing without a database. */
export function nextLabelFrom(maxLabel: number | null): number {
  return (maxLabel ?? 0) + 1;
}
```

Then, because `nextLabel` needs Prisma and `links.ts`/`labels.ts` must stay import-free for the test runner, put the database half in a separate file. Create `src/lib/next-label.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { nextLabelFrom } from "@/lib/labels";

/**
 * The display serial for the next transaction to be created. Syncs are
 * serialized in this single-user app, so reading the maximum and adding one
 * needs no locking. Labels are never reused: a deleted transaction leaves a
 * permanent gap on purpose.
 */
export async function nextLabel(): Promise<number> {
  const top = await prisma.transaction.findFirst({
    where: { label: { not: null } },
    orderBy: { label: "desc" },
    select: { label: true },
  });
  return nextLabelFrom(top?.label ?? null);
}
```

- [ ] **Step 10: Run the test to confirm it passes**

Run: `node --test scripts/test-links.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 11: Wire the test into `npm test`**

In `package.json`, change the `test` script to:

```json
"test": "bash scripts/test-scrub.sh && bash scripts/test-launcher.sh && node --test scripts/test-links.mjs"
```

- [ ] **Step 12: Assign labels on insert**

In `src/services/sync.service.ts`, add the import at the top:

```ts
import { nextLabel } from "@/lib/next-label";
```

Then inside the `for (const tx of addedTxs)` loop, immediately before the `await prisma.transaction.upsert({` call:

```ts
      // Computed before the upsert so it is available to the `create` branch.
      // If the row already exists we take the update branch and this value goes
      // unused — no number is burned, since the maximum is unchanged.
      const label = await nextLabel();
```

and add `label,` as the last property of the `create` object (leave `update` alone — a label is assigned once).

Do exactly the same in `src/services/venmo.service.ts`: add the same import, add `const label = await nextLabel();` immediately before its `await prisma.transaction.upsert({`, and add `label,` to its `create` object only.

- [ ] **Step 13: Verify a new insert gets the next label**

```bash
npx prisma db execute --stdin <<'SQL'
SELECT MAX(label) FROM "Transaction";
SQL
```
Note the number. It is the value the next synced transaction will take.

- [ ] **Step 14: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/labels.ts src/lib/next-label.ts src/services/sync.service.ts src/services/venmo.service.ts scripts/test-links.mjs package.json
git commit -m "Give every transaction a permanent number"
```

---

### Task 2: Link validation and the PATCH endpoint

**Files:**
- Create: `src/lib/links.ts`
- Modify: `scripts/test-links.mjs` (add tests)
- Modify: `src/app/api/transactions/[id]/route.ts`

**Interfaces:**
- Consumes: `Transaction.linkedToId` and `Transaction.label` from Task 1.
- Produces: from `src/lib/links.ts` — `interface LinkSide { id: string; amount: number; linkedToId: string | null }` and `validateLink(refund: LinkSide, target: LinkSide): string | null` (null means valid). `PATCH /api/transactions/:id` accepts `linkedToLabel: number | null`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-links.mjs`:

```js
import { validateLink } from "../src/lib/links.ts";

const purchase = { id: "p1", amount: 84.2, linkedToId: null };
const refund = { id: "r1", amount: -30, linkedToId: null };

test("a refund may link to a purchase", () => {
  assert.equal(validateLink(refund, purchase), null);
});

test("a transaction may not link to itself", () => {
  assert.match(validateLink(refund, refund), /itself/);
});

test("a purchase may not be linked to a purchase", () => {
  assert.match(validateLink(purchase, purchase2()), /money-in/);
});

test("a refund may not link to another refund", () => {
  assert.match(validateLink(refund, { id: "r2", amount: -5, linkedToId: null }), /money out/);
});

test("chains are refused", () => {
  assert.match(
    validateLink(refund, { id: "p2", amount: 10, linkedToId: "p9" }),
    /itself linked/
  );
});

function purchase2() {
  return { id: "p2", amount: 12, linkedToId: null };
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node --test scripts/test-links.mjs`
Expected: FAIL — cannot resolve `../src/lib/links.ts`.

- [ ] **Step 3: Implement the validator**

Create `src/lib/links.ts`:

```ts
/**
 * Refund links: connecting a money-in transaction to the purchase it offsets.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. Formatting and database access belong to the callers.
 *
 * Plaid sign convention throughout: amount > 0 is money out (a purchase),
 * amount < 0 is money in (a refund, payback, or income).
 */

export interface LinkSide {
  id: string;
  amount: number;
  linkedToId: string | null;
}

/**
 * Why a proposed refund-to-purchase link is invalid, or null if it is fine.
 * Chains are refused so a category never has to be resolved through more than
 * one hop.
 */
export function validateLink(refund: LinkSide, target: LinkSide): string | null {
  if (refund.id === target.id) return "A transaction cannot be linked to itself";
  if (refund.amount >= 0) return "Only a money-in transaction can be linked to a purchase";
  if (target.amount <= 0) return "A refund can only be linked to a purchase (money out)";
  if (target.linkedToId !== null) return "That transaction is itself linked to another purchase";
  return null;
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `node --test scripts/test-links.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Accept `linkedToLabel` in the PATCH route**

Replace the body of `PATCH` in `src/app/api/transactions/[id]/route.ts` with this. Note the existing behaviour is preserved exactly when `linkedToLabel` is absent from the body — `undefined` means "leave the link alone", `null` means "unlink".

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { joinCategory } from "@/lib/categories";
import { validateLink } from "@/lib/links";

// PATCH /api/transactions/:id — manually override a transaction's category,
// and/or connect a money-in row to the purchase it offsets.
//   body: { category?: string | null, subcategory?: string | null,
//           linkedToLabel?: number | null }
//
// `linkedToLabel` absent leaves any existing link alone; null unlinks; a number
// links to the transaction carrying that display label. A linked row derives
// its category from its target, so linking clears any category of its own and
// stamps userCategorySource=LINK, which keeps the rules engine off it.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      category?: string | null;
      subcategory?: string | null;
      linkedToLabel?: number | null;
    };

    if (body.linkedToLabel !== undefined) {
      return handleLink(id, body.linkedToLabel);
    }

    const category = body.category?.trim() || null;
    const subcategory = body.subcategory?.trim() || null;
    const userCategory = category ? joinCategory(category, subcategory) : null;

    const { count } = await prisma.transaction.updateMany({
      where: { id },
      data: {
        userCategory,
        userCategorySource: userCategory ? "MANUAL" : null,
      },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, userCategory });
  } catch (err) {
    console.error("[transactions PATCH]", err);
    return NextResponse.json(
      { error: "Failed to update category" },
      { status: 500 }
    );
  }
}

async function handleLink(id: string, label: number | null) {
  const refund = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, amount: true, linkedToId: true },
  });
  if (!refund) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (label === null) {
    await prisma.transaction.update({
      where: { id },
      data: { linkedToId: null, userCategorySource: null },
    });
    return NextResponse.json({ ok: true, linkedTo: null });
  }

  const target = await prisma.transaction.findUnique({
    where: { label },
    select: {
      id: true,
      amount: true,
      linkedToId: true,
      label: true,
      name: true,
      merchantName: true,
    },
  });
  if (!target) {
    return NextResponse.json(
      { error: `No transaction numbered ${label}` },
      { status: 404 }
    );
  }

  const problem = validateLink(refund, target);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  await prisma.transaction.update({
    where: { id },
    data: {
      linkedToId: target.id,
      // The link owns the category now — drop any of this row's own.
      userCategory: null,
      userCategorySource: "LINK",
    },
  });

  return NextResponse.json({
    ok: true,
    linkedTo: {
      id: target.id,
      label: target.label,
      name: target.merchantName ?? target.name,
    },
  });
}
```

- [ ] **Step 6: Verify against the running app**

Start the dev server with the `preview_start` tool (never `npm run dev` in a shell). Pick a real refund and purchase label from the ledger, then:

```bash
curl -s -X PATCH localhost:3000/api/transactions/<refundId> \
  -H 'content-type: application/json' -d '{"linkedToLabel": <purchaseLabel>}'
```
Expected: `{"ok":true,"linkedTo":{...}}`. Then send a purchase's id instead of a refund's and confirm a 400 with the "money-in" message.

- [ ] **Step 7: Commit**

```bash
git add src/lib/links.ts scripts/test-links.mjs "src/app/api/transactions/[id]/route.ts"
git commit -m "Let a refund name the purchase it pays back"
```

---

### Task 3: Resolve a linked row's category, and net it in analytics

**Files:**
- Modify: `src/lib/links.ts`
- Modify: `scripts/test-links.mjs`
- Modify: `src/services/analytics.service.ts:139-192` (`fetchTxInputs`)
- Modify: `src/app/api/transactions/route.ts:44-60` (the `hideInternal` filter)

**Interfaces:**
- Consumes: `validateLink` and the `links.ts` module from Task 2.
- Produces: from `src/lib/links.ts` — `interface ResolvableRow { amount: number; userCategory: string | null; linkedToCategory: string | null }` and `resolveLinkedCategory(row: ResolvableRow): { raw: string | null; isOffset: boolean }`.

`linkedToCategory` is the target's *already-resolved, already-humanized* category string. The caller does that resolution, which is what keeps this module import-free.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-links.mjs`:

```js
import { resolveLinkedCategory } from "../src/lib/links.ts";

test("an unlinked, uncategorized inflow is plain income", () => {
  const r = resolveLinkedCategory({ amount: -30, userCategory: null, linkedToCategory: null });
  assert.equal(r.raw, null);
  assert.equal(r.isOffset, false);
});

test("a categorized inflow offsets its own category", () => {
  const r = resolveLinkedCategory({ amount: -30, userCategory: "Dining", linkedToCategory: null });
  assert.equal(r.raw, "Dining");
  assert.equal(r.isOffset, true);
});

test("a linked inflow inherits its purchase's category, subcategory and all", () => {
  const r = resolveLinkedCategory({
    amount: -30,
    userCategory: null,
    linkedToCategory: "Shopping > Electronics",
  });
  assert.equal(r.raw, "Shopping > Electronics");
  assert.equal(r.isOffset, true);
});

test("a row's own category wins over the link", () => {
  const r = resolveLinkedCategory({
    amount: -30,
    userCategory: "Dining",
    linkedToCategory: "Shopping",
  });
  assert.equal(r.raw, "Dining");
});

test("an outflow is never an offset, however it is categorized", () => {
  const r = resolveLinkedCategory({ amount: 84.2, userCategory: "Shopping", linkedToCategory: null });
  assert.equal(r.isOffset, false);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node --test scripts/test-links.mjs`
Expected: FAIL — `resolveLinkedCategory` is not exported.

- [ ] **Step 3: Implement the resolver**

Append to `src/lib/links.ts`:

```ts
export interface ResolvableRow {
  amount: number;
  userCategory: string | null;
  /** The linked purchase's already-resolved, already-humanized category. */
  linkedToCategory: string | null;
}

export interface ResolvedCategory {
  /** Effective raw category, possibly "Parent > Sub". Null means uncategorized. */
  raw: string | null;
  /**
   * True when this is money-in that should net against its category rather than
   * count as income — a refund, or a payback for something you bought.
   */
  isOffset: boolean;
}

/**
 * A row's effective category. Its own category wins; otherwise it inherits
 * from the purchase it is linked to. Deriving rather than copying means the
 * inherited category cannot go stale, and that linking a refund before
 * categorizing the purchase works exactly as well as the other order.
 */
export function resolveLinkedCategory(row: ResolvableRow): ResolvedCategory {
  const raw = row.userCategory ?? row.linkedToCategory ?? null;
  return { raw, isOffset: row.amount < 0 && raw !== null };
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `node --test scripts/test-links.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Teach analytics about links**

In `src/services/analytics.service.ts`, add to the imports:

```ts
import { resolveLinkedCategory } from "@/lib/links";
```

In `fetchTxInputs`, the first entry of the `AND` array currently reads:

```ts
        { OR: [{ isTransfer: false }, { userCategory: { not: null } }] },
```

Replace it with — and the comment matters, because this is the non-obvious one:

```ts
        // Normal spend (not a transfer), OR any P2P transfer the user has
        // classified — a userCategory promotes a Venmo/Zelle transfer in — OR
        // any row linked to a purchase. Without that last clause a linked Zelle
        // payback (isTransfer, and holding no category of its own) is filtered
        // out before it can offset anything.
        {
          OR: [
            { isTransfer: false },
            { userCategory: { not: null } },
            { linkedToId: { not: null } },
          ],
        },
```

Extend the `select` block with:

```ts
      linkedTo: { select: { userCategory: true, pfcPrimary: true } },
```

Then replace the `return rows.map(...)` body with:

```ts
  return rows.flatMap((r) => {
    // The linked purchase's own effective category, humanized the same way a
    // top-level row's would be.
    const linkedToCategory = r.linkedTo
      ? r.linkedTo.userCategory ?? humanizePfc(r.linkedTo.pfcPrimary)
      : null;
    const { raw, isOffset } = resolveLinkedCategory({
      amount: r.amount,
      userCategory: r.userCategory,
      linkedToCategory,
    });

    // The WHERE clause excludes rows tagged "Transfer" with a string match,
    // which cannot reach through a relation — so a row that inherits
    // "Transfer" has to be dropped here instead.
    if (raw === "Transfer" || raw?.startsWith("Transfer > ")) return [];

    // A user category (Venmo/Zelle/manual/inherited) wins over Plaid's PFC
    // primary. Subcategorized values ("Parent > Sub") roll up to their parent;
    // the sub travels alongside for drill-down views (single-month Sankey).
    const uc = raw ? splitCategory(raw) : null;
    return [{
      amount: r.amount,
      date: r.date,
      category: uc ? uc.parent : humanizePfc(r.pfcPrimary),
      subcategory: uc?.sub ?? null,
      // P2P rows use a person as the "merchant" — keep them out of merchant totals.
      merchant: isP2p(r.source, r.name) ? null : r.merchantName ?? r.name,
      isOffset,
    }];
  });
```

- [ ] **Step 6: Keep linked rows visible in the ledger**

In `src/app/api/transactions/route.ts`, the `hideInternal` block's last `and.push({ OR: [...] })` lists exceptions that survive the transfer filter. Add one more entry to that `OR` array, after the `{ userCategory: { not: null } }` entry:

```ts
          // Keep anything linked to a purchase — a Zelle payback holds no
          // category of its own but is real, netted spend.
          { linkedToId: { not: null } },
```

- [ ] **Step 7: Verify the numbers actually move**

Start the dev server with `preview_start`. Note the Analytics page's total spend and the target category's total. Link a refund to a purchase in that category via the Task 2 curl, reload Analytics, and confirm total spend dropped by the refund amount and the category total dropped by the same. Confirm total income did **not** change.

- [ ] **Step 8: Commit**

```bash
git add src/lib/links.ts scripts/test-links.mjs src/services/analytics.service.ts src/app/api/transactions/route.ts
git commit -m "Net a linked refund against what it paid back"
```

---

### Task 4: Rank the purchases a refund probably belongs to

**Files:**
- Modify: `src/lib/links.ts`
- Modify: `scripts/test-links.mjs`
- Create: `src/app/api/transactions/[id]/link-candidates/route.ts`

**Interfaces:**
- Consumes: `links.ts` from Tasks 2 and 3.
- Produces: from `src/lib/links.ts` — `interface RefundRow`, `interface CandidateRow`, `scoreCandidate(refund: RefundRow, c: CandidateRow): number` (negative means "not a candidate"), and `rankCandidates(refund: RefundRow, rows: CandidateRow[], limit?: number): CandidateRow[]`. Endpoint `GET /api/transactions/:id/link-candidates` returning `{ candidates: LinkCandidate[] }` where `LinkCandidate = { id: string; label: number | null; date: string; name: string; amount: number; category: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-links.mjs`:

```js
import { scoreCandidate, rankCandidates } from "../src/lib/links.ts";

const base = {
  date: new Date("2026-09-10"),
  amount: -30,
  name: "Amazon refund",
  merchantName: "Amazon",
  counterparty: null,
};

const cand = (over) => ({
  id: "c",
  label: 1,
  date: new Date("2026-09-01"),
  name: "Amazon Marketplace",
  merchantName: "Amazon",
  counterparty: null,
  amount: 84.2,
  ...over,
});

test("a purchase after the refund is not a candidate", () => {
  assert.ok(scoreCandidate(base, cand({ date: new Date("2026-09-20") })) < 0);
});

test("a purchase beyond the 90 day window is not a candidate", () => {
  assert.ok(scoreCandidate(base, cand({ date: new Date("2026-01-01") })) < 0);
});

test("a same-merchant purchase outranks a stranger on the same day", () => {
  const same = scoreCandidate(base, cand({}));
  const other = scoreCandidate(base, cand({ merchantName: "Shell", name: "Shell Oil" }));
  assert.ok(same > other);
});

test("a purchase that covers the refund outranks one that cannot", () => {
  const covers = scoreCandidate(base, cand({ amount: 84.2 }));
  const tooSmall = scoreCandidate(base, cand({ amount: 4 }));
  assert.ok(covers > tooSmall);
});

test("a recent purchase outranks an older identical one", () => {
  const recent = scoreCandidate(base, cand({ date: new Date("2026-09-08") }));
  const older = scoreCandidate(base, cand({ date: new Date("2026-07-08") }));
  assert.ok(recent > older);
});

test("ranking drops non-candidates and caps the list", () => {
  const rows = [
    cand({ id: "future", date: new Date("2026-09-20") }),
    cand({ id: "a" }),
    cand({ id: "b", merchantName: "Shell", name: "Shell Oil" }),
  ];
  const out = rankCandidates(base, rows, 2);
  assert.equal(out.length, 2);
  assert.ok(!out.some((r) => r.id === "future"));
  assert.equal(out[0].id, "a");
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node --test scripts/test-links.mjs`
Expected: FAIL — `scoreCandidate` is not exported.

- [ ] **Step 3: Implement the ranking**

Append to `src/lib/links.ts`:

```ts
export interface RefundRow {
  date: Date;
  amount: number; // negative
  name: string;
  merchantName: string | null;
  counterparty: string | null;
}

export interface CandidateRow {
  id: string;
  label: number | null;
  date: Date;
  name: string;
  merchantName: string | null;
  counterparty: string | null;
  amount: number; // positive
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;
const CENT = 0.005;

// Words too common to mean two descriptions are about the same thing.
const STOPWORDS = new Set([
  "the", "and", "for", "from", "payment", "purchase", "refund", "return",
  "inc", "llc", "com", "online", "store", "card", "pos",
]);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function party(r: { merchantName: string | null; counterparty: string | null }): string {
  return (r.counterparty ?? r.merchantName ?? "").trim().toLowerCase();
}

/**
 * How likely `c` is the purchase behind `refund` — higher is better, negative
 * means "not a candidate at all".
 *
 * Signals, in descending weight: the same merchant or person (+3), a shared
 * distinctive word in the description (+2), a purchase large enough to cover
 * the refund (+2), and recency decaying across the window (0 to 2).
 *
 * On a Venmo or Zelle payback the counterparty is a person, so the party
 * signal rarely fires against a card purchase — recency and amount carry it.
 */
export function scoreCandidate(refund: RefundRow, c: CandidateRow): number {
  const days = (refund.date.getTime() - c.date.getTime()) / DAY_MS;
  if (days < 0 || days > WINDOW_DAYS) return -1;

  let score = ((WINDOW_DAYS - days) / WINDOW_DAYS) * 2;

  const p = party(refund);
  if (p.length > 0 && p === party(c)) score += 3;

  const refundWords = words(refund.name);
  for (const w of words(c.name)) {
    if (refundWords.has(w)) {
      score += 2;
      break;
    }
  }

  if (Math.abs(refund.amount) <= c.amount + CENT) score += 2;

  return score;
}

/** The best candidate purchases for a refund, best first. */
export function rankCandidates(
  refund: RefundRow,
  rows: CandidateRow[],
  limit = 5
): CandidateRow[] {
  return rows
    .map((c) => ({ c, score: scoreCandidate(refund, c) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || b.c.date.getTime() - a.c.date.getTime())
    .slice(0, limit)
    .map((x) => x.c);
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `node --test scripts/test-links.mjs`
Expected: PASS, 18 tests.

- [ ] **Step 5: Add the endpoint**

Create `src/app/api/transactions/[id]/link-candidates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { humanizePfc } from "@/lib/format";
import { rankCandidates } from "@/lib/links";

// GET /api/transactions/:id/link-candidates — the purchases this money-in row
// most likely pays back, best first. Queried server-side rather than filtered
// from the loaded page, because the purchase behind a refund is often months
// back and several pages away.
const WINDOW_DAYS = 90;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const refund = await prisma.transaction.findUnique({
      where: { id },
      select: {
        date: true,
        amount: true,
        name: true,
        merchantName: true,
        counterparty: true,
      },
    });
    if (!refund) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (refund.amount >= 0) {
      return NextResponse.json({ candidates: [] });
    }

    const since = new Date(refund.date.getTime() - WINDOW_DAYS * 86_400_000);
    const rows = await prisma.transaction.findMany({
      where: {
        amount: { gt: 0 },
        date: { gte: since, lte: refund.date },
        linkedToId: null,
        isFee: false,
        pending: false,
      },
      select: {
        id: true,
        label: true,
        date: true,
        name: true,
        merchantName: true,
        counterparty: true,
        amount: true,
        userCategory: true,
        pfcPrimary: true,
      },
    });

    const candidates = rankCandidates(refund, rows).map((c) => {
      const row = rows.find((r) => r.id === c.id)!;
      return {
        id: row.id,
        label: row.label,
        date: row.date.toISOString(),
        name: row.merchantName ?? row.name,
        amount: row.amount,
        category: row.userCategory ?? humanizePfc(row.pfcPrimary),
      };
    });

    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[link-candidates]", err);
    return NextResponse.json(
      { error: "Failed to load candidates" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 6: Verify against real data**

With the dev server running, pick a real refund id from the ledger:

```bash
curl -s localhost:3000/api/transactions/<refundId>/link-candidates | head -c 600
```
Expected: up to 5 candidates, best first, each a purchase dated on or before the refund. Sanity-check that the top hit is plausible.

- [ ] **Step 7: Commit**

```bash
git add src/lib/links.ts scripts/test-links.mjs "src/app/api/transactions/[id]/link-candidates/route.ts"
git commit -m "Suggest which purchase a refund probably belongs to"
```

---

### Task 5: Carry labels, links and net amounts in the transactions API

**Files:**
- Modify: `src/lib/links.ts`
- Modify: `scripts/test-links.mjs`
- Modify: `src/types/index.ts` (`TransactionDTO`)
- Modify: `src/app/api/transactions/route.ts` (the `rows.map` at the end of `GET`)

**Interfaces:**
- Consumes: `resolveLinkedCategory` from Task 3.
- Produces: `netAmount(amount: number, refunds: { amount: number }[]): number` from `src/lib/links.ts`. `TransactionDTO` gains `label: number | null`, `linkedTo: LinkedTargetDTO | null`, `refunds: RefundDTO[]`, `netAmount: number`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-links.mjs`:

```js
import { netAmount } from "../src/lib/links.ts";

test("a purchase with no refunds nets to itself", () => {
  assert.equal(netAmount(84.2, []), 84.2);
});

test("refunds reduce a purchase's net cost", () => {
  assert.equal(netAmount(84.2, [{ amount: -30 }, { amount: -4.2 }]), 50);
});

test("over-refunding is allowed and goes negative", () => {
  assert.equal(netAmount(10, [{ amount: -15 }]), -5);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node --test scripts/test-links.mjs`
Expected: FAIL — `netAmount` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/lib/links.ts`:

```ts
/**
 * What a purchase actually cost after the refunds linked to it. Refund amounts
 * are negative (money in), so summing them in reduces the total. Over-refunding
 * is allowed and simply goes negative.
 */
export function netAmount(amount: number, refunds: { amount: number }[]): number {
  const sum = refunds.reduce((total, r) => total + r.amount, amount);
  return Math.round(sum * 100) / 100;
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `node --test scripts/test-links.mjs`
Expected: PASS, 21 tests.

- [ ] **Step 5: Extend the DTO types**

In `src/types/index.ts`, add above `TransactionDTO`:

```ts
/** The purchase a refund is linked to, as shown on the refund's row. */
export interface LinkedTargetDTO {
  id: string;
  label: number | null;
  name: string;
  category: string;
}

/** A refund linked to a purchase, as listed under that purchase. */
export interface RefundDTO {
  id: string;
  label: number | null;
  date: string; // ISO
  amount: number; // negative (money in)
  name: string;
}
```

And inside `TransactionDTO`, after the `source` field:

```ts
  label: number | null; // permanent display serial, shown left of the date
  // Set on a money-in row connected to the purchase it pays back. While set,
  // this row's category is the purchase's.
  linkedTo: LinkedTargetDTO | null;
  refunds: RefundDTO[]; // on a purchase: the refunds linked to it
  netAmount: number; // amount less any linked refunds; equals amount when none
```

- [ ] **Step 6: Populate them in the route**

In `src/app/api/transactions/route.ts`, add to the imports:

```ts
import { netAmount, resolveLinkedCategory } from "@/lib/links";
import type { LinkedTargetDTO, RefundDTO } from "@/types";
```

After the `const breakdowns = await getCashoutBreakdowns(cashoutCandidates);` line, insert:

```ts
    // Two extra queries per page: the refunds hanging off the purchases shown
    // here, and the purchases that the refunds shown here point at.
    const pageIds = rows.map((r) => r.id);
    const targetIds = [
      ...new Set(rows.map((r) => r.linkedToId).filter((v): v is string => v !== null)),
    ];
    const [refundRows, targetRows] = await Promise.all([
      prisma.transaction.findMany({
        where: { linkedToId: { in: pageIds } },
        select: {
          id: true, label: true, date: true, amount: true,
          name: true, merchantName: true, linkedToId: true,
        },
        orderBy: { date: "asc" },
      }),
      targetIds.length
        ? prisma.transaction.findMany({
            where: { id: { in: targetIds } },
            select: {
              id: true, label: true, name: true, merchantName: true,
              userCategory: true, pfcPrimary: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const refundsByPurchase = new Map<string, RefundDTO[]>();
    for (const r of refundRows) {
      const list = refundsByPurchase.get(r.linkedToId!) ?? [];
      list.push({
        id: r.id,
        label: r.label,
        date: r.date.toISOString(),
        amount: r.amount,
        name: r.merchantName ?? r.name,
      });
      refundsByPurchase.set(r.linkedToId!, list);
    }

    const targetsById = new Map<string, LinkedTargetDTO>(
      targetRows.map((t) => [
        t.id,
        {
          id: t.id,
          label: t.label,
          name: t.merchantName ?? t.name,
          category: t.userCategory ?? humanizePfc(t.pfcPrimary),
        },
      ])
    );
```

Then inside the `rows.map((t) => {` callback, replace the two lines that compute `uc`:

```ts
      const uc = t.userCategory ? splitCategory(t.userCategory) : null;
```

with:

```ts
      const linkedTo = t.linkedToId ? targetsById.get(t.linkedToId) ?? null : null;
      const refunds = refundsByPurchase.get(t.id) ?? [];
      // A linked row shows its purchase's category; otherwise its own override.
      const { raw } = resolveLinkedCategory({
        amount: t.amount,
        userCategory: t.userCategory,
        linkedToCategory: linkedTo?.category ?? null,
      });
      const uc = raw ? splitCategory(raw) : null;
```

and add these four fields to the returned object, after `source: t.source,`:

```ts
        label: t.label,
        linkedTo,
        refunds,
        netAmount: netAmount(t.amount, refunds),
```

- [ ] **Step 7: Verify the shape**

```bash
curl -s 'localhost:3000/api/transactions?limit=3' | head -c 900
```
Expected: each row carries `label`, `linkedTo`, `refunds` and `netAmount`. Fetch a page containing the refund you linked in Task 2 and confirm its `linkedTo` is populated and the purchase's `netAmount` is below its `amount`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/links.ts scripts/test-links.mjs src/types/index.ts src/app/api/transactions/route.ts
git commit -m "Send a transaction's number, link and net cost to the client"
```

---

### Task 6: Show the number, the net, and the refunds in the ledger

No new logic — presentation only, on top of the DTO from Task 5.

**Files:**
- Modify: `src/components/TransactionTable.tsx`

**Interfaces:**
- Consumes: `TransactionDTO.label`, `.linkedTo`, `.refunds`, `.netAmount` from Task 5.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the `#` column**

In the `<thead>` row, before the `Date` header:

```tsx
            <th className="px-4 py-3 font-medium">#</th>
```

In the `<tbody>` row, before the date `<td>`:

```tsx
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-black/35 dark:text-white/35">
                    {t.label ?? "—"}
                  </td>
```

- [ ] **Step 2: Widen the expand affordance and fix the colspan**

Replace:

```tsx
            const hasBreakdown = t.breakdown !== null;
```

with:

```tsx
            const hasBreakdown = t.breakdown !== null;
            const hasRefunds = t.refunds.length > 0;
            const isExpandable = hasBreakdown || hasRefunds;
```

Then in that row's JSX replace every `hasBreakdown` used for *expansion* — the `className` ternary, the `onClick`, and the `▾`/`▸` caret — with `isExpandable`. Leave the `hasBreakdown` checks that render the "N categories" badge and the `BreakdownPanel` alone.

The expanded `<tr>` currently renders only when `hasBreakdown && isOpen`. Replace that block with:

```tsx
                {isExpandable && isOpen && (
                  <tr className="border-b border-black/[0.06] bg-black/[0.015] dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <td colSpan={5} className="px-4 py-3">
                      {hasBreakdown && <BreakdownPanel breakdown={t.breakdown!} />}
                      {hasRefunds && <RefundPanel refunds={t.refunds} />}
                    </td>
                  </tr>
                )}
```

Note `colSpan={5}` — the `#` column made it one wider.

- [ ] **Step 3: Show the net on a refunded purchase**

Replace the amount `<td>` with:

```tsx
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums ${
                      isOutflow
                        ? "text-black/80 dark:text-white/80"
                        : "text-green-600 dark:text-green-400"
                    }`}
                  >
                    {text}
                    {hasRefunds && (
                      <div className="text-xs font-normal text-green-600 dark:text-green-400">
                        net {formatCurrency(t.netAmount)}
                      </div>
                    )}
                  </td>
```

- [ ] **Step 4: Mark a linked refund**

In the description cell's badge row, after the Venmo/Zelle badges:

```tsx
                      {t.linkedTo && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          → #{t.linkedTo.label ?? "?"} {t.linkedTo.name}
                        </span>
                      )}
```

- [ ] **Step 5: Add the refund panel**

Next to `BreakdownPanel`, add:

```tsx
function RefundPanel({ refunds }: { refunds: TransactionDTO["refunds"] }) {
  return (
    <div className="pl-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
        Paid back by
      </p>
      <ul className="space-y-1">
        {refunds.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-black/70 dark:text-white/70">
              <span className="font-mono text-xs text-black/35 dark:text-white/35">
                #{r.label ?? "—"}
              </span>{" "}
              {formatDate(r.date)} · {r.name}
            </span>
            <span className="font-mono tabular-nums text-green-600 dark:text-green-400">
              {formatCurrency(Math.abs(r.amount))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Verify in the browser**

With the dev server running, open the Transactions page in the preview. Confirm: a `#` column sits left of Date with descending numbers; the purchase you linked in Task 2 shows a `net` line and expands to a "Paid back by" list; the refund row carries a green `→ #N` chip. Take a screenshot. Check `read_console_messages` for errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/TransactionTable.tsx
git commit -m "Show a transaction's number and what a purchase really cost"
```

---

### Task 7: The link picker, wired into the ledger's category editor

**Files:**
- Create: `src/components/TransactionLinkPicker.tsx`
- Modify: `src/components/TransactionTable.tsx` (`CategoryEditor`, and the row that renders it)

**Interfaces:**
- Consumes: `GET /api/transactions/:id/link-candidates` (Task 4), `PATCH /api/transactions/:id` with `linkedToLabel` (Task 2).
- Produces: `TransactionLinkPicker` with props `{ transactionId: string; linkedTo: LinkedTargetDTO | null; onLinked: (linked: { label: number | null; name: string } | null) => void }`. Task 8 reuses it unchanged.

- [ ] **Step 1: Write the picker**

Create `src/components/TransactionLinkPicker.tsx`:

```tsx
"use client";

import { useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import type { LinkedTargetDTO } from "@/types";

interface Candidate {
  id: string;
  label: number | null;
  date: string;
  name: string;
  amount: number;
  category: string;
}

/**
 * Connects a money-in row to the purchase it pays back. Suggestions come from
 * the server ranked, because the purchase behind a refund is usually not on the
 * page you are looking at; the number field is the escape hatch for the rest.
 */
export function TransactionLinkPicker({
  transactionId,
  linkedTo,
  onLinked,
}: {
  transactionId: string;
  linkedTo: LinkedTargetDTO | null;
  onLinked: (linked: { label: number | null; name: string } | null) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (label: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${transactionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedToLabel: label }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not connect");
      onLinked(body.linkedTo ?? null);
      setOpen(false);
      setTyped("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  const openPicker = async () => {
    setOpen(true);
    if (candidates !== null) return;
    try {
      const res = await fetch(`/api/transactions/${transactionId}/link-candidates`);
      const body = await res.json();
      setCandidates(res.ok ? body.candidates : []);
    } catch {
      setCandidates([]);
    }
  };

  if (linkedTo) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-black/45 dark:text-white/45">Pays back</span>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          #{linkedTo.label ?? "?"} {linkedTo.name} · {linkedTo.category}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => save(null)}
          className="rounded px-1.5 py-0.5 text-black/50 hover:bg-black/[0.06] disabled:opacity-50 dark:text-white/50 dark:hover:bg-white/10"
        >
          Disconnect
        </button>
        {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPicker}
        className="text-xs text-black/45 underline-offset-2 hover:underline dark:text-white/45"
      >
        Connect to a purchase…
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="text-black/45 dark:text-white/45">Connect to a purchase</span>
      {candidates === null ? (
        <span className="text-black/40 dark:text-white/40">Looking…</span>
      ) : candidates.length === 0 ? (
        <span className="text-black/40 dark:text-white/40">
          No likely purchase found — enter a number below.
        </span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => save(c.label)}
              className="rounded border border-black/15 px-1.5 py-1 text-left hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/[0.06]"
            >
              <span className="font-mono text-black/40 dark:text-white/40">#{c.label}</span>{" "}
              {formatDate(c.date)} · {c.name} · {formatCurrency(c.amount)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-black/40 dark:text-white/40">#</span>
        <input
          type="number"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed) save(Number(typed));
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="number"
          disabled={busy}
          className="w-24 rounded border border-black/15 bg-white px-1.5 py-1 dark:border-white/20 dark:bg-neutral-900"
        />
        <button
          type="button"
          disabled={busy || !typed}
          onClick={() => save(Number(typed))}
          className="rounded bg-black px-2 py-1 font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-1 text-black/50 hover:bg-black/[0.04] dark:text-white/50"
        >
          Cancel
        </button>
      </div>
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Put it in the category editor**

In `src/components/TransactionTable.tsx`, import it:

```tsx
import { TransactionLinkPicker } from "./TransactionLinkPicker";
```

Give `CategoryEditor` two more props in its signature and its prop type — `linkedTo: TransactionDTO["linkedTo"]` and `onLinked: (linked: { label: number | null; name: string } | null) => void`.

Inside `CategoryEditor`, disable the category controls while the row is linked — add `const locked = linkedTo !== null;` at the top, then change both the `<select>` and the `<input>` to `disabled={saving || locked}`.

At the end of the returned `<div>`, after the error span, add:

```tsx
      {transaction.amount < 0 && (
        <div className="mt-1 w-full border-t border-black/[0.06] pt-1.5 dark:border-white/[0.06]">
          <TransactionLinkPicker
            transactionId={transaction.id}
            linkedTo={linkedTo}
            onLinked={onLinked}
          />
        </div>
      )}
```

- [ ] **Step 3: Pass the props through**

At the `<CategoryEditor ... />` call site, add:

```tsx
                        linkedTo={t.linkedTo}
                        onLinked={() => {
                          setEditing(null);
                          onChanged();
                        }}
```

`TransactionTable` does not currently refetch. Add an `onChanged: () => void` prop to `TransactionTable`, and in `TransactionLedger` pass `onChanged={load}` — a link changes another row's net amount, so an optimistic patch of one row is not enough. This means editing `src/components/TransactionLedger.tsx` too.

- [ ] **Step 4: Verify in the browser**

In the preview, click the category line of a money-in row. Confirm the "Connect to a purchase…" line appears below the subcategory field and that it does **not** appear on an outflow row. Open it, confirm suggestions load, click one. Confirm the table refetches, the refund now shows `→ #N`, the purchase shows its net, and the refund's category matches the purchase's. Screenshot. Check the console for errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/TransactionLinkPicker.tsx src/components/TransactionTable.tsx src/components/TransactionLedger.tsx
git commit -m "Connect a refund to its purchase from the ledger"
```

---

### Task 8: Numbers and links on the Venmo and Zelle pages

**Files:**
- Modify: `src/app/api/venmo/route.ts`
- Modify: `src/app/api/zelle/route.ts`
- Modify: `src/app/api/zelle/[id]/route.ts` (guard)
- Modify: `src/app/api/venmo/[id]/route.ts` (guard)
- Modify: `src/components/P2pCategorizer.tsx`

**Interfaces:**
- Consumes: `TransactionLinkPicker` from Task 7, `resolveLinkedCategory` from Task 3.
- Produces: nothing other tasks depend on.

Both P2P pages link through `PATCH /api/transactions/:id` — Venmo and Zelle rows are already `Transaction`s, so a second linking endpoint would only duplicate the validation.

- [ ] **Step 1: Return labels and links from the Venmo route**

In `src/app/api/venmo/route.ts`, add to the imports:

```ts
import { humanizePfc } from "@/lib/format";
import { resolveLinkedCategory } from "@/lib/links";
```

Add to the `select`: `label: true`, `linkedToId: true`, and

```ts
        linkedTo: {
          select: { id: true, label: true, name: true, merchantName: true,
                    userCategory: true, pfcPrimary: true },
        },
```

Replace the `transactions` mapping's `category` line and add the new fields:

```ts
    const transactions = rows.map((t) => {
      const linkedToCategory = t.linkedTo
        ? t.linkedTo.userCategory ?? humanizePfc(t.linkedTo.pfcPrimary)
        : null;
      const { raw } = resolveLinkedCategory({
        amount: t.amount,
        userCategory: t.userCategory,
        linkedToCategory,
      });
      return {
        id: t.id,
        label: t.label,
        date: t.date.toISOString(),
        note: t.name,
        counterparty: t.counterparty,
        direction: t.amount > 0 ? ("out" as const) : ("in" as const),
        amount: Math.abs(t.amount),
        // Reporting the inherited category here keeps the page's "Received
        // (categorized)" and "Net spend" totals right with no special-casing —
        // a linked row simply is not Uncategorized.
        category: raw ?? "Other",
        linkedTo: t.linkedTo
          ? {
              id: t.linkedTo.id,
              label: t.linkedTo.label,
              name: t.linkedTo.merchantName ?? t.linkedTo.name,
              category: linkedToCategory ?? "Uncategorized",
            }
          : null,
        pooledIntoCashout: Boolean(t.fundsCashoutId),
      };
    });
```

- [ ] **Step 2: Return labels and links from the Zelle route**

In `src/app/api/zelle/route.ts`, add to the imports:

```ts
import { humanizePfc } from "@/lib/format";
import { resolveLinkedCategory } from "@/lib/links";
```

Add to the `select`: `label: true`, `linkedToId: true`, and

```ts
        linkedTo: {
          select: { id: true, label: true, name: true, merchantName: true,
                    userCategory: true, pfcPrimary: true },
        },
```

Then replace the whole `const transactions = rows.filter(...).map(...)` expression with:

```ts
    const transactions = rows
      .filter((t) => isZelleName(t.name))
      .map((t) => {
        const linkedToCategory = t.linkedTo
          ? t.linkedTo.userCategory ?? humanizePfc(t.linkedTo.pfcPrimary)
          : null;
        const { raw } = resolveLinkedCategory({
          amount: t.amount,
          userCategory: t.userCategory,
          linkedToCategory,
        });
        return {
          id: t.id,
          label: t.label,
          date: t.date.toISOString(),
          note: "", // Zelle has no memo in the bank feed
          counterparty: parseZelleCounterparty(t.name),
          direction: t.amount > 0 ? ("out" as const) : ("in" as const),
          amount: Math.abs(t.amount),
          // Reporting the inherited category here keeps the page's totals right
          // with no special-casing — a linked row simply is not Uncategorized.
          category: raw ?? "Uncategorized",
          linkedTo: t.linkedTo
            ? {
                id: t.linkedTo.id,
                label: t.linkedTo.label,
                name: t.linkedTo.merchantName ?? t.linkedTo.name,
                category: linkedToCategory ?? "Uncategorized",
              }
            : null,
        };
      });
```

- [ ] **Step 3: Stop the P2P category routes clobbering a linked row**

In `src/app/api/zelle/[id]/route.ts`, change the `updateMany` where clause to:

```ts
      // A linked row derives its category from its purchase — refuse to
      // overwrite it here. (This route sets userCategory with no source guard,
      // so without this the derived category would be silently replaced.)
      where: { id, source: "PLAID", linkedToId: null },
```

Make the same `linkedToId: null` addition in `src/app/api/venmo/[id]/route.ts`, whose where clause becomes `{ id, source: "VENMO", linkedToId: null }`.

- [ ] **Step 4: Show the number and picker in the P2P table**

In `src/components/P2pCategorizer.tsx`:

Add the import:

```tsx
import { TransactionLinkPicker } from "./TransactionLinkPicker";
```

Extend the `P2pTx` interface:

```tsx
  label: number | null;
  linkedTo: { id: string; label: number | null; name: string; category: string } | null;
```

Add a header cell before `Date`:

```tsx
                  <th className="px-4 py-3 font-medium">#</th>
```

And a body cell before the date cell:

```tsx
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-black/35 dark:text-white/35">
                      {t.label ?? "—"}
                    </td>
```

Replace the category `<td>`'s contents with the select plus, for money-in rows, the picker:

```tsx
                    <td className="px-4 py-3">
                      <select
                        value={t.category}
                        disabled={t.linkedTo !== null}
                        onChange={(e) => updateCategory(t.id, e.target.value)}
                        className={`rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/40 disabled:opacity-60 dark:border-white/15 dark:focus:border-white/40 ${
                          IGNORED.has(t.category)
                            ? "text-black/40 dark:text-white/40"
                            : ""
                        }`}
                      >
                        {data.categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                        {/* A linked row shows an inherited category that may not
                            be in this page's fixed list. */}
                        {!data.categories.includes(t.category) && (
                          <option value={t.category}>{t.category}</option>
                        )}
                      </select>
                      {t.direction === "in" && (
                        <div className="mt-1">
                          <TransactionLinkPicker
                            transactionId={t.id}
                            linkedTo={t.linkedTo}
                            onLinked={load}
                          />
                        </div>
                      )}
                    </td>
```

`load` is already in scope and refetches the page, which is what a link needs — the row's category changes too.

- [ ] **Step 5: Verify both pages in the browser**

In the preview, open `/venmo` and `/zelle`. On each: confirm the `#` column, confirm the picker appears on received rows only, link one to a card purchase from the main ledger, and confirm the row's category flips to the purchase's and the dropdown goes disabled. Then check the Transactions page shows that purchase's net. Screenshot both. Check the console.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/venmo src/app/api/zelle src/components/P2pCategorizer.tsx
git commit -m "Connect Venmo and Zelle paybacks to what they cover"
```

---

### Task 9: Full verification and rebuild

**Files:** none modified unless a check fails.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: the two bash suites pass and all 21 link tests pass.

- [ ] **Step 2: Lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```
Expected: clean. A `colSpan` or a prop type missed in Tasks 6 to 8 surfaces here.

- [ ] **Step 3: Confirm labels stayed sound**

```bash
npx prisma db execute --stdin <<'SQL'
SELECT COUNT(*) rows, COUNT(DISTINCT label) labels FROM "Transaction";
SELECT COUNT(*) AS bad_links FROM "Transaction" a JOIN "Transaction" b ON a.linkedToId = b.id
  WHERE a.amount >= 0 OR b.amount <= 0 OR b.linkedToId IS NOT NULL;
SQL
```
Expected: `rows` = `labels`, and `bad_links` = 0.

- [ ] **Step 4: Rebuild the served bundle**

Run: `bash Budget.command --no-open`
Expected: a successful build. Budget serves a prebuilt bundle, so skipping this serves stale code.

- [ ] **Step 5: Commit anything the checks changed**

```bash
git status --short
```
If clean, nothing to do. Otherwise commit the fixes with a message describing what the check caught.
