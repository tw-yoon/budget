# Payment Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one transaction report itself to Analytics under several categories — carve-outs the user types, plus a derived remainder — without ever becoming more than one row.

**Architecture:** A new `TransactionSplit` table stores only the carve-outs. The remainder is computed as `amount - sum(parts)` and wears the row's current effective category, so amount drift and recategorization need no maintenance. A single import-free helper, `sliceTransaction`, turns a row plus its parts into the list of `(amount, category)` slices every consumer reads, so Analytics and the card-rewards math can never disagree about what a transaction was.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 5 over SQLite, Tailwind 4, `node --test` against import-free modules under `src/lib/`.

**Spec:** `docs/superpowers/specs/2026-09-18-payment-splits-design.md`

## Global Constraints

- **Read the bundled Next docs before writing routing code.** `AGENTS.md` requires it: this is Next 16.2.9 and its APIs differ from training data. Relevant files are `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/permanentRedirect.md` and `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
- **Files under `src/lib/` that `node --test` loads must have zero imports.** Node's native type stripping cannot resolve the `@/` path alias. This governs `links.ts`, `labels.ts`, `analytics-mode.ts`, and the new `splits.ts` and `pro-mode.ts`.
- **Plaid sign convention throughout:** `amount > 0` is money out. Carve-out amounts are always positive.
- **Money rounds to cents** via `Math.round(n * 100) / 100`. A tolerance of `CENT = 0.005` decides whether a remainder is zero.
- **Splits are money-out, non-pending rows only.**
- **Stored preference key migration is additive.** The old `analytics-mode` key is read as a fallback and left in place, never deleted.
- **Start `npm run dev` in the background**, never in the foreground — a
  foreground dev server never returns and hangs the task. Use the Bash tool's
  `run_in_background`, verify with curl, and stop it when the step is done.
- **Run `bash Budget.command --no-open` after code changes** — Budget serves a prebuilt bundle and this rebuilds it.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Branch:** all work lands on `payment-splits`, already created off `main`.

---

## File Structure

**Created:**
- `src/lib/splits.ts` — pure split arithmetic and validation. Zero imports.
- `scripts/test-splits.mjs` — `node --test` suite for the above.
- `src/lib/pro-mode.ts` — the app-wide Pro preference. Zero imports. Replaces `analytics-mode.ts`.
- `scripts/test-pro-mode.mjs` — replaces `test-analytics-mode.mjs`.
- `src/components/useProMode.ts` — replaces `useAnalyticsMode.ts`.
- `src/components/SettingsMode.tsx` — replaces `SettingsAnalytics.tsx`.
- `src/app/settings/mode/page.tsx` — the new Settings section.
- `src/app/api/transactions/[id]/splits/route.ts` — `POST` a carve-out.
- `src/app/api/transactions/[id]/splits/[splitId]/route.ts` — `DELETE` one.
- `prisma/migrations/<timestamp>_payment_splits/migration.sql`

**Modified:**
- `prisma/schema.prisma` — the `TransactionSplit` model and its back-relation.
- `src/services/analytics.service.ts` — `fetchTxInputs` emits one `TxInput` per slice.
- `src/services/benefits.service.ts` — `computeEarnings` buckets slices.
- `src/services/categories.service.ts` — the rename/merge/delete cascade reaches parts.
- `src/app/api/transactions/route.ts` — the DTO carries parts and the remainder.
- `src/types/index.ts` — `SplitPartDTO`, and two fields on `TransactionDTO`.
- `src/components/TransactionTable.tsx` — a `SplitPanel` beside the existing panels.
- `src/app/settings/analytics/page.tsx` — becomes a permanent redirect.
- `src/components/SideNav.tsx`, `src/components/AnalyticsDashboard.tsx` — follow the rename.
- `package.json` — the `test` script gains `test-splits.mjs` and swaps in `test-pro-mode.mjs`.

---

### Task 1: Split arithmetic

The whole feature's logic, with no database and no React. Everything downstream consumes `sliceTransaction`.

**Files:**
- Create: `src/lib/splits.ts`
- Create: `scripts/test-splits.mjs`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SplitPart { amount: number; userCategory: string }`
  - `interface SliceRow { amount: number; effectiveCategory: string }`
  - `interface SplitTarget { amount: number; pending: boolean }`
  - `interface Slice { amount: number; userCategory: string; isRemainder: boolean }`
  - `remainderOf(amount: number, parts: { amount: number }[]): number`
  - `sliceTransaction(row: SliceRow, parts: SplitPart[]): Slice[]`
  - `validateNewSplit(row: SplitTarget, existing: { amount: number }[], proposed: { amount: number; userCategory: string }): string | null`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-splits.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  remainderOf,
  sliceTransaction,
  validateNewSplit,
} from "../src/lib/splits.ts";

const target = { amount: 100, pending: false };
const row = { amount: 100, effectiveCategory: "General Merchandise" };
const part = (amount, userCategory, id = "p1") => ({ id, amount, userCategory });

test("an unsplit row is one slice under its own category", () => {
  assert.deepEqual(sliceTransaction(row, []), [
    { amount: 100, userCategory: "General Merchandise", isRemainder: true },
  ]);
});

test("a carve-out leaves the rest under the row's category", () => {
  assert.deepEqual(sliceTransaction(row, [part(30, "Food")]), [
    { amount: 30, userCategory: "Food", isRemainder: false },
    { amount: 70, userCategory: "General Merchandise", isRemainder: true },
  ]);
});

test("carve-outs accumulate and the remainder shrinks", () => {
  const parts = [part(30, "Food", "a"), part(25, "Home Improvement", "b")];
  assert.deepEqual(sliceTransaction(row, parts), [
    { amount: 30, userCategory: "Food", isRemainder: false },
    { amount: 25, userCategory: "Home Improvement", isRemainder: false },
    { amount: 45, userCategory: "General Merchandise", isRemainder: true },
  ]);
});

test("an exhausted remainder is omitted rather than shown as zero", () => {
  const slices = sliceTransaction(row, [part(100, "Food")]);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].isRemainder, false);
});

test("float drift never leaves a phantom remainder", () => {
  // 0.1 + 0.2 === 0.30000000000000004 in binary floating point.
  const cents = { amount: 0.3, effectiveCategory: "General Merchandise" };
  const parts = [part(0.1, "Food", "a"), part(0.2, "Food", "b")];
  assert.equal(sliceTransaction(cents, parts).length, 2);
});

test("a subcategorized part keeps its full category", () => {
  const slices = sliceTransaction(row, [part(30, "Food > Groceries")]);
  assert.equal(slices[0].userCategory, "Food > Groceries");
});

test("the remainder absorbs an amount revision", () => {
  const posted = { amount: 103.47, effectiveCategory: "General Merchandise" };
  const slices = sliceTransaction(posted, [part(30, "Food")]);
  assert.equal(slices[0].amount, 30);
  assert.equal(slices[1].amount, 73.47);
});

test("a revision below the carve-outs gives a negative remainder", () => {
  const shrunk = { amount: 20, effectiveCategory: "General Merchandise" };
  const slices = sliceTransaction(shrunk, [part(30, "Food")]);
  assert.equal(slices[1].amount, -10);
  assert.equal(slices[1].isRemainder, true);
});

test("slices always sum back to the transaction", () => {
  const parts = [part(30, "Food", "a"), part(25, "Travel", "b")];
  const total = sliceTransaction(row, parts).reduce((s, x) => s + x.amount, 0);
  assert.equal(Math.round(total * 100) / 100, row.amount);
});

test("remainderOf reports what is left", () => {
  assert.equal(remainderOf(100, [{ amount: 30 }]), 70);
  assert.equal(remainderOf(100, []), 100);
  assert.equal(remainderOf(100, [{ amount: 30 }, { amount: 80 }]), -10);
});

test("a valid carve-out is accepted", () => {
  assert.equal(validateNewSplit(target, [], { amount: 30, userCategory: "Food" }), null);
  assert.equal(
    validateNewSplit(target, [{ amount: 30 }], { amount: 70, userCategory: "Food" }),
    null
  );
});

test("money-in rows cannot be split", () => {
  const refund = { amount: -50, pending: false };
  assert.match(
    validateNewSplit(refund, [], { amount: 10, userCategory: "Food" }),
    /money out/
  );
});

test("pending rows cannot be split", () => {
  const pending = { amount: 100, pending: true };
  assert.match(
    validateNewSplit(pending, [], { amount: 10, userCategory: "Food" }),
    /Pending/
  );
});

test("a non-positive or unusable amount is refused", () => {
  for (const amount of [0, -5, Number.NaN]) {
    assert.match(
      validateNewSplit(target, [], { amount, userCategory: "Food" }),
      /greater than zero/
    );
  }
});

test("a blank category is refused", () => {
  assert.match(validateNewSplit(target, [], { amount: 30, userCategory: "  " }), /category/);
});

test("over-allocation is refused", () => {
  assert.match(
    validateNewSplit(target, [{ amount: 80 }], { amount: 30, userCategory: "Food" }),
    /left to split/
  );
});

test("a carve-out for exactly the remaining amount is allowed", () => {
  assert.equal(
    validateNewSplit(target, [{ amount: 70 }], { amount: 30, userCategory: "Food" }),
    null
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/test-splits.mjs
```

Expected: FAIL — `Cannot find module '../src/lib/splits.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/splits.ts`:

```ts
/**
 * Payment splits: carving one transaction into several categories without
 * turning it into several transactions.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. The same constraint governs `src/lib/links.ts`,
 * `src/lib/labels.ts` and `src/lib/pro-mode.ts`.
 *
 * Plaid sign convention throughout: amount > 0 is money out. A carve-out is a
 * slice of money out, so its amount is always positive.
 */

/**
 * A stored carve-out: an amount of a transaction placed under its own category.
 *
 * No id. Slicing never needs one, and requiring it would force every caller to
 * select a column it does not use — `benefits.service.ts` reads only the amount
 * and the category. The API and DTO layers carry ids of their own.
 */
export interface SplitPart {
  amount: number;
  /** Full category, possibly "Parent > Sub". */
  userCategory: string;
}

/** A transaction being sliced, reduced to what slicing needs. */
export interface SliceRow {
  amount: number;
  /** The row's effective category, already resolved and humanized. */
  effectiveCategory: string;
}

/** A transaction being split, reduced to what validation needs. */
export interface SplitTarget {
  amount: number;
  pending: boolean;
}

/** One (amount, category) pair a transaction reports to a consumer. */
export interface Slice {
  amount: number;
  userCategory: string;
  /** True for the derived leftover, false for a carve-out the user typed. */
  isRemainder: boolean;
}

/** Below this, a remainder is zero rather than float noise. */
const CENT = 0.005;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What is left of a transaction after its carve-outs. Negative when a later
 * amount revision dropped the total below what was already carved out — that
 * is surfaced rather than clamped, because clamping would edit a figure the
 * user typed in response to an event they never saw.
 */
export function remainderOf(amount: number, parts: { amount: number }[]): number {
  return round(parts.reduce((left, p) => left - p.amount, amount));
}

/**
 * A transaction as the list of (amount, category) pairs it really represents.
 *
 * The remainder is derived here rather than stored, which is what lets a Plaid
 * amount revision or a recategorization of the row flow through for free. An
 * unsplit row yields exactly one slice, so every consumer can call this
 * unconditionally instead of branching on whether a row has parts.
 */
export function sliceTransaction(row: SliceRow, parts: SplitPart[]): Slice[] {
  const slices: Slice[] = parts.map((p) => ({
    amount: p.amount,
    userCategory: p.userCategory,
    isRemainder: false,
  }));

  const left = remainderOf(row.amount, parts);
  // An exhausted split reports only its parts. Keeping a zero slice would add
  // a phantom row to the ledger and a zero-amount entry to every chart.
  if (parts.length === 0 || Math.abs(left) >= CENT) {
    slices.push({
      amount: left,
      userCategory: row.effectiveCategory,
      isRemainder: true,
    });
  }
  return slices;
}

/**
 * Why a proposed carve-out cannot be added, or null if it is fine.
 *
 * Over-allocation is refused at write time even though a later revision may
 * push the remainder negative anyway: asking for an impossible split outright
 * is a mistake worth catching, while drift is something that happened to you.
 */
export function validateNewSplit(
  row: SplitTarget,
  existing: { amount: number }[],
  proposed: { amount: number; userCategory: string }
): string | null {
  if (row.amount <= 0) return "Only a purchase (money out) can be split";
  if (row.pending)
    return "Pending transactions cannot be split — they are replaced when they post";
  // Written as a positive test so NaN, which fails every comparison, is caught
  // here rather than reaching the database.
  if (!(proposed.amount > 0)) return "A split amount must be greater than zero";
  if (proposed.userCategory.trim() === "") return "A split needs a category";
  if (proposed.amount > remainderOf(row.amount, existing) + CENT)
    return "That is more than the amount left to split";
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test scripts/test-splits.mjs
```

Expected: PASS, 17 tests.

- [ ] **Step 5: Register the suite**

In `package.json`, append `scripts/test-splits.mjs` to the `node --test` list in the `test` script, then run the whole suite:

```bash
npm test
```

Expected: PASS, including the pre-existing suites.

- [ ] **Step 6: Commit**

```bash
git add src/lib/splits.ts scripts/test-splits.mjs package.json
git commit -m "$(cat <<'EOF'
Add split arithmetic

Carve-outs are stored; the remainder is derived, so an amount revision
or a recategorization of the row flows through without maintenance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The TransactionSplit table

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_payment_splits/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing from Task 1 — the schema stands alone.
- Produces: the `TransactionSplit` Prisma model, and `Transaction.splits` as a back-relation. Tasks 3–7 all read one or both.

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, after the `Transaction` model:

```prisma
// A carve-out: part of one transaction placed under its own category, without
// the transaction becoming two transactions. The leftover is never stored --
// it is `Transaction.amount` less the sum of these, wearing whatever category
// the row itself resolves to at the time it is read. See src/lib/splits.ts.
model TransactionSplit {
  id            String   @id @default(cuid())
  transactionId String
  amount        Float // positive, Plaid's outflow convention
  userCategory  String // full category, possibly "Parent > Sub"
  note          String?
  createdAt     DateTime @default(now())

  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@index([transactionId])
}
```

- [ ] **Step 2: Add the back-relation**

In the `Transaction` model, alongside `refunds`:

```prisma
  splits   TransactionSplit[]
```

- [ ] **Step 3: Back up the live database**

This migration runs against real financial data. The repo already keeps
point-in-time copies under `prisma/backups/` for exactly this:

```bash
cp prisma/dev.db "prisma/backups/pre-payment-splits-$(date -u +%Y%m%dT%H%M%S).db"
```

- [ ] **Step 4: Generate and apply the migration**

```bash
npx prisma migrate dev --name payment_splits
```

Expected: a new folder under `prisma/migrations/`, a `CREATE TABLE "TransactionSplit"` in its `migration.sql`, and the client regenerated.

- [ ] **Step 5: Verify the cascade**

`onDelete: Cascade` is the reason a retracted Plaid transaction cannot leave orphaned parts — `sync.service.ts` deletes removed rows outright. Confirm the generated SQL carries it:

```bash
grep -A2 "REFERENCES \"Transaction\"" prisma/migrations/*_payment_splits/migration.sql
```

Expected: `ON DELETE CASCADE` present.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
Add the TransactionSplit table

Carve-outs only. Cascades on delete so a retracted Plaid transaction
cannot leave parts behind.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add and remove parts

Two route handlers. A part is never edited in place — changing one is removing it and adding it back.

**Files:**
- Create: `src/app/api/transactions/[id]/splits/route.ts`
- Create: `src/app/api/transactions/[id]/splits/[splitId]/route.ts`

**Interfaces:**
- Consumes: `validateNewSplit` from `@/lib/splits` (Task 1); the `TransactionSplit` model (Task 2); `joinCategory` from `@/lib/categories`.
- Produces:
  - `POST /api/transactions/:id/splits` — body `{ amount: number, category: string, subcategory?: string | null }` → `201 { id, amount, userCategory }`, or `400 { error }` with the message `validateNewSplit` returned, or `404 { error }`.
  - `DELETE /api/transactions/:id/splits/:splitId` → `200 { ok: true }` or `404 { error }`.

- [ ] **Step 1: Read the route-handler docs**

```bash
sed -n '1,60p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

Confirm the `export async function POST(req, { params })` shape and that `params` is a Promise in this version — `src/app/api/transactions/[id]/route.ts` is the in-repo reference.

- [ ] **Step 2: Write the POST handler**

Create `src/app/api/transactions/[id]/splits/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { joinCategory } from "@/lib/categories";
import { validateNewSplit } from "@/lib/splits";

// POST /api/transactions/:id/splits — carve part of a purchase out under its
// own category.
//   body: { amount: number, category: string, subcategory?: string | null }
//
// The leftover is never written. It is derived on read from the transaction's
// amount and the parts stored here, so this endpoint has nothing to keep in
// step when Plaid later revises that amount.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      amount?: number;
      category?: string | null;
      subcategory?: string | null;
    };

    const row = await prisma.transaction.findUnique({
      where: { id },
      select: {
        amount: true,
        pending: true,
        splits: { select: { amount: true } },
      },
    });
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const category = body.category?.trim() || "";
    const subcategory = body.subcategory?.trim() || null;
    const userCategory = category ? joinCategory(category, subcategory) : "";
    const amount = Number(body.amount);

    const problem = validateNewSplit(row, row.splits, { amount, userCategory });
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    const split = await prisma.transactionSplit.create({
      data: { transactionId: id, amount, userCategory },
      select: { id: true, amount: true, userCategory: true },
    });
    return NextResponse.json(split, { status: 201 });
  } catch (err) {
    console.error("[splits POST]", err);
    return NextResponse.json({ error: "Failed to add split" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Write the DELETE handler**

Create `src/app/api/transactions/[id]/splits/[splitId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// DELETE /api/transactions/:id/splits/:splitId — drop one carve-out. The
// remainder grows back by that amount on the next read, with no write.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; splitId: string }> }
) {
  try {
    const { id, splitId } = await params;
    // Scoped by transaction as well as id, so a mismatched pair is a 404
    // rather than a deletion from some other transaction's split set.
    const { count } = await prisma.transactionSplit.deleteMany({
      where: { id: splitId, transactionId: id },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[splits DELETE]", err);
    return NextResponse.json({ error: "Failed to remove split" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Exercise both handlers**

Start the dev server, then find a posted purchase and drive the endpoints:

```bash
npm run dev
```

```bash
ID=$(sqlite3 prisma/dev.db "SELECT id FROM \"Transaction\" WHERE amount > 50 AND pending = 0 LIMIT 1;") && \
curl -s -X POST "http://localhost:3000/api/transactions/$ID/splits" \
  -H 'Content-Type: application/json' \
  -d '{"amount":30,"category":"Food"}'
```

Expected: `201` with `{"id":"...","amount":30,"userCategory":"Food"}`.

Then confirm each refusal returns the message from `validateNewSplit`:

```bash
curl -s -X POST "http://localhost:3000/api/transactions/$ID/splits" \
  -H 'Content-Type: application/json' -d '{"amount":999999,"category":"Food"}'
```

Expected: `400` with `"That is more than the amount left to split"`.

Then remove it:

```bash
SPLIT=$(sqlite3 prisma/dev.db "SELECT id FROM \"TransactionSplit\" LIMIT 1;") && \
curl -s -X DELETE "http://localhost:3000/api/transactions/$ID/splits/$SPLIT"
```

Expected: `{"ok":true}`, and the row gone from the table.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/transactions
git commit -m "$(cat <<'EOF'
Add and remove payment splits

Two operations, no in-place edit: changing a part is removing it and
adding it back. Deletes are scoped by transaction as well as id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Analytics and card rewards read slices

The point of the feature. Until this lands, a split changes nothing any user can see.

**Files:**
- Modify: `src/services/analytics.service.ts` (`fetchTxInputs`, around lines 142–222)
- Modify: `src/services/benefits.service.ts` (`computeEarnings`, around lines 190–202, and its caller's `select`)

**Interfaces:**
- Consumes: `sliceTransaction` and `SplitPart` from `@/lib/splits` (Task 1); `Transaction.splits` (Task 2).
- Produces: no new exported names. `fetchTxInputs` keeps returning `TxInput[]`; `computeEarnings` keeps its signature except that its `txns` parameter gains `splits: { amount: number; userCategory: string }[]`.

- [ ] **Step 1: Widen the analytics query**

In `fetchTxInputs`, add to the `select`:

```ts
      splits: { select: { id: true, amount: true, userCategory: true } },
```

Note the `where` clause stays exactly as it is. A row is admitted or excluded as a whole; parts are a categorization detail *within* an admitted row, and letting a part change admission would mean a carve-out could drag an excluded transfer back into the totals.

- [ ] **Step 2: Emit one TxInput per slice**

Replace the `return [{ ... }]` at the end of the `flatMap` with a loop over slices. The full replacement for the `flatMap` body, from the `uc` line onward:

```ts
    // A user category (Venmo/Zelle/manual/inherited) wins over Plaid's PFC
    // primary, and is what the remainder wears.
    const effective = raw ?? plaidName(r.pfcPrimary);
    // P2P rows use a person as the "merchant" — keep them out of merchant totals.
    const merchant = isP2p(r.source, r.name) ? null : r.merchantName ?? r.name;

    return sliceTransaction({ amount: r.amount, effectiveCategory: effective }, r.splits)
      .flatMap((slice) => {
        // A part can be tagged Transfer independently of its row, and the
        // WHERE clause's string match cannot see parts at all — so the
        // exclusion is applied per slice here.
        if (slice.userCategory === "Transfer" || slice.userCategory.startsWith("Transfer > "))
          return [];
        // Subcategorized values ("Parent > Sub") roll up to their parent; the
        // sub travels alongside for drill-down views (single-month Sankey).
        const { parent, sub } = splitCategory(slice.userCategory);
        return [{
          amount: slice.amount,
          date: r.date,
          category: parent,
          subcategory: sub,
          merchant,
          // Parts are slices of a money-out row, so only the whole-row
          // money-in case can be an offset. A split row is never money-in.
          isOffset,
        }];
      });
```

The earlier `if (raw === "Transfer" || raw?.startsWith("Transfer > ")) return [];` guard stays where it is: it drops a whole row whose *own* category is Transfer, before any slicing happens.

- [ ] **Step 3: Verify analytics by hand**

```bash
npm run dev
```

Split a $100-ish purchase $30 under Food via the Task 3 endpoint, then:

```bash
curl -s "http://localhost:3000/api/analytics?months=12" | python3 -m json.tool | head -40
```

Expected: Food's total up by exactly 30, and the row's original category down by exactly 30. Remove the split and confirm both return to their prior values.

- [ ] **Step 4: Bucket slices in the rewards math**

In `benefits.service.ts`, widen the `txns` parameter type of `computeEarnings` to include `splits: { amount: number; userCategory: string }[]`, add the same `splits` select to the query feeding it, and replace the accumulation loop:

```ts
  const spend = new Map<string, number>();
  for (const t of txns) {
    if (t.amount <= 0 || t.date < start || t.date >= end) continue;
    // A split transaction earns per part: a grocery carve-out at a big-box
    // store earns the grocery rate, and the rest earns the row's own rate.
    // rewardCategoryFor needs nothing but a category and the two Plaid
    // fallbacks, which is exactly what a slice plus its row supplies.
    for (const slice of sliceTransaction(
      { amount: t.amount, effectiveCategory: t.userCategory ?? "" },
      t.splits
    )) {
      const c = rewardCategoryFor({
        // An empty effectiveCategory means the row had no override, so the
        // remainder must fall through to Plaid exactly as the row did.
        userCategory: slice.userCategory || null,
        pfcPrimary: t.pfcPrimary,
        pfcDetailed: t.pfcDetailed,
      });
      spend.set(c, (spend.get(c) ?? 0) + slice.amount);
    }
  }
```

Add `import { sliceTransaction } from "@/lib/splits";` at the top.

- [ ] **Step 5: Verify the rewards math**

```bash
curl -s "http://localhost:3000/api/benefits" | python3 -m json.tool | grep -A6 byCategory | head -30
```

Expected: with the $30 Food carve-out in place, $30 moves from the row's reward bucket into the grocery bucket, and the card's total spend figure is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/services/analytics.service.ts src/services/benefits.service.ts
git commit -m "$(cat <<'EOF'
Read transactions as slices in analytics and rewards

Both consumers go through sliceTransaction rather than deriving the
remainder separately, so they cannot disagree about what a transaction
was. Transfer exclusion now applies per slice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The category cascade

A correctness requirement, not a feature. `TransactionSplit.userCategory` stores a category *name*; every operation that rewrites or guards those names must reach parts, or renaming "Food" orphans every carve-out under a name that no longer exists.

**Files:**
- Modify: `src/services/categories.service.ts`

**Interfaces:**
- Consumes: the `TransactionSplit` model (Task 2).
- Produces: `splitUsing(name)`; `MergeNotConfirmedError` and `CategoryInUseError` each gain a `splitCount` field.

- [ ] **Step 1: Add the WHERE fragment**

Beside the existing `txUsing` and `ruleUsing`:

```ts
function splitUsing(name: string) {
  return {
    OR: [{ userCategory: name }, { userCategory: { startsWith: name + " > " } }],
  };
}
```

It is structurally identical to `ruleUsing` but kept separate: these read as documentation of which tables carry category names, and collapsing them would hide the very list this task exists to keep complete.

- [ ] **Step 2: Rewrite parts on rename and merge**

In `renameCategory`, fetch parts alongside transactions and rules:

```ts
  const splits = await prisma.transactionSplit.findMany({
    where: splitUsing(source.name),
    select: { id: true, userCategory: true },
  });
```

Inside the `prisma.$transaction` callback, beside the existing loops:

```ts
    for (const s of splits) {
      const next = renameCategoryIn(s.userCategory, source.name, to);
      if (next !== null) {
        await tx.transactionSplit.update({ where: { id: s.id }, data: { userCategory: next } });
      }
    }
```

And pass `splits.length` to `MergeNotConfirmedError` as a fourth argument,
after `resolved`, so the merge confirmation counts what it is about to move:
`new MergeNotConfirmedError(existing.name, txs.length, rules.length, resolved, splits.length)`.

- [ ] **Step 3: Guard deletion**

In `deleteCategory`, add the count to the `Promise.all` and the refusal:

```ts
  const [transactionCount, ruleCount, mappingCount, splitCount] = await Promise.all([
    prisma.transaction.count({ where: txUsing(cat.name) }),
    prisma.categoryRule.count({ where: ruleUsing(cat.name) }),
    prisma.categoryMapping.count({ where: { categoryId: id } }),
    prisma.transactionSplit.count({ where: splitUsing(cat.name) }),
  ]);
  if (transactionCount || ruleCount || mappingCount || splitCount) {
    throw new CategoryInUseError(transactionCount, ruleCount, mappingCount, splitCount);
  }
```

Report `splitCount` as its own figure rather than folding it into `transactionCount`: one transaction can hold several parts, so a conflated number would be wrong in both directions.

- [ ] **Step 4: Update the error classes and their messages**

Add the `splitCount` parameter to both error constructors and include it in the user-facing text, then follow the type errors to every construction and render site:

```bash
npx tsc --noEmit
```

Expected: clean. Fix each reported site before moving on.

- [ ] **Step 5: Verify the cascade by hand**

```bash
npm run dev
```

Add a carve-out under a renameable category, rename that category in Settings, and confirm the part followed:

```bash
sqlite3 prisma/dev.db "SELECT userCategory FROM \"TransactionSplit\";"
```

Expected: the new name. Then try deleting a category that only a part references.

Expected: refused, with the part counted in the message.

- [ ] **Step 6: Commit**

```bash
git add src/services/categories.service.ts src/components src/app
git commit -m "$(cat <<'EOF'
Extend the category cascade to splits

Parts store a category name, so renames must rewrite them and deletes
must refuse while they exist. Counted separately from transactions: one
transaction can hold several parts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Pro becomes an app-wide mode

`analytics-mode` is documented as governing "how much of the Analytics page to show". Having the Transactions page read it would make that false, so the concept is promoted rather than borrowed.

**Files:**
- Create: `src/lib/pro-mode.ts`, `scripts/test-pro-mode.mjs`, `src/components/useProMode.ts`, `src/components/SettingsMode.tsx`, `src/app/settings/mode/page.tsx`
- Delete: `src/lib/analytics-mode.ts`, `scripts/test-analytics-mode.mjs`, `src/components/useAnalyticsMode.ts`, `src/components/SettingsAnalytics.tsx`
- Modify: `src/app/settings/analytics/page.tsx`, `src/components/SideNav.tsx`, `src/components/AnalyticsDashboard.tsx`, `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type ProMode = "normal" | "pro"`, `PRO_MODE_KEY = "pro-mode"`, `LEGACY_ANALYTICS_MODE_KEY = "analytics-mode"`, `resolveProMode(stored: unknown): ProMode`, and the hook `useProMode(): { mode: ProMode; choose: (next: ProMode) => void }`. Task 7 consumes the hook.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-pro-mode.mjs` by copying `scripts/test-analytics-mode.mjs`, renaming the imports to `PRO_MODE_KEY` / `resolveProMode` from `../src/lib/pro-mode.ts`, and replacing the final key-stability test with:

```js
test("the store keys are stable", () => {
  // PRO_MODE_KEY names a value written to data/ui-state.json on the user's
  // machine; changing it silently resets their preference. The legacy key is
  // still read as a fallback, so it has to stay exact too.
  assert.equal(PRO_MODE_KEY, "pro-mode");
  assert.equal(LEGACY_ANALYTICS_MODE_KEY, "analytics-mode");
});
```

Add `LEGACY_ANALYTICS_MODE_KEY` to the import list.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/test-pro-mode.mjs
```

Expected: FAIL — `Cannot find module '../src/lib/pro-mode.ts'`.

- [ ] **Step 3: Write the module**

Create `src/lib/pro-mode.ts`:

```ts
/**
 * How much of the app to show.
 *
 * Normal is the everyday view. Pro adds the dense, interactive extras: the
 * cash-flow diagram and cumulative spending graph on Analytics, and payment
 * splitting in the ledger. It gates controls and views, never data — a split
 * recorded in Pro still counts toward every total in Normal, because a display
 * preference must not be able to move a financial figure.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. The same constraint governs `src/lib/links.ts`, `src/lib/labels.ts`
 * and `src/lib/splits.ts`.
 */

export type ProMode = "normal" | "pro";

/** The key this preference occupies in the shared ui-state store. */
export const PRO_MODE_KEY = "pro-mode";

/**
 * Where it lived while Pro was an Analytics-only setting. Read as a fallback
 * so an existing choice survives the rename, and left in place rather than
 * deleted: it is a few bytes in a JSON file, and removing it would break any
 * older build still pointed at the same store.
 */
export const LEGACY_ANALYTICS_MODE_KEY = "analytics-mode";

/**
 * Turn whatever the store holds into a mode.
 *
 * The store is shared across browsers and app versions and is a plain JSON
 * file a user can edit, so the stored value can be anything at all. Everything
 * that is not exactly "pro" resolves to Normal rather than throwing: a corrupt
 * preference must not take a page down with it.
 */
export function resolveProMode(stored: unknown): ProMode {
  return stored === "pro" ? "pro" : "normal";
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test scripts/test-pro-mode.mjs
```

Expected: PASS.

- [ ] **Step 5: Write the hook with its fallback read**

Create `src/components/useProMode.ts` from `useAnalyticsMode.ts`, changing only the load effect:

```ts
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadSynced(PRO_MODE_KEY);
      if (stored != null) {
        if (!cancelled && !chosen.current) setMode(resolveProMode(stored));
        return;
      }
      // One-time migration from the Analytics-only era. Read the old key, adopt
      // it, and push it forward under the new one. The old key is left alone.
      const legacy = await loadSynced(LEGACY_ANALYTICS_MODE_KEY);
      if (legacy == null) return;
      const mode = resolveProMode(legacy);
      if (!cancelled && !chosen.current) setMode(mode);
      pushSynced(PRO_MODE_KEY, mode);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

Everything else — the `chosen` ref, `choose`, the comments explaining both — carries over unchanged.

- [ ] **Step 6: Move the settings section**

Create `src/components/SettingsMode.tsx` from `SettingsAnalytics.tsx`, renaming the component and hook and rewriting the two blurbs:

```tsx
const MODES: { value: ProMode; label: string; blurb: string }[] = [
  {
    value: "normal",
    label: "Normal",
    blurb: "Summary cards, spending by category, and the monthly trend.",
  },
  {
    value: "pro",
    label: "Pro",
    blurb:
      "Everything in Normal, plus the cash-flow diagram, the cumulative spending graph, and splitting one payment across categories in the ledger.",
  },
];
```

Change the header to "Mode" with the subtitle "How much detail the app shows."

Create `src/app/settings/mode/page.tsx` mirroring the old analytics page, with `title: "Mode · Settings · Budget Claude"`.

- [ ] **Step 7: Redirect the old route**

Read the docs first, as `AGENTS.md` requires:

```bash
sed -n '1,45p' node_modules/next/dist/docs/01-app/03-api-reference/04-functions/permanentRedirect.md
```

Then replace `src/app/settings/analytics/page.tsx` entirely:

```tsx
import { permanentRedirect } from "next/navigation";

// The Normal/Pro switch stopped being an Analytics-only setting when splitting
// arrived in the ledger. Permanent rather than temporary: this route is not
// coming back, and the settings-sections work set the same precedent for
// /rules.
export default function SettingsAnalyticsPage() {
  permanentRedirect("/settings/mode");
}
```

- [ ] **Step 8: Follow the rename**

Update `SideNav.tsx` (the child entry becomes `/settings/mode`, labelled "Mode") and `AnalyticsDashboard.tsx` (import `useProMode`; point the Normal-mode nudge at `/settings/mode`). Delete the four superseded files, swap `test-analytics-mode.mjs` for `test-pro-mode.mjs` in `package.json`, then:

```bash
npx tsc --noEmit && npm run lint && npm test
```

Expected: all clean.

- [ ] **Step 9: Verify the migration and the redirect**

```bash
npm run dev
```

With `data/ui-state.json` holding `analytics-mode: "pro"` and no `pro-mode` key, load Settings.

Expected: Pro is selected, and `pro-mode: "pro"` appears in the file while `analytics-mode` is still there.

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/settings/analytics
```

Expected: `308` to `/settings/mode`.

- [ ] **Step 10: Commit**

```bash
git add -A src/lib src/components src/app/settings scripts package.json
git commit -m "$(cat <<'EOF'
Promote Pro from an Analytics setting to an app-wide mode

Splits are gated behind Pro, and a preference named analytics-mode
governing the ledger would make its own documentation false. The old
stored key is read as a fallback and left in place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Splits in the ledger

The table already has an expandable-row mechanism with two panels; this adds a third and the controls that write to it.

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/app/api/transactions/route.ts` (the `select`, around line 183, and the DTO, around lines 196–242)
- Modify: `src/components/TransactionTable.tsx`

**Interfaces:**
- Consumes: `sliceTransaction`/`remainderOf` (Task 1), `Transaction.splits` (Task 2), the two endpoints (Task 3), `useProMode` (Task 6).
- Produces: `SplitPartDTO`, and `splits: SplitPartDTO[]` plus `splitRemainder: number | null` on `TransactionDTO`.

- [ ] **Step 1: Extend the DTO types**

In `src/types/index.ts`, beside `RefundDTO`:

```ts
/** One carve-out of a split transaction, as shown under its row. */
export interface SplitPartDTO {
  id: string;
  amount: number; // positive
  category: string; // parent, for display
  subcategory: string | null;
  userCategory: string; // raw, possibly "Parent > Sub"
}
```

And on `TransactionDTO`, beside `refunds`:

```ts
  // Carve-outs placed under their own categories. Empty on an unsplit row.
  splits: SplitPartDTO[];
  // What is left after the carve-outs, wearing this row's own `category`.
  // Null when the row is unsplit, and also when the parts consume it exactly —
  // both mean "there is no leftover line to draw".
  splitRemainder: number | null;
```

- [ ] **Step 2: Carry them through the API**

Add to the `select` in `src/app/api/transactions/route.ts`:

```ts
      splits: {
        select: { id: true, amount: true, userCategory: true },
        orderBy: { createdAt: "asc" },
      },
```

And in the `rows.map`, before the returned object:

```ts
      // Derived, never stored: the leftover follows the row's amount and its
      // category without anything having to write it down. Below a cent it is
      // float noise from summing the parts, not a leftover.
      const left = remainderOf(t.amount, t.splits);
      const splitRemainder =
        t.splits.length > 0 && Math.abs(left) >= 0.005 ? left : null;
```

Then add to the returned object:

```ts
        splits: t.splits.map((s) => {
          const sc = splitCategory(s.userCategory);
          return {
            id: s.id,
            amount: s.amount,
            category: sc.parent,
            subcategory: sc.sub,
            userCategory: s.userCategory,
          };
        }),
        splitRemainder,
```

Import `remainderOf` from `@/lib/splits`.

- [ ] **Step 3: Make a split row expandable**

In `TransactionTable.tsx`, extend the three lines that decide expandability:

```tsx
            const hasBreakdown = t.breakdown !== null;
            const hasRefunds = t.refunds.length > 0;
            const hasSplits = t.splits.length > 0;
            const isExpandable = hasBreakdown || hasRefunds || hasSplits;
```

Add the badge beside the existing ones, before `{t.isFee && ...}`:

```tsx
                      {hasSplits && (
                        <Badge tone="slate">
                          Split {t.splits.length + (t.splitRemainder === null ? 0 : 1)} ways
                        </Badge>
                      )}
```

And render the panel in the detail row, beside the other two:

```tsx
                      {hasSplits && (
                        <SplitPanel
                          transaction={t}
                          categories={categories}
                          onChanged={onChanged}
                        />
                      )}
```

- [ ] **Step 4: Write the panel**

Add at the bottom of `TransactionTable.tsx`, beside `BreakdownPanel` and `RefundPanel`:

```tsx
function SplitPanel({
  transaction: t,
  categories,
  onChanged,
}: {
  transaction: TransactionDTO;
  categories: string[];
  onChanged: () => void;
}) {
  const { mode } = useProMode();
  const isPro = mode === "pro";
  const [busy, setBusy] = useState(false);

  const remove = async (splitId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/transactions/${t.id}/splits/${splitId}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pl-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
        Split across categories
      </p>
      <ul className="space-y-1">
        {t.splits.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-black/70 dark:text-white/70">
              {s.subcategory ? `${s.category} › ${s.subcategory}` : s.category}
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono tabular-nums">{formatCurrency(s.amount)}</span>
              {isPro && (
                <button
                  type="button"
                  onClick={() => void remove(s.id)}
                  disabled={busy}
                  aria-label={`Remove the ${s.category} split`}
                  className="text-xs text-black/40 hover:text-red-600 disabled:opacity-40 dark:text-white/40 dark:hover:text-red-400"
                >
                  ✕
                </button>
              )}
            </span>
          </li>
        ))}
        {t.splitRemainder !== null && (
          <li className="flex items-center justify-between gap-4 text-sm text-black/45 dark:text-white/45">
            {/* The leftover is a part among equals, distinguished only by being
                the one you cannot remove — it is derived, not stored. */}
            <span>{t.category} (rest)</span>
            <span
              className={`font-mono tabular-nums ${
                t.splitRemainder < 0 ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {formatCurrency(t.splitRemainder)}
            </span>
          </li>
        )}
      </ul>

      {t.splitRemainder !== null && t.splitRemainder < 0 && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          This transaction&rsquo;s amount changed and is now smaller than its
          splits. Remove or re-add a split to fix it.
        </p>
      )}

      {isPro ? (
        <AddSplitForm
          transaction={t}
          categories={categories}
          onChanged={onChanged}
        />
      ) : (
        <p className="mt-2 text-xs text-black/45 dark:text-white/45">
          Splits still count toward your totals in Normal mode —{" "}
          <Link href="/settings/mode" className="underline underline-offset-2 hover:text-foreground">
            switch to Pro in Settings
          </Link>{" "}
          to change them.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the add form**

```tsx
function AddSplitForm({
  transaction: t,
  categories,
  onChanged,
}: {
  transaction: TransactionDTO;
  categories: string[];
  onChanged: () => void;
}) {
  // The amount left is the natural default: splitting a row in two is then a
  // single category pick with no arithmetic.
  const left = t.splitRemainder ?? remainderOf(t.amount, t.splits);
  const [amount, setAmount] = useState(left > 0 ? left.toFixed(2) : "");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${t.id}/splits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), category }),
      });
      if (!res.ok) {
        // The server owns validation; showing its message keeps the two from
        // drifting apart as the rules change.
        const { error: message } = (await res.json()) as { error?: string };
        setError(message ?? "Could not add that split");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Split amount"
        className="w-24 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Split category"
        className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
      >
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || amount === ""}
        className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
      >
        Add split
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
```

Add the needed imports at the top of the file: `Link` from `next/link`, `useProMode` from `./useProMode`, and `remainderOf` from `@/lib/splits`.

- [ ] **Step 6: Make an unsplit row splittable**

A row with no parts is not expandable, so there is nowhere to add the first one. In the `CategoryEditor` (the existing inline editor opened by clicking a row's category), add a "Split this" button, shown only when `mode === "pro"` and the row is a non-pending purchase (`t.amount > 0 && !t.pending`). It POSTs nothing on its own — it calls `onChanged()` after adding a first carve-out through the same `AddSplitForm`, rendered inline in the editor.

Keep the guard identical to `validateNewSplit`'s first two refusals, so the control is absent exactly when the server would refuse.

- [ ] **Step 7: Verify in the browser**

```bash
npm run dev
```

Check each of these:

1. In Pro, split a $100 purchase $30 under Food. The row keeps its number, date and $100 total, gains a "Split 2 ways" badge, and expands to show $30 Food and $70 under its own category.
2. Add a second carve-out. The remainder shrinks by exactly that amount.
3. Carve out the full remaining amount. The leftover line disappears rather than showing $0.00.
4. Switch to Normal in Settings. The badge and the expanded breakdown are still there, the ✕ buttons and the add form are gone, and the Settings link is shown.
5. Reload Analytics in Normal. The split still counts — Food is still up by $30.
6. Switch back to Pro. The controls return over the same data.
7. Confirm no pending row and no money-in row offers the control.

- [ ] **Step 8: Rebuild and run the full check**

```bash
npx tsc --noEmit && npm run lint && npm test && bash Budget.command --no-open
```

Expected: all clean, and the served bundle rebuilt.

- [ ] **Step 9: Commit**

```bash
git add src/types src/app/api/transactions src/components/TransactionTable.tsx
git commit -m "$(cat <<'EOF'
Show and edit payment splits in the ledger

A third expandable panel beside the cash-out breakdown and the refund
list. The remainder renders as a part among equals, distinguished only
by being the one you cannot remove. Controls are Pro-only; the
breakdown itself is not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: the model and its validation to Tasks 1–2, the derived remainder to Task 1, the negative-remainder flag to Tasks 1 and 7, Analytics and card rewards to Task 4, the category cascade to Task 5, the Pro promotion and its migration to Task 6, the ledger and the Normal-mode nudge to Task 7. The three out-of-scope items — refund part-picking, splitting from the Venmo/Zelle pages, percentage entry — have no task by design.

**One open assumption.** Task 7 Step 6 assumes `CategoryEditor` is the right host for the "Split this" entry point on an unsplit row, since that is the existing way a row's category is edited. If it turns out cramped in practice, a Split affordance on the row itself is the fallback — worth a look during review rather than a rewrite of the plan.
