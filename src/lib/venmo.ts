/**
 * Parsing + categorization helpers for Venmo CSV statements.
 *
 * A Venmo statement is messy: two preamble lines, a header row offset by one
 * empty column, a beginning/ending balance row, and a multi-line quoted
 * disclaimer at the end. We pull out only the real transaction rows.
 *
 * Sign convention (Venmo's): "- $X" is money the account holder SENT, "+ $X"
 * is money they RECEIVED. We translate to Plaid's convention on import
 * (positive = outflow), so sent => +amount, received => -amount.
 */

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const VENMO_CATEGORIES = [
  "Dining",
  "Groceries",
  "Travel",
  "Entertainment",
  "Housing",
  "Shopping",
  "Reimbursement",
  "Transfer",
  "Other",
] as const;

export type VenmoCategory = (typeof VENMO_CATEGORIES)[number];

// note keyword -> category. Lowercased substring/regex match. Intentionally
// modest, and deliberately about kinds of merchant rather than particular
// places: most Venmo notes are cryptic, so this only seeds a starting guess
// that you then correct by hand on the /transactions/venmo page.
const RULES: [RegExp, VenmoCategory][] = [
  [/walmart|wal\s*mart|sam.?s club|costco|grocer|target|kroger|safeway|aldi|trader/, "Groceries"],
  [/dinner|lunch|brunch|food|pizza|🍕|burger|taco|🌮|sushi|ramen|coffee|boba|bar tab/, "Dining"],
  [/uber|lyft|taxi|flight|airfare|hotel|airbnb|train|gas|parking|trip/, "Travel"],
  [/movie|🎬|museum|concert|🎟|show|game|tickets|karaoke|bowling/, "Entertainment"],
  [/rent|utilities|electric|water bill|internet|wifi|lease|deposit/, "Housing"],
  [/amazon|shop|🛍|store|order|target run/, "Shopping"],
];

export interface VenmoRow {
  venmoId: string;
  datetime: string; // ISO-ish, as it appears in the statement
  type: string; // Payment | Charge | Standard Transfer
  note: string;
  counterparty: string; // the other party ("" for cash-outs)
  direction: "in" | "out"; // relative to the account holder
  amount: number; // absolute dollars
  suggested: VenmoCategory;
}

export interface ParsedStatements {
  accountHolder: string;
  rows: VenmoRow[];
}

/** Minimal RFC4180 parser: handles quoted fields, embedded commas, "" escapes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s$,]/g, "");
  const n = parseFloat(cleaned.replace(/^[+-]/, ""));
  if (Number.isNaN(n)) return null;
  return cleaned.startsWith("-") ? -n : n;
}

export function suggestCategory(
  note: string,
  type: string,
  direction: "in" | "out"
): VenmoCategory {
  if (type === "Standard Transfer") return "Transfer";
  const n = note.toLowerCase();
  for (const [re, cat] of RULES) if (re.test(n)) return cat;
  return direction === "in" ? "Reimbursement" : "Other";
}

/** Default location + pattern for statement files (local-first app). */
export function defaultStatementDir(): string {
  return process.env.VENMO_STATEMENT_DIR ?? join(homedir(), "Downloads");
}

export function findStatementFiles(dir = defaultStatementDir()): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^VenmoStatement_.*\.csv$/i.test(n))
    .map((n) => join(dir, n))
    .sort();
}

export function parseStatements(files: string[]): ParsedStatements {
  const holderFreq = new Map<string, number>();
  // First pass: collect raw rows + tally names to detect the account holder.
  const rawByFile = files.map((f) => {
    const rows = parseCsv(readFileSync(f, "utf8"));
    const header = rows.find((r) => r[1] === "ID");
    if (!header) return [];
    const at = (name: string) => header.indexOf(name);
    const idx = {
      id: at("ID"),
      date: at("Datetime"),
      type: at("Type"),
      note: at("Note"),
      from: at("From"),
      to: at("To"),
      amount: at("Amount (total)"),
    };
    const out: { id: string; date: string; type: string; note: string; from: string; to: string; signed: number }[] = [];
    for (const r of rows) {
      const id = r[idx.id];
      const date = r[idx.date];
      if (!id || id === "ID" || !date) continue;
      const signed = parseAmount(r[idx.amount] ?? "");
      if (signed == null) continue;
      const from = (r[idx.from] ?? "").trim();
      const to = (r[idx.to] ?? "").trim();
      if (from) holderFreq.set(from, (holderFreq.get(from) ?? 0) + 1);
      if (to) holderFreq.set(to, (holderFreq.get(to) ?? 0) + 1);
      out.push({ id, date, type: (r[idx.type] ?? "").trim(), note: (r[idx.note] ?? "").trim(), from, to, signed });
    }
    return out;
  });

  const accountHolder =
    [...holderFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const rows: VenmoRow[] = [];
  for (const fileRows of rawByFile) {
    for (const t of fileRows) {
      const direction: "in" | "out" = t.signed < 0 ? "out" : "in";
      const counterparty =
        t.type === "Standard Transfer"
          ? ""
          : t.from === accountHolder
          ? t.to
          : t.to === accountHolder
          ? t.from
          : t.from || t.to;
      rows.push({
        venmoId: t.id,
        datetime: t.date,
        type: t.type,
        note: t.note,
        counterparty,
        direction,
        amount: Math.abs(t.signed),
        suggested: suggestCategory(t.note, t.type, direction),
      });
    }
  }
  rows.sort((a, b) => a.datetime.localeCompare(b.datetime));
  return { accountHolder, rows };
}
