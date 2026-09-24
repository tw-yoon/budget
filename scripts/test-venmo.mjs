import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VENMO_CATEGORIES,
  defaultStatementDir,
  findStatementFiles,
  parseStatements,
  suggestCategory,
} from "../src/lib/venmo.ts";

// Three statements for a made-up account holder, shaped like Venmo's export:
// two preamble lines, a header offset by one empty column, balance rows, and a
// multi-line quoted disclaimer. February uses CRLF line endings and has a
// pending row with no amount; March has its columns in a different order.
const FIXTURES = fileURLToPath(new URL("./fixtures/venmo/", import.meta.url));

const files = findStatementFiles(FIXTURES);
const { accountHolder, rows } = parseStatements(files);
const row = (id) => rows.find((r) => r.venmoId === id);

// ── finding statements ───────────────────────────────────────────────────

test("only Venmo statement files are picked up, in name order", () => {
  assert.deepEqual(files.map((f) => path.basename(f)), [
    "VenmoStatement_Feb_2026.csv",
    "VenmoStatement_Jan_2026.csv",
    "VenmoStatement_Mar_2026.csv",
  ]);
  assert.ok(files.every((f) => path.isAbsolute(f)));
});

test("a missing statement folder finds nothing rather than throwing", () => {
  assert.deepEqual(findStatementFiles(path.join(FIXTURES, "does-not-exist")), []);
});

test("the statement folder defaults to Downloads unless overridden", () => {
  const saved = process.env.VENMO_STATEMENT_DIR;
  try {
    delete process.env.VENMO_STATEMENT_DIR;
    assert.equal(defaultStatementDir(), path.join(homedir(), "Downloads"));
    process.env.VENMO_STATEMENT_DIR = FIXTURES;
    assert.equal(defaultStatementDir(), FIXTURES);
  } finally {
    if (saved === undefined) delete process.env.VENMO_STATEMENT_DIR;
    else process.env.VENMO_STATEMENT_DIR = saved;
  }
});

// ── parsing ──────────────────────────────────────────────────────────────

test("the account holder is whoever appears on the most rows", () => {
  assert.equal(accountHolder, "Jamie Rivera");
});

test("only real transactions come through", () => {
  // Not the preamble, header, balance rows, disclaimer — or the pending row
  // with no amount.
  assert.deepEqual(
    rows.map((r) => r.venmoId).sort(),
    ["1001", "1002", "1003", "1004", "1005", "1006", "1007", "2001", "3001"]
  );
});

test("rows from every file come out in date order", () => {
  const dates = rows.map((r) => r.datetime);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(rows[0].venmoId, "1002");
  assert.equal(rows.at(-1).venmoId, "3001");
});

test("money sent is out and money received is in, as absolute dollars", () => {
  assert.equal(row("1001").direction, "out");
  assert.equal(row("1001").amount, 42.5);
  assert.equal(row("1002").direction, "in");
  assert.equal(row("1002").amount, 1200); // "+ $1,200.00"
});

test("the counterparty is the other side of the payment", () => {
  assert.equal(row("1001").counterparty, "Alex Kim"); // holder paid them
  assert.equal(row("1002").counterparty, "Sam Lee"); // they paid the holder
  assert.equal(row("1003").counterparty, "Chris Park");
});

test("a cash-out to the bank has no counterparty", () => {
  assert.equal(row("1004").type, "Standard Transfer");
  assert.equal(row("1004").counterparty, "");
  assert.equal(row("1004").direction, "out");
});

test("quoted fields keep their commas, quotes and line breaks", () => {
  assert.equal(row("1002").note, "rent, january");
  assert.equal(row("1003").note, 'concert "tickets"');
  assert.equal(row("1005").note, "thanks\nfor lunch");
});

test("CRLF line endings leave no stray carriage returns", () => {
  assert.equal(row("2001").note, "groceries");
  assert.equal(row("2001").amount, 60);
  assert.ok(rows.every((r) => !JSON.stringify(r).includes("\\r")));
});

test("columns are found by header name, not position", () => {
  assert.equal(row("3001").note, "uber home");
  assert.equal(row("3001").amount, 18.25);
  assert.equal(row("3001").counterparty, "Alex Kim");
});

test("each row carries a suggested category", () => {
  const suggested = Object.fromEntries(rows.map((r) => [r.venmoId, r.suggested]));
  assert.deepEqual(suggested, {
    1001: "Dining",
    1002: "Housing",
    1003: "Entertainment",
    1004: "Transfer",
    1005: "Dining",
    1006: "Reimbursement",
    1007: "Other",
    2001: "Groceries",
    3001: "Travel",
  });
});

test("no files means no rows and no account holder", () => {
  assert.deepEqual(parseStatements([]), { accountHolder: "", rows: [] });
});

// ── suggesting a category ────────────────────────────────────────────────

test("a cash-out is a transfer whatever its note says", () => {
  assert.equal(suggestCategory("dinner", "Standard Transfer", "out"), "Transfer");
});

test("notes match case-insensitively, emoji included", () => {
  assert.equal(suggestCategory("DINNER", "Payment", "out"), "Dining");
  assert.equal(suggestCategory("🍕", "Payment", "out"), "Dining");
  assert.equal(suggestCategory("🎬 night", "Payment", "out"), "Entertainment");
});

test("the first matching rule wins", () => {
  assert.equal(suggestCategory("costco pizza", "Payment", "out"), "Groceries");
});

test("with no keyword, money in is a reimbursement and money out is other", () => {
  assert.equal(suggestCategory("thx", "Payment", "in"), "Reimbursement");
  assert.equal(suggestCategory("thx", "Payment", "out"), "Other");
});

test("every suggestion is a Venmo category", () => {
  for (const r of rows) assert.ok(VENMO_CATEGORIES.includes(r.suggested), r.suggested);
});
