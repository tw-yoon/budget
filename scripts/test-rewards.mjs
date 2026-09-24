import test from "node:test";
import assert from "node:assert/strict";
import {
  BONUS_CATEGORIES,
  REWARD_CATEGORIES,
  REWARD_CATEGORY_LABELS,
  effectiveRate,
  formatRate,
} from "../src/lib/rewards.ts";
import { rewardCategoryFor } from "../src/lib/reward-categories.ts";
import { computeEarnings } from "../src/lib/earnings.ts";

// ── rates ────────────────────────────────────────────────────────────────

const rate = (category, multiplier, unit = "X") => ({ category, multiplier, unit });

test("a card's own bonus for the category wins", () => {
  const rates = [rate("DINING", 4), rate("OTHER", 1)];
  assert.deepEqual(effectiveRate(rates, "DINING"), { multiplier: 4, unit: "X", isBonus: true });
});

test("a category without a bonus falls to the card's base rate", () => {
  const rates = [rate("DINING", 4), rate("OTHER", 1.5, "PERCENT")];
  assert.deepEqual(effectiveRate(rates, "GAS"), { multiplier: 1.5, unit: "PERCENT", isBonus: false });
});

test("a card with no base rate earns 1x", () => {
  assert.deepEqual(effectiveRate([rate("DINING", 3)], "TRAVEL"), {
    multiplier: 1,
    unit: "X",
    isBonus: false,
  });
  assert.deepEqual(effectiveRate([], "TRAVEL"), { multiplier: 1, unit: "X", isBonus: false });
});

test("rates format as points or percent", () => {
  assert.equal(formatRate(3, "X"), "3x");
  assert.equal(formatRate(1.5, "PERCENT"), "1.5%");
});

test("the recommender covers every category but the base", () => {
  assert.ok(!BONUS_CATEGORIES.includes("OTHER"));
  assert.equal(BONUS_CATEGORIES.length, REWARD_CATEGORIES.length - 1);
});

test("every reward category has a label", () => {
  for (const c of REWARD_CATEGORIES) assert.ok(REWARD_CATEGORY_LABELS[c], c);
});

// ── mapping a transaction to a reward category ───────────────────────────

const tx = (pfcPrimary, pfcDetailed = null, userCategory = null) => ({
  pfcPrimary,
  pfcDetailed,
  userCategory,
});

test("the detailed code tells restaurants from supermarkets", () => {
  assert.equal(rewardCategoryFor(tx("FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT")), "DINING");
  assert.equal(rewardCategoryFor(tx("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")), "GROCERIES");
});

test("gas is its own category even though its primary is transportation", () => {
  assert.equal(rewardCategoryFor(tx("TRANSPORTATION", "TRANSPORTATION_GAS")), "GAS");
  assert.equal(rewardCategoryFor(tx("TRANSPORTATION", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES")), "TRANSIT");
});

test("pharmacies earn the drugstore rate", () => {
  assert.equal(rewardCategoryFor(tx("MEDICAL", "MEDICAL_PHARMACIES_AND_SUPPLEMENTS")), "DRUGSTORES");
});

test("a missing or unknown detailed code falls back to the primary", () => {
  assert.equal(rewardCategoryFor(tx("FOOD_AND_DRINK")), "DINING");
  assert.equal(rewardCategoryFor(tx("TRAVEL", "TRAVEL_SOMETHING_NEW")), "TRAVEL");
});

test("food and drink with no detail guesses dining, never groceries", () => {
  // Groceries is the bigger bonus on some cards; guessing it would over-credit.
  assert.equal(rewardCategoryFor(tx("FOOD_AND_DRINK", null)), "DINING");
});

test("superstores and marketplaces earn the base rate, not a bonus", () => {
  assert.equal(
    rewardCategoryFor(tx("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SUPERSTORES")),
    "OTHER"
  );
  assert.equal(
    rewardCategoryFor(tx("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES")),
    "OTHER"
  );
});

test("nothing maps to online shopping", () => {
  const samples = [
    tx("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"),
    tx("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ELECTRONICS"),
    tx("GENERAL_MERCHANDISE"),
    tx("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "Shopping"),
  ];
  for (const s of samples) assert.notEqual(rewardCategoryFor(s), "ONLINE_SHOPPING");
});

test("anything unrecognized earns the base rate", () => {
  assert.equal(rewardCategoryFor(tx("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT")), "OTHER");
  assert.equal(rewardCategoryFor(tx("")), "OTHER");
});

test("a user override beats Plaid's guess", () => {
  assert.equal(
    rewardCategoryFor(tx("FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT", "Groceries")),
    "GROCERIES"
  );
});

test("an override's subcategory earns its parent's rate", () => {
  assert.equal(rewardCategoryFor(tx("GENERAL_MERCHANDISE", null, "Food and Drink > Coffee")), "DINING");
  assert.equal(rewardCategoryFor(tx("GENERAL_MERCHANDISE", null, "Travel>Hotels")), "TRAVEL");
});

test("an override with no reward equivalent earns base, not Plaid's bonus", () => {
  assert.equal(
    rewardCategoryFor(tx("TRAVEL", "TRAVEL_FLIGHTS", "Rent and Utilities")),
    "OTHER"
  );
  assert.equal(rewardCategoryFor(tx("TRAVEL", "TRAVEL_FLIGHTS", "Made Up Category")), "OTHER");
});

test("an empty override counts as no override", () => {
  // computeEarnings relies on this for the remainder of an un-overridden split.
  assert.equal(rewardCategoryFor(tx("TRAVEL", "TRAVEL_FLIGHTS", "")), "TRAVEL");
});

// ── earnings ─────────────────────────────────────────────────────────────

const start = new Date(2026, 0, 1);
const end = new Date(2027, 0, 1);
const inWindow = new Date(2026, 5, 15);

// A points card: 4x dining and groceries, 1x everything else, points worth 2¢.
const gold = {
  id: "gold",
  pointValueCents: 2,
  rewardRates: [rate("DINING", 4), rate("GROCERIES", 4), rate("OTHER", 1)],
};
// A flat 2% cashback card.
const flat = {
  name: "Flat 2%",
  issuer: "CITI",
  pointValueCents: 1,
  rewardRates: [rate("OTHER", 2, "PERCENT")],
};
// 5% on dining only, 1% otherwise.
const diner = {
  name: "Diner 5%",
  issuer: "CHASE",
  pointValueCents: 1,
  rewardRates: [rate("DINING", 5, "PERCENT"), rate("OTHER", 1, "PERCENT")],
};

const txn = (amount, pfcPrimary, pfcDetailed, extra = {}) => ({
  amount,
  date: inWindow,
  pfcPrimary,
  pfcDetailed,
  userCategory: null,
  splits: [],
  ...extra,
});
const restaurant = (amount, extra) =>
  txn(amount, "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT", extra);
const store = (amount, extra) =>
  txn(amount, "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SUPERSTORES", extra);

const byCat = (earnings) => Object.fromEntries(earnings.byCategory.map((c) => [c.category, c]));

test("points convert to dollars at the card's own point value", () => {
  const e = computeEarnings(gold, [], [restaurant(100)], start, end);
  const dining = byCat(e).DINING;
  assert.equal(dining.earned, 400); // points
  assert.equal(dining.value, 8); // 400 × 2¢
  assert.equal(dining.rate, "4x");
  assert.equal(dining.isBonus, true);
  assert.equal(e.unit, "X");
});

test("cashback is already dollars", () => {
  const card = { ...flat, id: "flat" };
  const e = computeEarnings(card, [], [restaurant(100)], start, end);
  assert.equal(e.unit, "PERCENT");
  assert.equal(e.totalEarned, 2);
  assert.equal(e.totalValue, 2);
  assert.equal(byCat(e).DINING.isBonus, false);
});

test("totals add up across categories, largest spend first", () => {
  const e = computeEarnings(gold, [], [store(50), restaurant(100), store(25)], start, end);
  assert.deepEqual(
    e.byCategory.map((c) => [c.category, c.spend]),
    [
      ["DINING", 100],
      ["OTHER", 75],
    ]
  );
  assert.equal(e.totalSpend, 175);
  assert.equal(e.totalEarned, 475);
  assert.equal(e.totalValue, 9.5);
});

test("with no other card, the whole value is incremental", () => {
  const e = computeEarnings(gold, [], [restaurant(100)], start, end);
  assert.equal(byCat(e).DINING.vsBest, 8);
  assert.equal(byCat(e).DINING.bestAlternative, null);
  assert.equal(e.incrementalValue, 8);
});

test("incremental value is measured against the best other card", () => {
  const e = computeEarnings(gold, [flat], [restaurant(100), store(50)], start, end);
  const c = byCat(e);
  assert.equal(c.DINING.vsBest, 6); // $8 vs flat's $2
  assert.equal(c.DINING.bestAlternative, "Flat 2%");
  assert.equal(c.OTHER.vsBest, 0); // $1 vs flat's $1
  assert.equal(e.incrementalValue, 6);
});

test("the best alternative is chosen per category, not overall", () => {
  const e = computeEarnings(gold, [flat, diner], [restaurant(100), store(50)], start, end);
  const c = byCat(e);
  assert.equal(c.DINING.bestAlternative, "Diner 5%"); // $5 beats flat's $2
  assert.equal(c.DINING.vsBest, 3);
  assert.equal(c.OTHER.bestAlternative, "Flat 2%"); // $1 beats diner's $0.50
  assert.equal(e.incrementalValue, 3);
});

test("a card that loses to an alternative shows a negative incremental", () => {
  const cheapPoints = { ...gold, pointValueCents: 1 }; // 400 pts = $4
  const e = computeEarnings(cheapPoints, [diner], [restaurant(100)], start, end);
  assert.equal(byCat(e).DINING.vsBest, -1);
  assert.equal(e.incrementalValue, -1);
});

test("an alternative's points are valued at its own point value", () => {
  const rich = { name: "Rich", issuer: "AMEX", pointValueCents: 3, rewardRates: [rate("OTHER", 1)] };
  const e = computeEarnings(gold, [rich], [store(100)], start, end);
  // gold: 100 pts × 2¢ = $2; rich: 100 pts × 3¢ = $3
  assert.equal(byCat(e).OTHER.vsBest, -1);
});

test("only purchases inside [start, end) count", () => {
  const txns = [
    restaurant(10, { date: new Date(2025, 11, 31) }),
    restaurant(20, { date: start }),
    restaurant(40, { date: new Date(2026, 11, 31) }),
    restaurant(80, { date: end }),
  ];
  assert.equal(computeEarnings(gold, [], txns, start, end).totalSpend, 60);
});

test("refunds and credits don't earn", () => {
  const e = computeEarnings(gold, [], [restaurant(100), restaurant(-30), restaurant(0)], start, end);
  assert.equal(e.totalSpend, 100);
});

test("a split earns per part, and an un-overridden remainder falls to Plaid", () => {
  // $100 at a superstore with $30 carved out as groceries.
  const t = store(100, { splits: [{ amount: 30, userCategory: "Groceries" }] });
  const c = byCat(computeEarnings(gold, [], [t], start, end));
  assert.equal(c.GROCERIES.spend, 30);
  assert.equal(c.GROCERIES.earned, 120);
  assert.equal(c.OTHER.spend, 70); // superstores earn base
});

test("an overridden remainder keeps the row's override", () => {
  const t = store(100, {
    userCategory: "Food and Drink",
    splits: [{ amount: 20, userCategory: "Groceries" }],
  });
  const c = byCat(computeEarnings(gold, [], [t], start, end));
  assert.equal(c.GROCERIES.spend, 20);
  assert.equal(c.DINING.spend, 80);
  assert.equal(c.OTHER, undefined);
});

test("amounts are rounded to cents", () => {
  const card = { id: "c", pointValueCents: 1.7, rewardRates: [rate("OTHER", 1.5)] };
  const e = computeEarnings(card, [], [store(33.33)], start, end);
  // 33.33 × 1.5 = 49.995 pts; × 1.7¢ = $0.849915
  assert.equal(e.totalEarned, 50);
  assert.equal(e.totalValue, 0.85);
});
