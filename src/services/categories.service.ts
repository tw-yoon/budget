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
  resolvedTransactionCount: number;
}

/** Thrown when a delete would strand references. */
export class CategoryInUseError extends Error {
  constructor(
    readonly transactionCount: number,
    readonly ruleCount: number,
    readonly mappingCount: number,
    readonly splitCount: number
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
 * Categories whose exact name carries behaviour elsewhere in the app, so
 * renaming or deleting one would silently change what it means rather than
 * just what it is called. "Transfer" is the exclusion marker that keeps a row
 * out of spending analytics and hides it behind "Hide transfers & fees".
 */
const RESERVED_NAMES = new Set(["Transfer"]);

/** Thrown when an edit would change a name the app's behaviour depends on. */
export class ReservedCategoryError extends Error {
  constructor(readonly categoryName: string) {
    super(
      `"${categoryName}" controls how transactions are excluded from spending — it cannot be renamed or deleted`
    );
    this.name = "ReservedCategoryError";
  }
}

/** Thrown when a rename would merge into an existing category without confirmation. */
export class MergeNotConfirmedError extends Error {
  constructor(
    readonly targetName: string,
    readonly movingTransactions: number,
    readonly movingRules: number,
    readonly movingResolved: number,
    readonly movingSplits: number
  ) {
    super(`Renaming would merge into "${targetName}"`);
    this.name = "MergeNotConfirmedError";
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

function splitUsing(name: string) {
  return {
    OR: [{ userCategory: name }, { userCategory: { startsWith: name + " > " } }],
  };
}

/**
 * Transactions that would be re-labelled by a change to this category: those
 * naming it directly, plus those with no category of their own that resolve
 * through one of its Plaid mappings. The second group is usually much larger,
 * and it is the group a merge confirmation must not omit.
 */
async function addResolved(direct: number, primaries: string[]): Promise<number> {
  if (primaries.length === 0) return direct;
  const viaPlaid = await prisma.transaction.count({
    where: { userCategory: null, pfcPrimary: { in: primaries } },
  });
  return direct + viaPlaid;
}

/** The same figure for a caller holding neither the direct count nor the mappings. */
async function resolvedCount(categoryId: string, name: string): Promise<number> {
  const direct = await prisma.transaction.count({ where: txUsing(name) });
  const primaries = (
    await prisma.categoryMapping.findMany({
      where: { categoryId },
      select: { pfcPrimary: true },
    })
  ).map((m) => m.pfcPrimary);
  return addResolved(direct, primaries);
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
 * The full list with usage counts. Up to three counts per category is a few
 * dozen queries on a list this size — fine for the Settings page, which is the
 * only caller that needs the counts. Pickers use listCategoryNames instead.
 */
export async function listCategories(): Promise<CategoryDTO[]> {
  const rows = await prisma.category.findMany({
    include: { plaidMappings: { select: { pfcPrimary: true } } },
    orderBy: { name: "asc" },
  });

  return Promise.all(
    rows.map(async (c) => {
      const plaidPrimaries = c.plaidMappings.map((m) => m.pfcPrimary).sort();
      // The direct count is also the first half of the resolved count, and the
      // mappings came back with the row: hand both to addResolved rather than
      // letting resolvedCount fetch them again.
      const transactionCount = await prisma.transaction.count({
        where: txUsing(c.name),
      });
      return {
        id: c.id,
        name: c.name,
        plaidPrimaries,
        transactionCount,
        ruleCount: await prisma.categoryRule.count({
          where: ruleUsing(c.name),
        }),
        resolvedTransactionCount: await addResolved(transactionCount, plaidPrimaries),
      };
    })
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
    resolvedTransactionCount: 0,
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
  newName: string,
  allowMerge = false
): Promise<{
  merged: boolean;
  movedTransactions: number;
  movedRules: number;
  movedResolved: number;
}> {
  const to = newName.trim();
  const source = await prisma.category.findUnique({ where: { id } });
  if (!source) throw new Error("Category not found");
  if (RESERVED_NAMES.has(source.name)) throw new ReservedCategoryError(source.name);
  if (source.name === to)
    return { merged: false, movedTransactions: 0, movedRules: 0, movedResolved: 0 };

  const existing = await prisma.category.findUnique({ where: { name: to } });

  const txs = await prisma.transaction.findMany({
    where: txUsing(source.name),
    select: { id: true, userCategory: true },
  });
  const rules = await prisma.categoryRule.findMany({
    where: ruleUsing(source.name),
    select: { id: true, category: true },
  });
  const splits = await prisma.transactionSplit.findMany({
    where: splitUsing(source.name),
    select: { id: true, userCategory: true },
  });
  // Computed before the transaction below runs, since a merge deletes `source`.
  const resolved = await resolvedCount(source.id, source.name);

  // A merge moves references and deletes a category — the caller has to have
  // said yes to that. Deciding here rather than in the client is what makes the
  // confirmation trustworthy: the client's list can be stale, this cannot.
  if (existing && !allowMerge) {
    throw new MergeNotConfirmedError(
      existing.name,
      txs.length,
      rules.length,
      resolved,
      splits.length
    );
  }

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
    for (const s of splits) {
      const next = renameCategoryIn(s.userCategory, source.name, to);
      if (next !== null) {
        await tx.transactionSplit.update({ where: { id: s.id }, data: { userCategory: next } });
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

  return {
    merged: Boolean(existing),
    movedTransactions: txs.length,
    movedRules: rules.length,
    movedResolved: resolved,
  };
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
  if (RESERVED_NAMES.has(cat.name)) throw new ReservedCategoryError(cat.name);

  if (reassignTo) {
    // Reassigning is a merge into an EXISTING category. Without this check
    // renameCategory would take its plain-rename branch and quietly rename this
    // row instead of deleting it, while the caller believed the delete happened.
    const target = await prisma.category.findUnique({ where: { name: reassignTo } });
    if (!target || target.id === id) throw new UnknownCategoryError(reassignTo);
    await renameCategory(id, reassignTo, true); // merges into target, deleting this row
    return;
  }

  const [transactionCount, ruleCount, mappingCount, splitCount] = await Promise.all([
    prisma.transaction.count({ where: txUsing(cat.name) }),
    prisma.categoryRule.count({ where: ruleUsing(cat.name) }),
    prisma.categoryMapping.count({ where: { categoryId: id } }),
    prisma.transactionSplit.count({ where: splitUsing(cat.name) }),
  ]);
  if (transactionCount || ruleCount || mappingCount || splitCount) {
    throw new CategoryInUseError(transactionCount, ruleCount, mappingCount, splitCount);
  }

  await prisma.category.delete({ where: { id } });
}

/**
 * Real Plaid primaries seen on transactions that resolve to no category
 * mapping. `PFC_PRIMARIES` (the fixed catalog offered as togglable Plaid
 * labels in Settings) does not cover every primary Plaid has ever returned —
 * a transaction carrying one of the others can never be mapped through the
 * UI, so it silently reports Plaid's own wording forever and will not follow
 * if a category is later renamed. Surfacing these is Settings' job; widening
 * the catalog is a seed decision left to the user.
 */
export async function listUnmappedPrimaries(): Promise<
  { pfcPrimary: string; transactionCount: number }[]
> {
  const mapped = new Set(
    (await prisma.categoryMapping.findMany({ select: { pfcPrimary: true } })).map(
      (m) => m.pfcPrimary
    )
  );
  // Only rows with no category of their own fall through to Plaid's label. A
  // row that already carries a category is unaffected by the missing mapping —
  // counting it would make the banner claim a problem the user does not have.
  const grouped = await prisma.transaction.groupBy({
    by: ["pfcPrimary"],
    where: { userCategory: null },
    _count: { _all: true },
  });
  return grouped
    .filter((g) => !mapped.has(g.pfcPrimary))
    .map((g) => ({ pfcPrimary: g.pfcPrimary, transactionCount: g._count._all }))
    .sort((a, b) => b.transactionCount - a.transactionCount);
}

/** pfcPrimary → category name, for resolving rows the user has not categorized. */
export async function loadPlaidCategoryMap(): Promise<Map<string, string>> {
  const rows = await prisma.categoryMapping.findMany({
    select: { pfcPrimary: true, category: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.pfcPrimary, r.category.name]));
}
