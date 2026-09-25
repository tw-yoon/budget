import test from "node:test";
import assert from "node:assert/strict";
import { groupSubcategories } from "../src/lib/subcategories.ts";
import { humanizePfcDetailed } from "../src/lib/format.ts";

const names = (map, parent) => map.get(parent).map((s) => s.name);
const NO_PRESET = { plaidLabels: [], plaidTransactionCount: 0, renamed: false };

test("a declared sub with no usage is listed with zero counts", () => {
  const map = groupSubcategories(["Dining"], [{ parent: "Dining", name: "Coffee" }], [], []);
  assert.deepEqual(map.get("Dining"), [
    { name: "Coffee", declared: true, transactionCount: 0, ruleCount: 0, ...NO_PRESET },
  ]);
});

test("a used but undeclared sub is listed too", () => {
  const map = groupSubcategories(
    ["Entertainment"],
    [],
    [{ value: "Entertainment > Movies", count: 3 }],
    [{ value: "Entertainment > Movies", count: 1 }]
  );
  assert.deepEqual(map.get("Entertainment"), [
    { name: "Movies", declared: false, transactionCount: 3, ruleCount: 1, ...NO_PRESET },
  ]);
});

test("declared and used merge into one entry", () => {
  const map = groupSubcategories(
    ["Dining"],
    [{ parent: "Dining", name: "Coffee" }],
    [{ value: "Dining > Coffee", count: 2 }],
    []
  );
  assert.deepEqual(map.get("Dining"), [
    { name: "Coffee", declared: true, transactionCount: 2, ruleCount: 0, ...NO_PRESET },
  ]);
});

test("every parent gets an entry, empty when it has no subs", () => {
  const map = groupSubcategories(["Dining", "Travel"], [], [], []);
  assert.deepEqual(map.get("Travel"), []);
});

test("bare categories and subs of unknown parents are ignored", () => {
  const map = groupSubcategories(
    ["Dining"],
    [{ parent: "Gone", name: "X" }],
    [
      { value: "Dining", count: 9 },
      { value: "FOOD_AND_DRINK > Snacks", count: 1 },
    ],
    []
  );
  assert.deepEqual(map.get("Dining"), []);
  assert.equal(map.has("Gone"), false);
});

test("subs are sorted by name", () => {
  const map = groupSubcategories(
    ["Travel"],
    [{ parent: "Travel", name: "Lodging" }],
    [{ value: "Travel > Flights", count: 1 }],
    []
  );
  assert.deepEqual(names(map, "Travel"), ["Flights", "Lodging"]);
});

test("only the first separator splits parent from sub", () => {
  const map = groupSubcategories(
    ["Travel"],
    [],
    [{ value: "Travel > Flights > Intl", count: 1 }],
    []
  );
  assert.deepEqual(names(map, "Travel"), ["Flights > Intl"]);
});

test("a Plaid preset is listed under the category it resolves to", () => {
  const map = groupSubcategories(["Food and Drink"], [], [], [], [
    {
      parent: "Food and Drink",
      name: "Restaurant",
      plaidName: "Restaurant",
      code: "FOOD_AND_DRINK_RESTAURANT",
      count: 5,
      renamed: false,
    },
  ]);
  assert.deepEqual(map.get("Food and Drink"), [
    {
      name: "Restaurant",
      declared: false,
      transactionCount: 0,
      ruleCount: 0,
      plaidLabels: [{ code: "FOOD_AND_DRINK_RESTAURANT", name: "Restaurant" }],
      plaidTransactionCount: 5,
      renamed: false,
    },
  ]);
});

test("presets renamed onto one name share an entry with the declared sub", () => {
  const map = groupSubcategories(
    ["Food and Drink"],
    [{ parent: "Food and Drink", name: "Eating Out" }],
    [{ value: "Food and Drink > Eating Out", count: 1 }],
    [],
    [
      { parent: "Food and Drink", name: "Eating Out", plaidName: "Restaurant", code: "FOOD_AND_DRINK_RESTAURANT", count: 4, renamed: true },
      { parent: "Food and Drink", name: "Eating Out", plaidName: "Fast Food", code: "FOOD_AND_DRINK_FAST_FOOD", count: 2, renamed: true },
    ]
  );
  assert.deepEqual(map.get("Food and Drink"), [
    {
      name: "Eating Out",
      declared: true,
      transactionCount: 1,
      ruleCount: 0,
      plaidLabels: [
        { code: "FOOD_AND_DRINK_FAST_FOOD", name: "Fast Food" },
        { code: "FOOD_AND_DRINK_RESTAURANT", name: "Restaurant" },
      ],
      plaidTransactionCount: 6,
      renamed: true,
    },
  ]);
});

test("a preset whose category is not in the list is left out", () => {
  const map = groupSubcategories(["Travel"], [], [], [], [
    { parent: "Entertainment", name: "Video Games", plaidName: "Video Games", code: "ENTERTAINMENT_VIDEO_GAMES", count: 3, renamed: false },
  ]);
  assert.deepEqual(map.get("Travel"), []);
});

test("a Plaid preset named like a custom sub shares its entry", () => {
  const map = groupSubcategories(
    ["Food and Drink"],
    [],
    [{ value: "Food and Drink > Restaurant", count: 6 }],
    [],
    [{ parent: "Food and Drink", name: "Restaurant", plaidName: "Restaurant", code: "FOOD_AND_DRINK_RESTAURANT", count: 59, renamed: false }]
  );
  const [only, ...rest] = map.get("Food and Drink");
  assert.equal(rest.length, 0);
  assert.equal(only.transactionCount, 6);
  assert.equal(only.plaidTransactionCount, 59);
});

test("a Plaid sub name drops the category it repeats", () => {
  assert.equal(humanizePfcDetailed("FOOD_AND_DRINK_RESTAURANT", "FOOD_AND_DRINK"), "Restaurant");
  assert.equal(
    humanizePfcDetailed("GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", "GENERAL_MERCHANDISE"),
    "Online Marketplaces"
  );
  assert.equal(
    humanizePfcDetailed("TRANSFER_IN_TRANSFER_IN_FROM_APPS", "TRANSFER_IN"),
    "From Apps"
  );
  assert.equal(humanizePfcDetailed("ENTERTAINMENT_TV_AND_MOVIES", "ENTERTAINMENT"), "TV and Movies");
});

test("an 'other' Plaid sub that repeats its category is just Other", () => {
  assert.equal(humanizePfcDetailed("MEDICAL_OTHER_MEDICAL", "MEDICAL"), "Other");
  assert.equal(humanizePfcDetailed("BANK_FEES_OTHER_BANK_FEES", "BANK_FEES"), "Other");
  assert.equal(humanizePfcDetailed("OTHER_OTHER", "OTHER"), "Other");
  assert.equal(humanizePfcDetailed("LOAN_PAYMENTS_OTHER_PAYMENT", "LOAN_PAYMENTS"), "Other Payment");
});

test("a Plaid sub that does not start with its primary is kept whole", () => {
  assert.equal(humanizePfcDetailed("SOMETHING_ELSE", "FOOD_AND_DRINK"), "Something Else");
});
