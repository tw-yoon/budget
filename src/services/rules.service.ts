/**
 * CRUD and application logic for the auto-categorization rules engine.
 *
 * Rules write `userCategory` (stamped with `userCategorySource = "RULE"`) so the
 * existing analytics resolution (`userCategory ?? humanizePfc(pfcPrimary)`)
 * picks them up for free. To avoid clobbering a Venmo- or manually-assigned
 * category, rules only touch rows whose `userCategorySource` is null or "RULE".
 */

import { prisma } from "@/lib/prisma";
import {
  firstMatch,
  firstMatchingRule,
  ruleOutcomes,
  isHandSet,
  type RuleOutcome,
} from "@/lib/rules";
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

/**
 * Every transaction a rule could ever touch, with who set its category. A
 * connected row takes its category from its link and is never a rule's.
 */
function unlinkedRows() {
  return prisma.transaction.findMany({
    where: { linkedToId: null },
    select: {
      id: true,
      name: true,
      merchantName: true,
      userCategory: true,
      userCategorySource: true,
    },
  });
}

/**
 * All rules, each with how its matches stand (see ruleOutcomes). A disabled
 * rule matches nothing, so its outcome is null.
 */
export async function listRulesWithOutcomes(): Promise<
  (CategoryRule & { outcome: RuleOutcome | null })[]
> {
  const [rules, rows] = await Promise.all([listRules(), unlinkedRows()]);
  const outcomes = ruleOutcomes(
    rules.filter((r) => r.enabled),
    rows
  );
  return rules.map((r) => ({ ...r, outcome: outcomes.get(r.id) ?? null }));
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
 * Returns how many rows changed, and how many matched but were kept because
 * they were set by hand. Backs the "Apply now" button.
 */
export async function applyRulesToExisting(): Promise<{ updated: number; kept: number }> {
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

  const kept = (await unlinkedRows()).filter(
    (row) => isHandSet(row.userCategorySource) && categorizeRow(rules, row) !== null
  ).length;

  return { updated, kept };
}

/**
 * Let a rule take over the hand-set rows it matches: those where it is the
 * first matching rule, but whose category was set by hand and so kept. Their
 * hand-set category is replaced, and from then on they follow the rule.
 * Returns how many rows changed.
 */
export async function takeOverHandSet(ruleId: string): Promise<{ updated: number }> {
  const rules = await getEnabledRulesOrdered();
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) throw new Error("Rule not found or off");

  const ids = (await unlinkedRows())
    .filter(
      (row) =>
        isHandSet(row.userCategorySource) && firstMatchingRule(rules, row)?.id === rule.id
    )
    .map((row) => row.id);

  const { count } = await prisma.transaction.updateMany({
    // linkedToId: null again, in case a row was connected since it was read.
    where: { id: { in: ids }, linkedToId: null },
    data: { userCategory: rule.category, userCategorySource: "RULE" },
  });
  return { updated: count };
}
