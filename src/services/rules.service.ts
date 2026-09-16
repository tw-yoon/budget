/**
 * CRUD and application logic for the auto-categorization rules engine.
 *
 * Rules write `userCategory` (stamped with `userCategorySource = "RULE"`) so the
 * existing analytics resolution (`userCategory ?? humanizePfc(pfcPrimary)`)
 * picks them up for free. To avoid clobbering a Venmo- or manually-assigned
 * category, rules only touch rows whose `userCategorySource` is null or "RULE".
 */

import { prisma } from "@/lib/prisma";
import { firstMatch } from "@/lib/rules";
import type { CategoryRule, Prisma } from "@prisma/client";

/** Enabled rules in evaluation order: priority asc, then oldest first. */
export async function getEnabledRulesOrdered(): Promise<CategoryRule[]> {
  return prisma.categoryRule.findMany({
    where: { enabled: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

/** All rules for the management UI (enabled or not). */
export async function listRules(): Promise<CategoryRule[]> {
  return prisma.categoryRule.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

export async function createRule(
  data: Pick<CategoryRule, "field" | "matchType" | "pattern" | "category"> &
    Partial<Pick<CategoryRule, "priority" | "enabled">>
): Promise<CategoryRule> {
  return prisma.categoryRule.create({ data });
}

export async function updateRule(
  id: string,
  data: Prisma.CategoryRuleUpdateInput
): Promise<CategoryRule> {
  return prisma.categoryRule.update({ where: { id }, data });
}

export async function deleteRule(id: string): Promise<void> {
  await prisma.categoryRule.delete({ where: { id } });
}

/**
 * Given the ordered enabled rules, return the category for a single row, or
 * null if no rule matches. Used inline by the sync service so new transactions
 * are categorized as they arrive.
 */
export function categorizeRow(
  rules: CategoryRule[],
  tx: { name: string; merchantName: string | null }
): string | null {
  return firstMatch(rules, tx);
}

/**
 * Re-apply all enabled rules to existing transactions. Only rows that are
 * rule-owned or uncategorized are eligible (manual/Venmo categories are kept).
 * Returns how many rows changed. Backs the "Apply now" button.
 */
export async function applyRulesToExisting(): Promise<{ updated: number }> {
  const rules = await getEnabledRulesOrdered();

  const rows = await prisma.transaction.findMany({
    where: {
      linkedToId: null,
      OR: [{ userCategorySource: null }, { userCategorySource: "RULE" }],
    },
    select: {
      id: true,
      name: true,
      merchantName: true,
      userCategory: true,
      userCategorySource: true,
    },
  });

  let updated = 0;
  for (const row of rows) {
    const match = categorizeRow(rules, row);

    if (match) {
      if (row.userCategory !== match || row.userCategorySource !== "RULE") {
        await prisma.transaction.update({
          where: { id: row.id },
          data: { userCategory: match, userCategorySource: "RULE" },
        });
        updated++;
      }
    } else if (row.userCategorySource === "RULE") {
      // Previously rule-categorized but no rule matches anymore — clear it.
      await prisma.transaction.update({
        where: { id: row.id },
        data: { userCategory: null, userCategorySource: null },
      });
      updated++;
    }
  }

  return { updated };
}
