/**
 * Standalone Venmo statement categorizer — a sandbox, NOT part of the Next app.
 *
 * Parses one or more Venmo CSV statements, infers direction/counterparty/category,
 * and serves an interactive page where you manually assign categories. Nothing is
 * written to the database; the only output is an optional JSON export you trigger
 * from the page. Plain JS + Node built-ins so it runs with zero install:
 *
 *   node scripts/venmo-categorize.mjs statement.csv [more.csv ...]
 *
 * Then open http://localhost:4317  (deliberately not :3000).
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4317;
const __dirname = dirname(fileURLToPath(import.meta.url));

const CATEGORIES = [
  "Dining",
  "Groceries",
  "Travel",
  "Entertainment",
  "Housing",
  "Shopping",
  "Reimbursement",
  "Transfer",
  "Other",
];

// note keyword -> category. Lowercased substring/regex match. Intentionally
// modest: this demonstrates that auto-rules only get you part way.
const RULES = [
  [/walmart|wal\s*mart|sam.?s club|costco|grocer|target|kroger|safeway|aldi|trader/, "Groceries"],
  [/dinner|lunch|brunch|food|pizza|🍕|burger|taco|🌮|sushi|ramen|coffee|boba|bar tab/, "Dining"],
  [/uber|lyft|taxi|flight|airfare|hotel|airbnb|train|gas|parking|trip/, "Travel"],
  [/movie|🎬|museum|concert|🎟|show|game|tickets|karaoke|bowling/, "Entertainment"],
  [/rent|utilities|electric|water bill|internet|wifi|lease|deposit/, "Housing"],
  [/amazon|shop|🛍|store|order|target run/, "Shopping"],
];

// ── CSV parsing ──────────────────────────────────────────────────────────────

/** Minimal RFC4180 parser: handles quoted fields, embedded commas, "" escapes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseAmount(raw) {
  // "- $738.22" / "+ $27.00" -> signed number
  const cleaned = raw.replace(/[\s$,]/g, "");
  const n = parseFloat(cleaned.replace(/^[+-]/, ""));
  if (Number.isNaN(n)) return null;
  return cleaned.startsWith("-") ? -n : n;
}

function suggest(note, type, direction) {
  if (type === "Standard Transfer") return "Transfer";
  const n = (note || "").toLowerCase();
  for (const [re, cat] of RULES) if (re.test(n)) return cat;
  // Money coming in with no merchant-y note is, by default, someone paying you back.
  if (direction === "in") return "Reimbursement";
  return "Other";
}

/** Pull transaction rows out of one Venmo statement file. */
function loadFile(path) {
  const rows = parseCsv(readFileSync(path, "utf8"));
  const header = rows.find((r) => r[1] === "ID");
  if (!header) return [];
  const col = (name) => header.indexOf(name);
  const idx = {
    id: col("ID"),
    date: col("Datetime"),
    type: col("Type"),
    note: col("Note"),
    from: col("From"),
    to: col("To"),
    amount: col("Amount (total)"),
  };
  const month = path.match(/VenmoStatement_([A-Za-z]+)/)?.[1] ?? path;
  const out = [];
  for (const r of rows) {
    const id = r[idx.id];
    const date = r[idx.date];
    if (!id || id === "ID" || !date) continue; // skip header + balance/disclaimer rows
    const amount = parseAmount(r[idx.amount] ?? "");
    if (amount == null) continue;
    out.push({
      id,
      month,
      date,
      type: r[idx.type] ?? "",
      note: (r[idx.note] ?? "").trim(),
      from: (r[idx.from] ?? "").trim(),
      to: (r[idx.to] ?? "").trim(),
      amount,
    });
  }
  return out;
}

// ── Build the dataset ────────────────────────────────────────────────────────

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/venmo-categorize.mjs <statement.csv> [more.csv ...]");
  console.error("Export your statements from venmo.com → Statement → Download CSV.");
  process.exit(1);
}
const raw = files.flatMap(loadFile);

// "Me" = the name appearing in nearly every row (account holder).
const freq = {};
for (const t of raw) {
  if (t.from) freq[t.from] = (freq[t.from] ?? 0) + 1;
  if (t.to) freq[t.to] = (freq[t.to] ?? 0) + 1;
}
const me = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

const txns = raw
  .map((t) => {
    const direction = t.amount < 0 ? "out" : "in";
    const counterparty =
      t.type === "Standard Transfer"
        ? "Bank transfer (cash-out)"
        : t.from === me
        ? t.to
        : t.to === me
        ? t.from
        : t.from || t.to;
    return {
      id: t.id,
      month: t.month,
      date: t.date.slice(0, 10),
      time: t.date.slice(11, 16),
      type: t.type,
      note: t.note,
      counterparty,
      direction,
      amount: Math.abs(t.amount),
      suggested: suggest(t.note, t.type, direction),
    };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

const totalOut = txns.filter((t) => t.direction === "out").reduce((s, t) => s + t.amount, 0);
const totalIn = txns.filter((t) => t.direction === "in").reduce((s, t) => s + t.amount, 0);
const matched = txns.filter((t) => t.suggested !== "Other").length;

// Dump parsed JSON next to the script (handy for inspection / other tooling).
writeFileSync(join(__dirname, ".venmo-parsed.json"), JSON.stringify({ me, txns }, null, 2));

console.log(`\nParsed ${txns.length} transactions from ${files.length} file(s).`);
console.log(`Account holder detected as: ${me}`);
console.log(`Sent out: $${totalOut.toFixed(2)}  |  Received: $${totalIn.toFixed(2)}  |  Net: $${(totalIn - totalOut).toFixed(2)}`);
console.log(`Auto-suggested a category for ${matched}/${txns.length} (rest default to Reimbursement/Other).`);
console.log(`\n→  http://localhost:${PORT}\n`);

// ── Serve the categorizer page ───────────────────────────────────────────────

function page() {
  const data = JSON.stringify({ me, txns, categories: CATEGORIES });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Venmo categorizer</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 -apple-system, system-ui, sans-serif; background:#0e1117; color:#e6edf3; }
  header { padding: 18px 24px; border-bottom: 1px solid #232a33; position: sticky; top:0; background:#0e1117; z-index:5; }
  h1 { margin:0 0 4px; font-size:18px; }
  .sub { color:#8b949e; font-size:12px; }
  .cards { display:flex; gap:12px; margin-top:14px; flex-wrap:wrap; }
  .card { background:#161b22; border:1px solid #232a33; border-radius:10px; padding:10px 14px; min-width:120px; }
  .card .k { color:#8b949e; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:18px; font-weight:600; margin-top:2px; }
  .controls { padding: 12px 24px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  select, button, input { background:#161b22; color:#e6edf3; border:1px solid #2d343d; border-radius:7px; padding:6px 9px; font-size:13px; }
  button { cursor:pointer; }
  button.primary { background:#238636; border-color:#238636; }
  main { padding: 0 24px 60px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; color:#8b949e; font-size:11px; text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; border-bottom:1px solid #232a33; position:sticky; top:0; }
  td { padding:7px 10px; border-bottom:1px solid #1a2027; vertical-align:middle; }
  tr:hover td { background:#11161d; }
  .amt { font-variant-numeric: tabular-nums; font-weight:600; text-align:right; white-space:nowrap; }
  .out { color:#f0883e; } .in { color:#3fb950; }
  .note { color:#c9d1d9; } .muted { color:#6e7681; font-size:12px; }
  .pill { font-size:10px; padding:1px 6px; border-radius:20px; border:1px solid #2d343d; color:#8b949e; }
  .breakdown { display:flex; gap:8px; flex-wrap:wrap; margin: 6px 0 0; }
  .bd { background:#161b22; border:1px solid #232a33; border-radius:8px; padding:6px 10px; font-size:12px; }
  .bd b { font-variant-numeric: tabular-nums; }
  td select { width:150px; }
</style></head><body>
<header>
  <h1>Venmo categorizer <span class="muted">— sandbox, nothing saved to your app</span></h1>
  <div class="sub" id="who"></div>
  <div class="cards" id="cards"></div>
  <div class="breakdown" id="breakdown"></div>
</header>
<div class="controls">
  <label>Month <select id="fMonth"></select></label>
  <label>Direction <select id="fDir"><option value="">all</option><option value="out">sent</option><option value="in">received</option></select></label>
  <label>Show <select id="fCat"><option value="">all categories</option></select></label>
  <span style="flex:1"></span>
  <button class="primary" id="export">Export mapping (JSON)</button>
</div>
<main><table>
  <thead><tr><th>Date</th><th>Counterparty</th><th>Note</th><th>Type</th><th class="amt">Amount</th><th>Category</th></tr></thead>
  <tbody id="rows"></tbody>
</table></main>
<script>
  var D = ${data};
  var KEY = "venmo-cat-v1";
  var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  // seed unsaved rows with their suggestion
  D.txns.forEach(function(t){ if(!(t.id in saved)) saved[t.id] = t.suggested; });

  var fMonth = document.getElementById("fMonth");
  var fDir = document.getElementById("fDir");
  var fCat = document.getElementById("fCat");
  var months = Array.from(new Set(D.txns.map(function(t){return t.month;})));
  fMonth.innerHTML = '<option value="">all months</option>' + months.map(function(m){return '<option>'+m+'</option>';}).join("");
  fCat.innerHTML = '<option value="">all categories</option>' + D.categories.map(function(c){return '<option>'+c+'</option>';}).join("");

  document.getElementById("who").textContent = "Account holder: " + D.me + "  ·  " + D.txns.length + " transactions across " + months.length + " months";

  function fmt(n){ return "$" + n.toFixed(2); }
  function esc(s){ return (s||"").replace(/[&<>]/g, function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];}); }

  function visible(){
    var m = fMonth.value, d = fDir.value, c = fCat.value;
    return D.txns.filter(function(t){
      if(m && t.month!==m) return false;
      if(d && t.direction!==d) return false;
      if(c && saved[t.id]!==c) return false;
      return true;
    });
  }

  function catOptions(sel){
    return D.categories.map(function(c){
      return '<option'+(c===sel?' selected':'')+'>'+c+'</option>';
    }).join("");
  }

  function render(){
    var rows = visible();
    document.getElementById("rows").innerHTML = rows.map(function(t){
      var cls = t.direction==="out" ? "out" : "in";
      var sign = t.direction==="out" ? "−" : "+";
      return '<tr data-id="'+t.id+'">'
        + '<td class="muted">'+t.date+'</td>'
        + '<td>'+esc(t.counterparty)+'</td>'
        + '<td class="note">'+(t.note?esc(t.note):'<span class="muted">—</span>')+'</td>'
        + '<td><span class="pill">'+t.type+'</span></td>'
        + '<td class="amt '+cls+'">'+sign+fmt(t.amount)+'</td>'
        + '<td><select data-id="'+t.id+'">'+catOptions(saved[t.id])+'</select></td>'
        + '</tr>';
    }).join("");
    document.querySelectorAll("#rows select").forEach(function(s){
      s.addEventListener("change", function(){
        saved[this.getAttribute("data-id")] = this.value;
        localStorage.setItem(KEY, JSON.stringify(saved));
        summarize();
      });
    });
  }

  function summarize(){
    var out=0, inc=0, byCat={};
    D.txns.forEach(function(t){
      var c = saved[t.id];
      if(t.direction==="out") out+=t.amount; else inc+=t.amount;
      if(c==="Transfer") return; // exclude transfers from spend breakdown
      var signed = t.direction==="out" ? t.amount : -t.amount; // reimbursements offset spend
      byCat[c] = (byCat[c]||0) + signed;
    });
    var net = inc - out;
    document.getElementById("cards").innerHTML =
      card("Sent", "out", fmt(out)) + card("Received", "in", fmt(inc)) +
      card("Net flow", net>=0?"in":"out", (net>=0?"+":"−")+fmt(Math.abs(net))) +
      card("Transactions", "", String(D.txns.length));
    var entries = Object.keys(byCat).sort(function(a,b){return Math.abs(byCat[b])-Math.abs(byCat[a]);});
    document.getElementById("breakdown").innerHTML = entries.map(function(c){
      var v = byCat[c];
      return '<span class="bd">'+c+': <b class="'+(v>=0?"out":"in")+'">'+(v>=0?"":"+")+fmt(Math.abs(v))+'</b></span>';
    }).join("");
  }
  function card(k, cls, v){
    return '<div class="card"><div class="k">'+k+'</div><div class="v '+cls+'">'+v+'</div></div>';
  }

  document.getElementById("export").addEventListener("click", function(){
    var mapping = D.txns.map(function(t){
      return { id:t.id, date:t.date, counterparty:t.counterparty, note:t.note,
               direction:t.direction, amount:t.amount, category:saved[t.id] };
    });
    var blob = new Blob([JSON.stringify(mapping, null, 2)], {type:"application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "venmo-categorized.json"; a.click();
  });

  [fMonth, fDir, fCat].forEach(function(s){ s.addEventListener("change", render); });
  render(); summarize();
</script></body></html>`;
}

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page());
}).listen(PORT);
