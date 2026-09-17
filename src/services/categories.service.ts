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

/** Thrown when a reassign target does not resolve to another existing category. */
export class UnknownCategoryError extends Error {
  constructor(readonly categoryName: string) {
    super(`No category named "${categoryName}"`);
    this.name = "UnknownCategoryError";
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
    // Reassigning is a merge into an EXISTING category. Without this check
    // renameCategory would take its plain-rename branch and quietly rename this
    // row instead of deleting it, while the caller believed the delete happened.
    const target = await prisma.category.findUnique({ where: { name: reassignTo } });
    if (!target || target.id === id) throw new UnknownCategoryError(reassignTo);
    await renameCategory(id, reassignTo); // merges into target, deleting this row
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
