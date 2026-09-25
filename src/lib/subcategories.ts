/**
 * Assembling each category's subcategory list for Settings.
 *
 * A subcategory reaches the list three ways: declared in Settings (a
 * Subcategory row, possibly unused so far), simply used — a transaction or
 * rule storing "Parent > Sub" that nobody declared, because the ledger takes
 * free text — or preset: one of Plaid's detailed labels, which is what a row
 * shows as its sub until someone categorizes it by hand. The list is the
 * union, with usage counts, so what Settings shows matches what the ledger
 * shows.
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
  /** Plaid detailed labels that show as this sub, with Plaid's name for each. */
  plaidLabels: { code: string; name: string }[];
  /** Rows showing it through one of those labels, i.e. not categorized by hand. */
  plaidTransactionCount: number;
  /** Whether any of those labels carries a name the user gave it. */
  renamed: boolean;
}

/** One of Plaid's detailed labels, already resolved to where the ledger shows it. */
export interface PresetSub {
  parent: string;
  /** What it shows as: the user's name for it, else `plaidName`. */
  name: string;
  /** Plaid's own name for it. */
  plaidName: string;
  code: string;
  count: number;
  renamed: boolean;
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
  rules: ValueCount[],
  presets: PresetSub[] = []
): Map<string, SubcategoryUsage[]> {
  const byParent = new Map<string, Map<string, SubcategoryUsage>>(
    parents.map((p) => [p, new Map()])
  );
  const entry = (parent: string, name: string) => {
    const subs = byParent.get(parent);
    if (!subs) return null;
    let e = subs.get(name);
    if (!e) {
      e = {
        name,
        declared: false,
        transactionCount: 0,
        ruleCount: 0,
        plaidLabels: [],
        plaidTransactionCount: 0,
        renamed: false,
      };
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
  for (const p of presets) {
    const e = entry(p.parent, p.name);
    if (!e) continue;
    e.plaidLabels.push({ code: p.code, name: p.plaidName });
    e.plaidTransactionCount += p.count;
    e.renamed ||= p.renamed;
  }

  return new Map(
    [...byParent].map(([parent, subs]) => [
      parent,
      [...subs.values()]
        .map((e) => ({
          ...e,
          plaidLabels: e.plaidLabels.sort((a, b) => a.code.localeCompare(b.code)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ])
  );
}
