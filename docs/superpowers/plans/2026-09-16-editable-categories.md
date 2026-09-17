# Editable Categories and Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hardcoded category list into data the user owns, edited on a new `/settings` page, governing both what a category can be assigned and what Plaid's own labels resolve to.

**Architecture:** Two Prisma models — `Category` (unique name) and `CategoryMapping` (`pfcPrimary` unique → category). A migration seeds them from today's constants so day-one behaviour is identical. A service owns the reads and the reference-rewriting writes; a thin API exposes it; every surface that offered or resolved a category reads the stored list instead of a constant.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 5 over SQLite, Tailwind 4, `node:test` (built in, no new dependency).

**Spec:** `docs/superpowers/specs/2026-09-16-editable-categories-design.md`

## Global Constraints

- **Read the bundled docs first.** `AGENTS.md` requires reading the relevant guide in `node_modules/next/dist/docs/` before writing code. Route handler params are `{ params }: { params: Promise<{ id: string }> }` and must be awaited — confirmed current, and what the existing routes do. Match existing route style; do not switch to `RouteContext<'/path'>`.
- **A pure module in `src/lib/` that `node:test` imports must have ZERO imports.** Node 24 strips types natively, which is why the tests need no loader and no dependency — but that breaks the instant the file needs a `@/` path alias resolved. This is a measured fact, not a style preference: `src/lib/rules.ts` cannot be loaded by `node --test` today precisely because it imports `@/lib/format`.
- **Plaid sign convention:** `amount > 0` is money out, `amount < 0` is money in. Unchanged by this work, but several touched files depend on it.
- **A category is a name, not an identity.** `Transaction.userCategory` and `CategoryRule.category` store text. Renaming rewrites that text; deleting is refused while text still references it.
- **A category is "in use" if any transaction uses it as a parent too** — `"Home Improvement > Furniture"` uses `Home Improvement`. Every in-use check must match both the exact name and the `"<name> > "` prefix.
- **The seed must be behaviour-preserving.** After migration, every Plaid primary must resolve to exactly the string `humanizePfc(primary)` returns today.
- **This database holds real financial records.** Back up `prisma/dev.db` before migrating. Do not write test data. Do not start a dev server with `npm run dev` — use the `preview_start` tool.
- **`npx prisma db execute` does not print query results.** To read data back, use `node -e` with `PrismaClient.$queryRawUnsafe` and a BigInt-safe replacer (`typeof v === "bigint" ? Number(v) : v`).
- **After all code changes, run `bash Budget.command --no-open`** — the app serves a prebuilt bundle and will otherwise serve stale code.

---

### Task 1: Schema, migration, and behaviour-preserving seed

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_editable_categories/migration.sql`
- Modify: `src/lib/rules.ts` (export `PFC_PRIMARIES`)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `Category { id, name @unique, createdAt, plaidMappings }` and `CategoryMapping { id, pfcPrimary @unique, categoryId, category }`. `export const PFC_PRIMARIES: string[]` from `src/lib/rules.ts`.

- [ ] **Step 1: Back up the database**

```bash
cp prisma/dev.db "prisma/backups/pre-categories-$(date +%Y%m%dT%H%M%S).db"
```

- [ ] **Step 2: Add the models**

In `prisma/schema.prisma`, after the `CategoryRule` model:

```prisma
// A spending category the user can assign. Seeded from the lists that used to
// be hardcoded in src/lib/rules.ts, and editable from /settings.
//
// Transactions store their category as TEXT, not a relation — so a category is
// a name, not an identity. Renaming rewrites that text everywhere it appears;
// deleting is refused while text still references it.
model Category {
  id        String   @id @default(cuid())
  name      String   @unique
  createdAt DateTime @default(now())

  plaidMappings CategoryMapping[]
}

// Which of Plaid's personal-finance-category primaries resolve to this
// category, for transactions the user has not categorized by hand. A primary
// resolves to exactly one category; the unique constraint makes that
// structural rather than something the API has to remember to enforce.
model CategoryMapping {
  id         String @id @default(cuid())
  pfcPrimary String @unique // e.g. FOOD_AND_DRINK
  categoryId String

  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@index([categoryId])
}
```

- [ ] **Step 3: Generate the migration without applying it**

```bash
npx prisma migrate dev --create-only --name editable_categories
```

If `migrate dev` refuses to run non-interactively, generate the SQL with
`npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` and place it by hand, then apply with `npx prisma migrate deploy`. Either route is fine; the committed SQL is what matters.

- [ ] **Step 4: Append the seed to the generated migration**

These values are not guesses — they are the exact output of today's `RULE_CATEGORIES` and `humanizePfc`. Readable ids are used instead of cuids so the seed is auditable; Prisma only requires them to be unique strings.

Append to the end of the generated `migration.sql`:

```sql
-- Seed: the 23 categories RULE_CATEGORIES produces today (the P2P list unioned
-- with Plaid's primaries, humanized), so the list starts as what the app
-- already offered.
INSERT INTO "Category" ("id", "name", "createdAt") VALUES
  ('cat_bank_fees','Bank Fees',CURRENT_TIMESTAMP),
  ('cat_dining','Dining',CURRENT_TIMESTAMP),
  ('cat_entertainment','Entertainment',CURRENT_TIMESTAMP),
  ('cat_food_and_drink','Food and Drink',CURRENT_TIMESTAMP),
  ('cat_general_merchandise','General Merchandise',CURRENT_TIMESTAMP),
  ('cat_general_services','General Services',CURRENT_TIMESTAMP),
  ('cat_government_and_non_profit','Government and Non Profit',CURRENT_TIMESTAMP),
  ('cat_groceries','Groceries',CURRENT_TIMESTAMP),
  ('cat_home_improvement','Home Improvement',CURRENT_TIMESTAMP),
  ('cat_housing','Housing',CURRENT_TIMESTAMP),
  ('cat_income','Income',CURRENT_TIMESTAMP),
  ('cat_loan_payments','Loan Payments',CURRENT_TIMESTAMP),
  ('cat_medical','Medical',CURRENT_TIMESTAMP),
  ('cat_other','Other',CURRENT_TIMESTAMP),
  ('cat_personal_care','Personal Care',CURRENT_TIMESTAMP),
  ('cat_reimbursement','Reimbursement',CURRENT_TIMESTAMP),
  ('cat_rent_and_utilities','Rent and Utilities',CURRENT_TIMESTAMP),
  ('cat_shopping','Shopping',CURRENT_TIMESTAMP),
  ('cat_transfer','Transfer',CURRENT_TIMESTAMP),
  ('cat_transfer_in','Transfer In',CURRENT_TIMESTAMP),
  ('cat_transfer_out','Transfer Out',CURRENT_TIMESTAMP),
  ('cat_transportation','Transportation',CURRENT_TIMESTAMP),
  ('cat_travel','Travel',CURRENT_TIMESTAMP);

-- Defensive: any parent category already present in the data that the constants
-- somehow did not contain. Normally inserts nothing; guarantees a category in
-- use can never be missing from the list that governs it.
INSERT INTO "Category" ("id", "name", "createdAt")
SELECT 'cat_seeded_' || REPLACE(LOWER(parent), ' ', '_'), parent, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT
    CASE WHEN INSTR("userCategory", ' > ') > 0
         THEN SUBSTR("userCategory", 1, INSTR("userCategory", ' > ') - 1)
         ELSE "userCategory" END AS parent
  FROM "Transaction" WHERE "userCategory" IS NOT NULL
)
WHERE parent NOT IN (SELECT "name" FROM "Category");

-- Seed the mapping: each Plaid primary points at the category named exactly
-- what humanizePfc(primary) returns today. This is what makes the migration
-- behaviour-preserving — resolving through the map yields the same string the
-- code produces now.
INSERT INTO "CategoryMapping" ("id", "pfcPrimary", "categoryId") VALUES
  ('map_income','INCOME','cat_income'),
  ('map_transfer_in','TRANSFER_IN','cat_transfer_in'),
  ('map_transfer_out','TRANSFER_OUT','cat_transfer_out'),
  ('map_loan_payments','LOAN_PAYMENTS','cat_loan_payments'),
  ('map_bank_fees','BANK_FEES','cat_bank_fees'),
  ('map_entertainment','ENTERTAINMENT','cat_entertainment'),
  ('map_food_and_drink','FOOD_AND_DRINK','cat_food_and_drink'),
  ('map_general_merchandise','GENERAL_MERCHANDISE','cat_general_merchandise'),
  ('map_general_services','GENERAL_SERVICES','cat_general_services'),
  ('map_government_and_non_profit','GOVERNMENT_AND_NON_PROFIT','cat_government_and_non_profit'),
  ('map_home_improvement','HOME_IMPROVEMENT','cat_home_improvement'),
  ('map_medical','MEDICAL','cat_medical'),
  ('map_personal_care','PERSONAL_CARE','cat_personal_care'),
  ('map_rent_and_utilities','RENT_AND_UTILITIES','cat_rent_and_utilities'),
  ('map_transportation','TRANSPORTATION','cat_transportation'),
  ('map_travel','TRAVEL','cat_travel');
```

- [ ] **Step 5: Apply the migration**

```bash
npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 6: Verify the seed is behaviour-preserving**

This is a hard gate. Run:

```bash
node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const LOWER = new Set(["and","or","of","the","to"]);
const humanize = (s) => s.toLowerCase().split("_").map((w,i) => i>0 && LOWER.has(w) ? w : w[0].toUpperCase()+w.slice(1)).join(" ");
(async () => {
  const rows = await p.$queryRawUnsafe(`SELECT m."pfcPrimary" p, c."name" n FROM "CategoryMapping" m JOIN "Category" c ON c.id = m."categoryId"`);
  const bad = rows.filter(r => r.n !== humanize(r.p));
  console.log("mappings:", rows.length, "| mismatches:", bad.length, JSON.stringify(bad));
  const cats = await p.$queryRawUnsafe(`SELECT COUNT(*) n FROM "Category"`);
  console.log("categories:", Number(cats[0].n));
  const orphan = await p.$queryRawUnsafe(`
    SELECT DISTINCT CASE WHEN INSTR("userCategory",\" > \") > 0
      THEN SUBSTR("userCategory",1,INSTR("userCategory",\" > \")-1) ELSE "userCategory" END parent
    FROM "Transaction" WHERE "userCategory" IS NOT NULL
      AND parent NOT IN (SELECT "name" FROM "Category")`);
  console.log("in-use parents missing from Category:", orphan.length);
  await p.$disconnect();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
'
```

Expected: `mappings: 16 | mismatches: 0`, `categories: 23`, and `in-use parents missing from Category: 0`. **If mismatches is not 0, stop and report BLOCKED** — the seed has changed behaviour, which is the one thing it must not do.

- [ ] **Step 7: Export the primaries**

In `src/lib/rules.ts`, change `const PFC_PRIMARIES = [` to `export const PFC_PRIMARIES = [`. The Settings page needs the list to offer them, and it is the authoritative set.

- [ ] **Step 8: Verify nothing else broke**

```bash
npm test && npx tsc --noEmit
```
Expected: all suites pass, tsc clean. Nothing reads the new tables yet, so behaviour is unchanged.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/rules.ts
git commit -m "Make the category list a table, seeded from the constants"
```

---

### Task 2: The rename rewriter

**Files:**
- Create: `src/lib/category-rename.ts`
- Create: `scripts/test-categories.mjs`
- Modify: `package.json` (add the suite to `test`)

**Interfaces:**
- Consumes: nothing.
- Produces: `renameCategoryIn(value: string, from: string, to: string): string | null` from `src/lib/category-rename.ts` — the new value, or `null` when `value` does not reference `from`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-categories.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { renameCategoryIn } from "../src/lib/category-rename.ts";

test("an exact match becomes the new name", () => {
  assert.equal(renameCategoryIn("Dining", "Dining", "Food"), "Food");
});

test("a subcategory keeps its sub and gets the new parent", () => {
  assert.equal(
    renameCategoryIn("Home Improvement > Furniture", "Home Improvement", "Home"),
    "Home > Furniture"
  );
});

test("an unrelated value is left alone", () => {
  assert.equal(renameCategoryIn("Groceries", "Dining", "Food"), null);
});

test("a name that is a prefix of another does not rewrite it", () => {
  // "Home" must not capture "Home Improvement" — the separator is required.
  assert.equal(renameCategoryIn("Home Improvement", "Home", "House"), null);
});

test("a rename is case-sensitive", () => {
  assert.equal(renameCategoryIn("dining", "Dining", "Food"), null);
});

test("only the first separator is treated as the parent boundary", () => {
  assert.equal(
    renameCategoryIn("Travel > Flights > Intl", "Travel", "Trips"),
    "Trips > Flights > Intl"
  );
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node --test scripts/test-categories.mjs`
Expected: FAIL — cannot resolve `../src/lib/category-rename.ts`.

- [ ] **Step 3: Implement it**

Create `src/lib/category-rename.ts`:

```ts
/**
 * Rewriting a stored category string when its parent category is renamed.
 *
 * A category is stored as text — either a bare name or `"Parent > Sub"` — in
 * both Transaction.userCategory and CategoryRule.category. Renaming has to
 * rewrite the parent while leaving the subcategory intact.
 *
 * Deliberately free of imports so `node:test` can load it directly under
 * Node's native type stripping.
 */

/** The separator between a category and its subcategory. */
const SEPARATOR = " > ";

/**
 * The value `value` should become when category `from` is renamed to `to`, or
 * null when it does not reference `from` at all.
 *
 * The separator is required for the prefix case, so renaming "Home" never
 * captures "Home Improvement".
 */
export function renameCategoryIn(
  value: string,
  from: string,
  to: string
): string | null {
  if (value === from) return to;
  const prefix = from + SEPARATOR;
  if (value.startsWith(prefix)) return to + SEPARATOR + value.slice(prefix.length);
  return null;
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `node --test scripts/test-categories.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into `npm test`**

In `package.json`, add the new file to the `node --test` list so it reads:

```json
"test": "bash scripts/test-scrub.sh && bash scripts/test-launcher.sh && node --test scripts/test-links.mjs scripts/test-plaid-errors.mjs scripts/test-categories.mjs"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/category-rename.ts scripts/test-categories.mjs package.json
git commit -m "Rewrite a category reference without losing its subcategory"
```

---

### Task 3: The categories service

**Files:**
- Create: `src/services/categories.service.ts`

**Interfaces:**
- Consumes: `renameCategoryIn` from Task 2; the `Category` / `CategoryMapping` models from Task 1.
- Produces, all from `src/services/categories.service.ts`:
  - `interface CategoryDTO { id: string; name: string; plaidPrimaries: string[]; transactionCount: number; ruleCount: number }`
  - `listCategories(): Promise<CategoryDTO[]>` — alphabetical by name, with usage counts
  - `listCategoryNames(): Promise<string[]>` — alphabetical names only, for pickers
  - `createCategory(name: string): Promise<CategoryDTO>`
  - `renameCategory(id: string, newName: string): Promise<{ merged: boolean; movedTransactions: number; movedRules: number }>`
  - `setPlaidPrimaries(id: string, primaries: string[]): Promise<void>`
  - `deleteCategory(id: string, reassignTo?: string): Promise<void>`
  - `loadPlaidCategoryMap(): Promise<Map<string, string>>` — pfcPrimary → category name
  - `class CategoryInUseError extends Error` with `transactionCount`, `ruleCount`, `mappingCount`

- [ ] **Step 1: Write the service**

Create `src/services/categories.service.ts`:

```ts
/**
 * Reads and writes for the user's category list.
 *
 * A category is stored as text on transactions and rules, not as a relation, so
 * renaming means rewriting every reference and deleting means refusing while
 * references exist. Both of those live here rather than in a route, because the
 * rewrite has to happen in one transaction with the row it renames.
 */

import { prisma } from "@/lib/prisma";
import { renameCategoryIn } from "@/lib/category-rename";

export interface CategoryDTO {
  id: string;
  name: string;
  plaidPrimaries: string[];
  transactionCount: number;
  ruleCount: number;
}

/** Thrown when a delete would strand references. */
export class CategoryInUseError extends Error {
  constructor(
    readonly transactionCount: number,
    readonly ruleCount: number,
    readonly mappingCount: number
  ) {
    super("Category is still in use");
    this.name = "CategoryInUseError";
  }
}

/**
 * WHERE fragments matching a category used as a whole value or as a parent:
 * "Home Improvement" and "Home Improvement > Furniture" both count.
 *
 * These are built at the WHERE level rather than as a string filter, because
 * Prisma's StringFilter has no OR — `{ userCategory: { OR: [...] } }` does not
 * compile.
 */
function txUsing(name: string) {
  return {
    OR: [{ userCategory: name }, { userCategory: { startsWith: name + " > " } }],
  };
}

function ruleUsing(name: string) {
  return {
    OR: [{ category: name }, { category: { startsWith: name + " > " } }],
  };
}

/** Just the names, for the pickers — one cheap query, no usage counts. */
export async function listCategoryNames(): Promise<string[]> {
  const rows = await prisma.category.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => r.name);
}

/**
 * The full list with usage counts. Two counts per category is a couple of dozen
 * queries on a list this size — fine for the Settings page, which is the only
 * caller that needs the counts. Pickers use listCategoryNames instead.
 */
export async function listCategories(): Promise<CategoryDTO[]> {
  const rows = await prisma.category.findMany({
    include: { plaidMappings: { select: { pfcPrimary: true } } },
    orderBy: { name: "asc" },
  });

  return Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      name: c.name,
      plaidPrimaries: c.plaidMappings.map((m) => m.pfcPrimary).sort(),
      transactionCount: await prisma.transaction.count({
        where: txUsing(c.name),
      }),
      ruleCount: await prisma.categoryRule.count({
        where: ruleUsing(c.name),
      }),
    }))
  );
}

export async function createCategory(name: string): Promise<CategoryDTO> {
  const created = await prisma.category.create({ data: { name: name.trim() } });
  return {
    id: created.id,
    name: created.name,
    plaidPrimaries: [],
    transactionCount: 0,
    ruleCount: 0,
  };
}

/**
 * Rename, rewriting every stored reference. Renaming onto a name that already
 * exists is a MERGE, not an error: references move to the existing category,
 * this category's Plaid primaries move with them, and this row is deleted.
 * That is the operation that collapses a duplicate like Dining / Food and Drink.
 */
export async function renameCategory(
  id: string,
  newName: string
): Promise<{ merged: boolean; movedTransactions: number; movedRules: number }> {
  const to = newName.trim();
  const source = await prisma.category.findUnique({ where: { id } });
  if (!source) throw new Error("Category not found");
  if (source.name === to) return { merged: false, movedTransactions: 0, movedRules: 0 };

  const existing = await prisma.category.findUnique({ where: { name: to } });

  const txs = await prisma.transaction.findMany({
    where: txUsing(source.name),
    select: { id: true, userCategory: true },
  });
  const rules = await prisma.categoryRule.findMany({
    where: ruleUsing(source.name),
    select: { id: true, category: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const t of txs) {
      const next = renameCategoryIn(t.userCategory!, source.name, to);
      if (next !== null) {
        await tx.transaction.update({ where: { id: t.id }, data: { userCategory: next } });
      }
    }
    for (const r of rules) {
      const next = renameCategoryIn(r.category, source.name, to);
      if (next !== null) {
        await tx.categoryRule.update({ where: { id: r.id }, data: { category: next } });
      }
    }

    if (existing) {
      // Merge: hand this category's Plaid primaries to the survivor, then drop
      // it. Checking for the existing name first is what keeps the unique
      // constraint from ever being violated.
      await tx.categoryMapping.updateMany({
        where: { categoryId: source.id },
        data: { categoryId: existing.id },
      });
      await tx.category.delete({ where: { id: source.id } });
    } else {
      await tx.category.update({ where: { id: source.id }, data: { name: to } });
    }
  });

  return { merged: Boolean(existing), movedTransactions: txs.length, movedRules: rules.length };
}

/**
 * Set which Plaid primaries resolve to this category. A primary belongs to
 * exactly one category, so assigning it here removes it from wherever it was.
 */
export async function setPlaidPrimaries(id: string, primaries: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.categoryMapping.deleteMany({ where: { categoryId: id } });
    await tx.categoryMapping.deleteMany({ where: { pfcPrimary: { in: primaries } } });
    for (const pfcPrimary of primaries) {
      await tx.categoryMapping.create({ data: { pfcPrimary, categoryId: id } });
    }
  });
}

/**
 * Delete, refusing while references exist. With `reassignTo`, references are
 * moved to that category first — which is a rename onto an existing name, so it
 * reuses exactly that path.
 */
export async function deleteCategory(id: string, reassignTo?: string): Promise<void> {
  const cat = await prisma.category.findUnique({ where: { id } });
  if (!cat) throw new Error("Category not found");

  if (reassignTo) {
    await renameCategory(id, reassignTo); // merge; deletes this row
    return;
  }

  const [transactionCount, ruleCount, mappingCount] = await Promise.all([
    prisma.transaction.count({ where: txUsing(cat.name) }),
    prisma.categoryRule.count({ where: ruleUsing(cat.name) }),
    prisma.categoryMapping.count({ where: { categoryId: id } }),
  ]);
  if (transactionCount || ruleCount || mappingCount) {
    throw new CategoryInUseError(transactionCount, ruleCount, mappingCount);
  }

  await prisma.category.delete({ where: { id } });
}

/** pfcPrimary → category name, for resolving rows the user has not categorized. */
export async function loadPlaidCategoryMap(): Promise<Map<string, string>> {
  const rows = await prisma.categoryMapping.findMany({
    select: { pfcPrimary: true, category: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.pfcPrimary, r.category.name]));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify the read path against real data**

```bash
node --input-type=module -e '
const { PrismaClient } = await import("@prisma/client");
const p = new (PrismaClient)();
const rows = await p.$queryRawUnsafe(`
  SELECT c."name", (SELECT COUNT(*) FROM "Transaction" t WHERE t."userCategory" = c."name" OR t."userCategory" LIKE c."name" || " > %") n
  FROM "Category" c ORDER BY n DESC LIMIT 6`);
console.log(rows.map(r => r.name + ": " + Number(r.n)).join("\n"));
await p.$disconnect();
'
```
Expected: counts matching the data — Dining 37, Other 19, Reimbursement 14, Entertainment 13, Transfer 11, and Home Improvement 9 (2 bare plus 7 subcategorized, which is the prefix rule doing its job).

- [ ] **Step 4: Commit**

```bash
git add src/services/categories.service.ts
git commit -m "Own the category list, including what renaming costs"
```

---

### Task 4: The categories API

**Files:**
- Create: `src/app/api/categories/route.ts`
- Create: `src/app/api/categories/[id]/route.ts`

**Interfaces:**
- Consumes: everything from `src/services/categories.service.ts` (Task 3).
- Produces: `GET /api/categories` → `{ categories: CategoryDTO[], primaries: string[] }`; `POST /api/categories` `{ name }`; `PATCH /api/categories/:id` `{ name?, plaidPrimaries? }`; `DELETE /api/categories/:id?reassignTo=<name>`.

- [ ] **Step 1: Write the collection route**

Create `src/app/api/categories/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { listCategories, createCategory } from "@/services/categories.service";
import { PFC_PRIMARIES } from "@/lib/rules";

// GET /api/categories — the editable list, with how many transactions and rules
// use each, plus the Plaid primaries available to map. The counts are what let
// the UI disable a delete and explain the refusal.
export async function GET() {
  try {
    return NextResponse.json({
      categories: await listCategories(),
      primaries: [...PFC_PRIMARIES].sort(),
    });
  } catch (err) {
    console.error("[categories GET]", err);
    return NextResponse.json({ error: "Failed to load categories" }, { status: 500 });
  }
}

// POST /api/categories — body: { name }
export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };
    const trimmed = name?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "A name is required" }, { status: 400 });
    }
    if (trimmed.includes(" > ")) {
      return NextResponse.json(
        { error: "A category name cannot contain \" > \" — that separates a subcategory" },
        { status: 400 }
      );
    }
    return NextResponse.json({ category: await createCategory(trimmed) });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "That category already exists" }, { status: 409 });
    }
    console.error("[categories POST]", err);
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the item route**

Create `src/app/api/categories/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  renameCategory,
  setPlaidPrimaries,
  deleteCategory,
  CategoryInUseError,
} from "@/services/categories.service";

// PATCH /api/categories/:id — body: { name?, plaidPrimaries? }
// Renaming onto an existing name merges into it; the response says so, and how
// much moved, so the UI can report what actually happened.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { name?: string; plaidPrimaries?: string[] };

    let result = { merged: false, movedTransactions: 0, movedRules: 0 };
    if (body.plaidPrimaries) await setPlaidPrimaries(id, body.plaidPrimaries);
    if (body.name) {
      if (body.name.includes(" > ")) {
        return NextResponse.json(
          { error: "A category name cannot contain \" > \"" },
          { status: 400 }
        );
      }
      result = await renameCategory(id, body.name);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[categories PATCH]", err);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

// DELETE /api/categories/:id?reassignTo=<name> — without reassignTo, a category
// still in use is refused with the counts that explain why.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const reassignTo = new URL(req.url).searchParams.get("reassignTo") ?? undefined;
    await deleteCategory(id, reassignTo);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CategoryInUseError) {
      return NextResponse.json(
        {
          error: "Still in use",
          transactionCount: err.transactionCount,
          ruleCount: err.ruleCount,
          mappingCount: err.mappingCount,
        },
        { status: 409 }
      );
    }
    console.error("[categories DELETE]", err);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify against the running app**

Start the server with the `preview_start` tool (never `npm run dev` in a shell).

```bash
curl -s localhost:3000/api/categories | head -c 400
```
Expected: 23 categories with counts, and 16 primaries.

```bash
curl -s -X DELETE "localhost:3000/api/categories/cat_dining"
```
Expected: HTTP 409 with `transactionCount: 37`. **Do not** pass `reassignTo` here — that would rewrite real data.

Stop the server when finished.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/categories
git commit -m "Expose the category list, and refuse deletes that would strand rows"
```

---

### Task 5: Resolve Plaid's labels through the mapping

**Files:**
- Modify: `src/services/analytics.service.ts` (`fetchTxInputs`)
- Modify: `src/app/api/transactions/route.ts`

**Interfaces:**
- Consumes: `loadPlaidCategoryMap()` from Task 3.
- Produces: no new exports. After this task, an uncategorized transaction reports the user's category for its Plaid primary rather than Plaid's own wording.

- [ ] **Step 1: Resolve in analytics**

In `src/services/analytics.service.ts`, add to the imports:

```ts
import { loadPlaidCategoryMap } from "@/services/categories.service";
```

Inside `fetchTxInputs`, immediately before `return rows.flatMap((r) => {`, add:

```ts
  // Plaid's primaries resolve through the user's own mapping, so an
  // uncategorized row reports the category they chose rather than Plaid's
  // wording. Loaded once per query, not per row.
  const plaidMap = await loadPlaidCategoryMap();
  const plaidName = (primary: string) => plaidMap.get(primary) ?? humanizePfc(primary);
```

Then replace the two `humanizePfc(...)` call sites inside the mapper:
- `r.linkedTo.userCategory ?? humanizePfc(r.linkedTo.pfcPrimary)` becomes `r.linkedTo.userCategory ?? plaidName(r.linkedTo.pfcPrimary)`
- `category: uc ? uc.parent : humanizePfc(r.pfcPrimary)` becomes `category: uc ? uc.parent : plaidName(r.pfcPrimary)`

Keep the `humanizePfc` import — `plaidName` falls back to it for a primary with no mapping.

- [ ] **Step 2: Resolve in the transactions DTO**

In `src/app/api/transactions/route.ts`, add to the imports:

```ts
import { loadPlaidCategoryMap } from "@/services/categories.service";
```

After the `targetRows` / `refundRows` `Promise.all`, add:

```ts
    const plaidMap = await loadPlaidCategoryMap();
    const plaidName = (primary: string) => plaidMap.get(primary) ?? humanizePfc(primary);
```

Then replace every `humanizePfc(...)` used to name a *category* with `plaidName(...)`: the `targetsById` construction's `category`, and the returned DTO's `category`, `categoryDetailed` fallback, and `plaidCategory`. Leave `plaidCategoryDetailed` on `humanizePfc` — it names a Plaid *detailed* label, which the mapping does not cover.

- [ ] **Step 3: Verify the numbers are unchanged**

The seed is behaviour-preserving, so resolving through the map must produce exactly what it did before. Start the server with `preview_start` and compare:

```bash
curl -s 'localhost:3000/api/analytics?months=6' | head -c 300
```
Expected: the same `totalSpent`, `totalIncome` and category totals as before this task. **If any figure moved, stop and report BLOCKED** — the mapping is not reproducing the old behaviour, and every later task builds on the assumption that it does.

- [ ] **Step 4: Commit**

```bash
git add src/services/analytics.service.ts src/app/api/transactions/route.ts
git commit -m "Report an uncategorized row under the category the user chose"
```

---

### Task 6: Read the stored list everywhere a category is offered

**Files:**
- Modify: `src/app/api/venmo/route.ts`
- Modify: `src/app/api/venmo/[id]/route.ts`
- Modify: `src/app/api/zelle/route.ts`
- Modify: `src/app/api/zelle/[id]/route.ts`
- Modify: `src/components/TransactionLedger.tsx`
- Modify: `src/components/TransactionTable.tsx`
- Modify: `src/components/RulesDashboard.tsx`

**Interfaces:**
- Consumes: `listCategoryNames()` from Task 3, `GET /api/categories` from Task 4.
- Produces: `TransactionTable` gains a required prop `categories: string[]`.

- [ ] **Step 1: Serve the stored list from the P2P endpoints**

In `src/app/api/venmo/route.ts`, replace the `VENMO_CATEGORIES` import with:

```ts
import { listCategoryNames } from "@/services/categories.service";
```

and change the response to:

```ts
    return NextResponse.json({ transactions, categories: await listCategoryNames() });
```

Use `listCategoryNames`, not `listCategories` — the latter runs two count queries
per category to power the Settings page, and a picker does not need them.

Apply the identical change in `src/app/api/zelle/route.ts`: replace its `ZELLE_CATEGORIES` import with the same service import (keep the `isZelleName` and `parseZelleCounterparty` imports from `@/lib/zelle`), and change its response to:

```ts
    return NextResponse.json({ transactions, categories: await listCategoryNames() });
```

- [ ] **Step 2: Validate against the stored list**

In `src/app/api/venmo/[id]/route.ts`, replace the `VENMO_CATEGORIES` import with `import { listCategoryNames } from "@/services/categories.service";` and replace the validation block with:

```ts
    // Validate against the user's own list — a hardcoded set would reject the
    // categories they just created.
    const names = new Set(await listCategoryNames());
    if (!category || !names.has(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
```

In `src/app/api/zelle/[id]/route.ts`, replace its `ZELLE_CATEGORIES` import the same way and replace its validation block with the same five lines. Note Zelle's `updateMany` keeps its existing `category === "Uncategorized" ? null : category` behaviour; only the validation changes.

- [ ] **Step 3: Feed the ledger from the API**

In `src/components/TransactionLedger.tsx`, add state and a fetch beside the existing accounts fetch:

```tsx
  const [categories, setCategories] = useState<string[]>([]);
```

```tsx
  // The editable category list, for the row editor's picker.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && !cancelled) {
          setCategories(json.categories.map((c: { name: string }) => c.name));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
```

and pass it down, alongside the existing props:

```tsx
            <TransactionTable
              transactions={data?.transactions ?? []}
              onChanged={load}
              categories={categories}
            />
```

- [ ] **Step 4: Use it in the table**

In `src/components/TransactionTable.tsx`, remove the `RULE_CATEGORIES` import. Add `categories: string[]` to `TransactionTable`'s props and thread it to `CategoryEditor` as a prop of the same name. In `CategoryEditor`, replace the `options` memo with:

```tsx
  // Selectable categories: the user's list, plus whatever this row already
  // shows (e.g. a Plaid primary with no mapping) so nothing gets orphaned.
  const options = useMemo(() => {
    const set = new Set(categories);
    set.add(category);
    set.add(transaction.plaidCategory);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [categories, category, transaction.plaidCategory]);
```

- [ ] **Step 5: Feed the Rules page**

In `src/components/RulesDashboard.tsx`, remove `RULE_CATEGORIES` from the `@/lib/rules` import (keep the others). In the component that renders the category select, add:

```tsx
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && !cancelled) {
          setCategories(json.categories.map((c: { name: string }) => c.name));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
```

Change the initial state `useState<string>(RULE_CATEGORIES[0] ?? "")` to `useState<string>("")`, and after the fetch resolves default it when still empty. Replace `{RULE_CATEGORIES.map((c) => (` with `{categories.map((c) => (`.

- [ ] **Step 6: Verify in the browser**

Start the server with `preview_start`. Confirm: the ledger's category picker lists the 23 categories; `/rules` offers the same; `/venmo` and `/zelle` now offer the full list rather than 9. Check `read_console_messages` for errors. Stop the server.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/api/venmo src/app/api/zelle src/components/TransactionLedger.tsx src/components/TransactionTable.tsx src/components/RulesDashboard.tsx
git commit -m "Offer the user's own categories instead of a fixed list"
```

---

### Task 7: The Settings page

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/components/SettingsCategories.tsx`
- Modify: `src/components/SideNav.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/categories` and `PATCH/DELETE /api/categories/:id` from Task 4.
- Produces: the `/settings` route.

- [ ] **Step 1: Add the nav entry**

In `src/components/SideNav.tsx`, add to the end of the `NAV` array, after Income:

```tsx
  { href: "/settings", label: "Settings", code: "SET" },
```

- [ ] **Step 2: Add the page**

Create `src/app/settings/page.tsx`:

```tsx
import { SettingsCategories } from "@/components/SettingsCategories";

export const metadata = {
  title: "Settings · Budget Claude",
};

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsCategories />
    </main>
  );
}
```

- [ ] **Step 3: Build the editor**

Create `src/components/SettingsCategories.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

interface Category {
  id: string;
  name: string;
  plaidPrimaries: string[];
  transactionCount: number;
  ruleCount: number;
}

export function SettingsCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [primaries, setPrimaries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      const json = await res.json();
      setCategories(json.categories);
      setPrimaries(json.primaries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const call = async (input: string, init: RequestInit, onOk?: (b: unknown) => void) => {
    setError(null);
    setNotice(null);
    const res = await fetch(input, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        body.transactionCount !== undefined
          ? `Still used by ${body.transactionCount} transaction(s), ${body.ruleCount} rule(s) and ${body.mappingCount} Plaid label(s) — reassign them first.`
          : (body.error ?? "Something went wrong")
      );
      return;
    }
    onOk?.(body);
    await load();
  };

  const rename = (c: Category, name: string) => {
    if (!name.trim() || name.trim() === c.name) return setEditing(null);
    const target = categories.find((x) => x.name === name.trim() && x.id !== c.id);
    if (
      target &&
      !confirm(
        `Merge "${c.name}" into "${target.name}"?\n\n${c.transactionCount} transaction(s) and ${c.ruleCount} rule(s) will move, and "${c.name}" will be removed.`
      )
    ) {
      return setEditing(null);
    }
    setEditing(null);
    void call(
      `/api/categories/${c.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      },
      (b) => {
        const r = b as { merged: boolean; movedTransactions: number };
        setNotice(
          r.merged
            ? `Merged into "${name.trim()}" — ${r.movedTransactions} transaction(s) moved.`
            : `Renamed — ${r.movedTransactions} transaction(s) updated.`
        );
      }
    );
  };

  const togglePrimary = (c: Category, primary: string) => {
    const next = c.plaidPrimaries.includes(primary)
      ? c.plaidPrimaries.filter((p) => p !== primary)
      : [...c.plaidPrimaries, primary];
    void call(`/api/categories/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plaidPrimaries: next }),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          Categories — used by the ledger, Rules, Venmo and Zelle. Renaming one onto
          another merges them.
        </p>
      </header>

      {notice && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          void call("/api/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: adding.trim() }),
          });
          setAdding("");
        }}
        className="flex gap-2"
      >
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="New category"
          className="w-56 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40"
        />
        <button
          type="submit"
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black"
        >
          Add
        </button>
      </form>

      {loading ? (
        <div className="rounded-lg border border-black/10 px-6 py-16 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-black/50 dark:border-white/10 dark:text-white/50">
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Used by</th>
                <th className="px-4 py-3 font-medium">Plaid labels</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-black/[0.06] align-top last:border-0 dark:border-white/[0.06]"
                >
                  <td className="px-4 py-3 font-medium">
                    {editing === c.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => rename(c, draft)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") rename(c, draft);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="w-44 rounded border border-black/15 bg-white px-1.5 py-1 dark:border-white/20 dark:bg-neutral-900"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(c.id);
                          setDraft(c.name);
                        }}
                        className="hover:underline"
                        title="Rename (renaming onto another category merges them)"
                      >
                        {c.name}
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-black/55 dark:text-white/55">
                    {c.transactionCount} tx · {c.ruleCount} rule
                    {c.ruleCount === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {primaries.map((p) => {
                        const on = c.plaidPrimaries.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => togglePrimary(c, p)}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              on
                                ? "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
                                : "bg-black/[0.04] text-black/35 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-white/35"
                            }`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`Delete "${c.name}"?`)) return;
                        void call(`/api/categories/${c.id}`, { method: "DELETE" });
                      }}
                      className="rounded px-2 py-1 text-xs text-black/50 hover:bg-black/[0.06] dark:text-white/50 dark:hover:bg-white/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify in the browser**

Start the server with `preview_start` and open `/settings`. Confirm: Settings appears in the sidebar under Income; the 23 categories list with their counts; the Plaid labels show as toggles with the seeded ones lit.

Then exercise each operation, **undoing each one**: add a category called `Zzz Test` and delete it; toggle a Plaid label off and back on; attempt to delete `Dining` and confirm the refusal names 37 transactions. **Do not perform a rename or a merge on real data during this task** — Task 8 verifies those deliberately and reverses them.

Screenshot the page and check `read_console_messages`. Stop the server.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/settings src/components/SettingsCategories.tsx src/components/SideNav.tsx
git commit -m "Add a Settings page for editing categories"
```

---

### Task 8: Full verification, rename round-trip, and rebuild

**Files:** none modified unless a check fails.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: the two bash suites plus all `node:test` suites pass, including the 6 new category tests.

- [ ] **Step 2: Lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```
Expected: clean, scoping lint to `src` (an unscoped run surfaces pre-existing `.next-preview` noise).

- [ ] **Step 3: Confirm the data is intact**

```bash
node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const q = async (l, s) => console.log(l, JSON.stringify(await p.$queryRawUnsafe(s), (k,v)=>typeof v==="bigint"?Number(v):v));
  await q("categories:", `SELECT COUNT(*) n FROM "Category"`);
  await q("mappings:", `SELECT COUNT(*) n FROM "CategoryMapping"`);
  await q("orphan mappings:", `SELECT COUNT(*) n FROM "CategoryMapping" m LEFT JOIN "Category" c ON c.id=m."categoryId" WHERE c.id IS NULL`);
  await q("provenance:", `SELECT userCategorySource src, COUNT(*) n FROM "Transaction" GROUP BY userCategorySource ORDER BY src`);
  await q("labels:", `SELECT COUNT(*) rows, COUNT(DISTINCT label) labels FROM "Transaction"`);
  await p.$disconnect();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
'
```
Expected: 23 categories, 16 mappings, 0 orphan mappings, provenance `null=615, MANUAL=15, VENMO=13`, and 643 rows with 643 distinct labels. **Any deviation means an earlier task altered real data — stop and report it.**

- [ ] **Step 4: Verify a rename round-trip on real data**

This is the one operation that rewrites the user's records, so prove it reverses cleanly. With the server running via `preview_start`, on `/settings`:

1. Note the exact transaction count for `Home Improvement` (expect 9 — 2 bare plus 7 subcategorized).
2. Rename `Home Improvement` to `Home Improvement Test`.
3. Confirm in the ledger that a subcategorized row now reads `Home Improvement Test > Furniture` — the subcategory survived.
4. Rename it back to `Home Improvement`.
5. Re-run the query below and confirm the categories in use are byte-identical to before.

```bash
node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.$queryRawUnsafe(`SELECT userCategory, COUNT(*) n FROM "Transaction" WHERE userCategory IS NOT NULL GROUP BY userCategory ORDER BY userCategory`)
 .then(r => { console.log(r.map(x => x.userCategory + ": " + Number(x.n)).join("\n")); return p.$disconnect(); });
'
```
Expected afterwards: `Dining: 37, Entertainment: 13, Food and Drink: 1, Food and Drink > Snack: 1, Groceries: 5, Home Improvement: 2, Home Improvement > Furniture: 7, Housing: 10, Other: 19, Reimbursement: 14, Rent and Utilities: 3, Transfer: 11, Travel: 10`.

Stop the server.

- [ ] **Step 5: Rebuild the served bundle**

Run: `bash Budget.command --no-open`
Expected: a successful build. The app serves a prebuilt bundle, so skipping this serves stale code.

- [ ] **Step 6: Commit anything the checks changed**

```bash
git status --short
```
If clean, nothing to do. Otherwise commit the fixes with a message describing what the check caught.
