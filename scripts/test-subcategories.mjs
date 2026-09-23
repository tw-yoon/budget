import test from "node:test";
import assert from "node:assert/strict";
import { groupSubcategories } from "../src/lib/subcategories.ts";

const names = (map, parent) => map.get(parent).map((s) => s.name);

test("a declared sub with no usage is listed with zero counts", () => {
  const map = groupSubcategories(["Dining"], [{ parent: "Dining", name: "Coffee" }], [], []);
  assert.deepEqual(map.get("Dining"), [
    { name: "Coffee", declared: true, transactionCount: 0, ruleCount: 0 },
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
    { name: "Movies", declared: false, transactionCount: 3, ruleCount: 1 },
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
    { name: "Coffee", declared: true, transactionCount: 2, ruleCount: 0 },
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
