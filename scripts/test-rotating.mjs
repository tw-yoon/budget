import test from "node:test";
import assert from "node:assert/strict";
import {
  bonusCategoryLabel,
  bonusFor,
  bonusMatches,
  quarterKey,
  quarterLabel,
  quarterOf,
} from "../src/lib/rotating.ts";
import { effectiveRateWithBonus } from "../src/lib/rewards.ts";
import { computeEarnings } from "../src/lib/earnings.ts";
import { parseRotatingBody } from "../src/lib/rotating-body.ts";

const rate = (category, multiplier, unit = "X") => ({ category, multiplier, unit });

const bonus = (extra = {}) => ({
  year: 2026,
  quarter: 4,
  multiplier: 5,
  unit: "PERCENT",
  categories: ["GAS"],
  merchants: ["Sample Mart"],
  excludeMerchants: [],
  cap: 1500,
  activated: true,
  ...extra,
});

// ── quarters ─────────────────────────────────────────────────────────────

test("quarters split on local calendar days", () => {
  assert.deepEqual(quarterOf(new Date(2026, 2, 31, 23, 0)), { year: 2026, quarter: 1 });
  assert.deepEqual(quarterOf(new Date(2026, 3, 1, 0, 0)), { year: 2026, quarter: 2 });
  assert.deepEqual(quarterOf(new Date(2026, 11, 31, 12, 0)), { year: 2026, quarter: 4 });
});

test("quarters have a key and a label", () => {
  assert.equal(quarterKey(2026, 4), "2026-Q4");
  assert.equal(quarterLabel(2026, 4), "Q4 2026");
});

test("bonusFor picks the purchase date's quarter", () => {
  const q3 = bonus({ quarter: 3 });
  const q4 = bonus();
  assert.equal(bonusFor([q3, q4], new Date(2026, 9, 1)), q4);
  assert.equal(bonusFor([q3, q4], new Date(2026, 8, 30)), q3);
  assert.equal(bonusFor([q4], new Date(2027, 0, 1)), null);
});

test("an unactivated quarter still counts", () => {
  const b = bonus({ activated: false });
  assert.equal(bonusFor([b], new Date(2026, 9, 1)), b);
});

// ── matching ─────────────────────────────────────────────────────────────

test("a bonus matches its categories", () => {
  assert.ok(bonusMatches(bonus(), "GAS", "Shell 123", null));
});

test("a merchant matches the name, ignoring case", () => {
  assert.ok(bonusMatches(bonus(), "GROCERIES", "SAMPLE MART #12", null));
});

test("a merchant matches the merchant name", () => {
  assert.ok(bonusMatches(bonus(), "OTHER", "POS 4411", "Sample Mart"));
});

test("neither category nor merchant: no match", () => {
  assert.ok(!bonusMatches(bonus(), "DINING", "Sample Coffee", "Sample Coffee"));
});

test("empty merchant strings are ignored", () => {
  const b = bonus({ categories: [], merchants: ["", "  "] });
  assert.ok(!bonusMatches(b, "DINING", "Sample Coffee", null));
});

test("an excluded merchant blocks a category or merchant match", () => {
  const b = bonus({ categories: ["GROCERIES"], merchants: ["Sample"], excludeMerchants: ["sample mart"] });
  assert.ok(!bonusMatches(b, "GROCERIES", "SAMPLE MART SUPERCENTER", null));
  assert.ok(!bonusMatches(b, "OTHER", "POS 4411", "Sample Mart"));
  assert.ok(bonusMatches(b, "GROCERIES", "Example Grocer", null));
});

test("extra categories match on Plaid's codes", () => {
  const hotels = bonus({ categories: ["HOTELS"], merchants: [] });
  const lodging = { pfcPrimary: "TRAVEL", pfcDetailed: "TRAVEL_LODGING" };
  assert.ok(bonusMatches(hotels, "TRAVEL", "Sample Inn", null, lodging));
  assert.ok(!bonusMatches(hotels, "TRAVEL", "Sample Air", null, { pfcPrimary: "TRAVEL", pfcDetailed: "TRAVEL_FLIGHTS" }));
  assert.ok(!bonusMatches(hotels, "TRAVEL", "Sample Inn", null, null));
  const home = bonus({ categories: ["HOME_IMPROVEMENT"], merchants: [] });
  assert.ok(bonusMatches(home, "OTHER", "Example Hardware", null, { pfcPrimary: "HOME_IMPROVEMENT", pfcDetailed: null }));
});

test("an excluded merchant beats an extra-category match", () => {
  const b = bonus({ categories: ["SUPERSTORES"], merchants: [], excludeMerchants: ["Sample Mart"] });
  const superstore = { pfcPrimary: "GENERAL_MERCHANDISE", pfcDetailed: "GENERAL_MERCHANDISE_SUPERSTORES" };
  assert.ok(!bonusMatches(b, "OTHER", "SAMPLE MART #12", null, superstore));
  assert.ok(bonusMatches(b, "OTHER", "Example Superstore", null, superstore));
});

test("extra categories have labels", () => {
  assert.equal(bonusCategoryLabel("UTILITIES"), "Utilities");
  assert.equal(bonusCategoryLabel("MOVIES"), "Movies & Streaming TV");
  assert.equal(bonusCategoryLabel("GAS"), "Gas");
});

// ── effectiveRateWithBonus ───────────────────────────────────────────────

const base1 = [rate("OTHER", 1, "PERCENT")];

test("a covered category gets the higher bonus", () => {
  assert.deepEqual(effectiveRateWithBonus(base1, "GAS", bonus()), {
    multiplier: 5,
    unit: "PERCENT",
    isBonus: true,
  });
});

test("a lower bonus keeps the normal rate", () => {
  const rates = [rate("GAS", 6, "PERCENT"), ...base1];
  assert.deepEqual(effectiveRateWithBonus(rates, "GAS", bonus()), {
    multiplier: 6,
    unit: "PERCENT",
    isBonus: true,
  });
});

test("an uncovered category keeps the normal rate", () => {
  assert.deepEqual(effectiveRateWithBonus(base1, "DINING", bonus()), {
    multiplier: 1,
    unit: "PERCENT",
    isBonus: false,
  });
});

test("merchants don't make a category covered", () => {
  const b = bonus({ categories: [], merchants: ["GROCERIES", "Sample Mart"] });
  assert.equal(effectiveRateWithBonus(base1, "GROCERIES", b).multiplier, 1);
});

test("no bonus is the normal rate", () => {
  assert.equal(effectiveRateWithBonus(base1, "GAS", null).multiplier, 1);
});

test("different units compare in dollars at the point value", () => {
  // 3x at 2¢ = 6¢ beats 5%; at the 1¢ default 3x = 3¢ loses to 5%.
  const rates = [rate("GAS", 3)];
  assert.equal(effectiveRateWithBonus(rates, "GAS", bonus(), 2).multiplier, 3);
  assert.equal(effectiveRateWithBonus(rates, "GAS", bonus()).multiplier, 5);
});

// ── earnings ─────────────────────────────────────────────────────────────

const card = { id: "c", pointValueCents: 1, rewardRates: base1 };
const start = new Date(2026, 0, 1);
const end = new Date(2027, 0, 1);

const gas = (amount, date, extra = {}) => ({
  amount,
  date,
  pfcPrimary: "TRANSPORTATION",
  pfcDetailed: "TRANSPORTATION_GAS",
  userCategory: null,
  name: "Shell 123",
  merchantName: null,
  splits: [],
  ...extra,
});
const grocery = (amount, date, extra = {}) =>
  gas(amount, date, {
    pfcPrimary: "FOOD_AND_DRINK",
    pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
    ...extra,
  });

const rows = (e) => Object.fromEntries(e.byCategory.map((r) => [r.key, r]));

test("matching purchases in the quarter earn the bonus; outside it they don't", () => {
  const e = computeEarnings(
    card,
    [],
    [
      gas(40, new Date(2026, 9, 3)),
      grocery(60, new Date(2026, 9, 4), { name: "SAMPLE MART #12" }),
      gas(50, new Date(2026, 8, 30, 23, 0)),
    ],
    start,
    end,
    [bonus()]
  );
  const r = rows(e);
  const b = r["ROTATING-2026-Q4"];
  assert.equal(b.category, "ROTATING");
  assert.equal(b.categoryLabel, "Q4 2026 bonus");
  assert.equal(b.rate, "5%");
  assert.equal(b.isBonus, true);
  assert.equal(b.spend, 100);
  assert.equal(b.earned, 5); // 2.00 on the gas + 3.00 on the groceries
  assert.equal(r.GAS.spend, 50); // Sep 30
  assert.equal(r.GAS.earned, 0.5);
  assert.equal(r.GROCERIES, undefined);
  assert.equal(e.totalSpend, 150);
});

test("groceries at an excluded merchant earn the normal rate", () => {
  const b = bonus({ categories: ["GROCERIES"], merchants: [], excludeMerchants: ["Sample Mart"] });
  const at = (name) =>
    rows(computeEarnings(card, [], [grocery(100, new Date(2026, 9, 4), { name })], start, end, [b]));
  const excluded = at("SAMPLE MART SUPERCENTER");
  assert.equal(excluded["ROTATING-2026-Q4"], undefined);
  assert.equal(excluded.GROCERIES.spend, 100);
  assert.equal(excluded.GROCERIES.earned, 1);
  const elsewhere = at("Example Grocer");
  assert.equal(elsewhere["ROTATING-2026-Q4"].spend, 100);
  assert.equal(elsewhere.GROCERIES, undefined);
});

test("an electric bill earns a Utilities bonus; rent and overridden rows don't", () => {
  const b = bonus({ categories: ["UTILITIES"], merchants: [] });
  const bill = (pfcDetailed, extra = {}) =>
    gas(100, new Date(2026, 9, 4), {
      pfcPrimary: "RENT_AND_UTILITIES",
      pfcDetailed,
      name: "Example Power Co",
      ...extra,
    });
  const at = (t) => rows(computeEarnings(card, [], [t], start, end, [b]))["ROTATING-2026-Q4"];
  assert.equal(at(bill("RENT_AND_UTILITIES_GAS_AND_ELECTRICITY")).earned, 5);
  assert.equal(at(bill("RENT_AND_UTILITIES_RENT")), undefined);
  assert.equal(at(bill("RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", { userCategory: "Shopping" })), undefined);
});

test("a $40 gas purchase earns $2.00 at the bonus", () => {
  const e = computeEarnings(card, [], [gas(40, new Date(2026, 9, 3))], start, end, [bonus()]);
  const b = rows(e)["ROTATING-2026-Q4"];
  assert.equal(b.spend, 40);
  assert.equal(b.earned, 2);
  assert.equal(b.value, 2);
});

test("a purchase matching category and merchant earns the bonus once", () => {
  const e = computeEarnings(
    card,
    [],
    [gas(40, new Date(2026, 9, 3), { name: "Sample Mart Fuel", merchantName: "Sample Mart" })],
    start,
    end,
    [bonus()]
  );
  assert.equal(e.byCategory.length, 1);
  assert.equal(rows(e)["ROTATING-2026-Q4"].spend, 40);
  assert.equal(e.totalSpend, 40);
  assert.equal(e.totalEarned, 2);
});

test("the cap splits a purchase", () => {
  const e = computeEarnings(
    card,
    [],
    [
      // Out of order on purpose: rows are processed by date.
      gas(50, new Date(2026, 10, 20)),
      gas(1480, new Date(2026, 9, 5)),
    ],
    start,
    end,
    [bonus()]
  );
  const r = rows(e);
  assert.equal(r["ROTATING-2026-Q4"].spend, 1500);
  assert.equal(r["ROTATING-2026-Q4"].earned, 75);
  assert.equal(r.GAS.spend, 30);
  assert.equal(r.GAS.earned, 0.3);
});

test("a better normal rate gets no bonus row and no cap use", () => {
  const six = { ...card, rewardRates: [rate("GAS", 6, "PERCENT"), ...base1] };
  const e = computeEarnings(six, [], [gas(100, new Date(2026, 9, 3))], start, end, [bonus({ cap: 50 })]);
  const r = rows(e);
  assert.equal(r["ROTATING-2026-Q4"], undefined);
  assert.equal(r.GAS.earned, 6);
  assert.equal(e.totalValue, 6);
});

test("no cap means unlimited", () => {
  const e = computeEarnings(card, [], [gas(5000, new Date(2026, 9, 3))], start, end, [
    bonus({ cap: null }),
  ]);
  const r = rows(e);
  assert.equal(r["ROTATING-2026-Q4"].spend, 5000);
  assert.equal(r.GAS, undefined);
});

test("each quarter has its own cap and row", () => {
  const e = computeEarnings(
    card,
    [],
    [gas(1500, new Date(2026, 6, 3)), gas(100, new Date(2026, 9, 3))],
    start,
    end,
    [bonus({ quarter: 3 }), bonus()]
  );
  const r = rows(e);
  assert.equal(r["ROTATING-2026-Q3"].spend, 1500);
  assert.equal(r["ROTATING-2026-Q4"].spend, 100);
});

test("the bonus row is measured against others on each slice's own category", () => {
  const gasCard = {
    name: "Gas 3%",
    issuer: "EXAMPLE",
    pointValueCents: 1,
    rewardRates: [rate("GAS", 3, "PERCENT"), rate("OTHER", 1, "PERCENT")],
  };
  const e = computeEarnings(
    card,
    [gasCard],
    [
      gas(100, new Date(2026, 9, 3)),
      grocery(100, new Date(2026, 9, 4), { name: "Sample Mart" }),
    ],
    start,
    end,
    [bonus()]
  );
  const b = rows(e)["ROTATING-2026-Q4"];
  // $10 bonus vs $3 (gas at 3%) + $1 (groceries at base 1%)
  assert.equal(b.vsBest, 6);
  assert.equal(b.bestAlternative, "Gas 3%");
});

test("without bonuses, every row's key is its category", () => {
  const e = computeEarnings(card, [], [gas(40, new Date(2026, 9, 3))], start, end);
  assert.equal(e.byCategory[0].key, "GAS");
});

// ── PUT body ─────────────────────────────────────────────────────────────

const body = (extra = {}) => ({
  multiplier: 5,
  unit: "PERCENT",
  categories: ["GAS", "GROCERIES"],
  merchants: [" Sample Mart ", "Sample Mart", "", "Example Books"],
  excludeMerchants: [" Example Club ", "Example Club", ""],
  cap: 1500,
  activated: false,
  ...extra,
});

test("a valid body passes, merchants trimmed and deduped", () => {
  assert.deepEqual(parseRotatingBody(body(), "PERCENT"), {
    ok: true,
    value: {
      multiplier: 5,
      unit: "PERCENT",
      categories: ["GAS", "GROCERIES"],
      merchants: ["Sample Mart", "Example Books"],
      excludeMerchants: ["Example Club"],
      cap: 1500,
      activated: false,
    },
  });
});

test("cap may be null", () => {
  const r = parseRotatingBody(body({ cap: null }), "PERCENT");
  assert.equal(r.ok, true);
  assert.equal(r.value.cap, null);
});

test("bad bodies are refused", () => {
  for (const extra of [
    { cap: 0 },
    { multiplier: 0 },
    { unit: "Y" },
    { categories: ["OTHER"] },
    { categories: ["ROTATING"] },
    { activated: undefined },
    { merchants: "Sample Mart" },
    { excludeMerchants: undefined },
    { excludeMerchants: [3] },
    { categories: [], merchants: [] },
    { categories: [], merchants: ["  "] },
  ]) {
    const r = parseRotatingBody(body(extra), "PERCENT");
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.equal(typeof r.error, "string");
  }
  assert.equal(parseRotatingBody(null, "X").ok, false);
});

test("extra categories are allowed in a body", () => {
  const r = parseRotatingBody(body({ categories: ["UTILITIES", "HOTELS"] }), "PERCENT");
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.categories, ["UTILITIES", "HOTELS"]);
});

test("a bonus in another unit than the card's base is refused", () => {
  const r = parseRotatingBody(body({ unit: "X" }), "PERCENT");
  assert.equal(r.ok, false);
  assert.match(r.error, /unit/i);
  assert.equal(parseRotatingBody(body({ unit: "X" }), "X").ok, true);
});
