/**
 * Assembling each category's subcategory list for Settings.
 *
 * A subcategory reaches the list two ways: declared in Settings (a
 * Subcategory row, possibly unused so far), or simply used — a transaction or
 * rule storing "Parent > Sub" that nobody declared, because the ledger takes
 * free text. The list is the union, with usage counts, so what Settings shows
 * matches what the data actually holds.
 *
 * Deliberately free of imports so `node:test` can load it directly under
 * Node's native type stripping.
 */

/** The separator between a category and its subcategory. */
const SEPARATOR = " > ";

export interface SubcategoryUsage {
  name: string;
  declared: boolean;
  transactionCount: number;
  ruleCount: number;
}

/** A stored category value and how many rows carry it. */
export interface ValueCount {
  value: string;
  count: number;
}

/** Parent and sub of a stored value, or null for a bare category. */
function parse(value: string): { parent: string; sub: string } | null {
  const idx = value.indexOf(SEPARATOR);
  if (idx === -1) return null;
  const parent = value.slice(0, idx).trim();
  const sub = value.slice(idx + SEPARATOR.length).trim();
  return sub ? { parent, sub } : null;
}

/**
 * Parent name → its subcategories, sorted by name. Only parents in `parents`
 * get an entry; a used sub whose parent is not a category (a Plaid label, say)
 * has nowhere to be listed and is left out.
 */
export function groupSubcategories(
  parents: string[],
  declared: { parent: string; name: string }[],
  transactions: ValueCount[],
  rules: ValueCount[]
): Map<string, SubcategoryUsage[]> {
  const byParent = new Map<string, Map<string, SubcategoryUsage>>(
    parents.map((p) => [p, new Map()])
  );
  const entry = (parent: string, name: string) => {
    const subs = byParent.get(parent);
    if (!subs) return null;
    let e = subs.get(name);
    if (!e) {
      e = { name, declared: false, transactionCount: 0, ruleCount: 0 };
      subs.set(name, e);
    }
    return e;
  };

  for (const d of declared) {
    const e = entry(d.parent, d.name);
    if (e) e.declared = true;
  }
  for (const t of transactions) {
    const p = parse(t.value);
    const e = p && entry(p.parent, p.sub);
    if (e) e.transactionCount += t.count;
  }
  for (const r of rules) {
    const p = parse(r.value);
    const e = p && entry(p.parent, p.sub);
    if (e) e.ruleCount += r.count;
  }

  return new Map(
    [...byParent].map(([parent, subs]) => [
      parent,
      [...subs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ])
  );
}
