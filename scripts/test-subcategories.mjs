import test from "node:test";
import assert from "node:assert/strict";
import { groupSubcategories } from "../src/lib/subcategories.ts";

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
      name: "Food and Drink Restaurant",
      code: "FOOD_AND_DRINK_RESTAURANT",
      count: 5,
      renamed: false,
    },
  ]);
  assert.deepEqual(map.get("Food and Drink"), [
    {
      name: "Food and Drink Restaurant",
      declared: false,
      transactionCount: 0,
      ruleCount: 0,
      plaidLabels: ["FOOD_AND_DRINK_RESTAURANT"],
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
      { parent: "Food and Drink", name: "Eating Out", code: "FOOD_AND_DRINK_RESTAURANT", count: 4, renamed: true },
      { parent: "Food and Drink", name: "Eating Out", code: "FOOD_AND_DRINK_FAST_FOOD", count: 2, renamed: true },
    ]
  );
  assert.deepEqual(map.get("Food and Drink"), [
    {
      name: "Eating Out",
      declared: true,
      transactionCount: 1,
      ruleCount: 0,
      plaidLabels: ["FOOD_AND_DRINK_FAST_FOOD", "FOOD_AND_DRINK_RESTAURANT"],
      plaidTransactionCount: 6,
      renamed: true,
    },
  ]);
});

test("a preset whose category is not in the list is left out", () => {
  const map = groupSubcategories(["Travel"], [], [], [], [
    { parent: "Entertainment", name: "Entertainment Video Games", code: "ENTERTAINMENT_VIDEO_GAMES", count: 3, renamed: false },
  ]);
  assert.deepEqual(map.get("Travel"), []);
});
