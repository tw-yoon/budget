import test from "node:test";
import assert from "node:assert/strict";
import { renameCategoryIn } from "../src/lib/category-rename.ts";

test("an exact match becomes the new name", () => {
  assert.equal(renameCategoryIn("Dining", "Dining", "Food"), "Food");
});

test("a subcategory keeps its sub and gets the new parent", () => {
  assert.equal(
    renameCategoryIn("Home Improvement > Furniture", "Home Improvement", "Home"),
    "Home > Furniture"
  );
});

test("an unrelated value is left alone", () => {
  assert.equal(renameCategoryIn("Groceries", "Dining", "Food"), null);
});

test("a name that is a prefix of another does not rewrite it", () => {
  // "Home" must not capture "Home Improvement" — the separator is required.
  assert.equal(renameCategoryIn("Home Improvement", "Home", "House"), null);
});

test("a rename is case-sensitive", () => {
  assert.equal(renameCategoryIn("dining", "Dining", "Food"), null);
});

test("only the first separator is treated as the parent boundary", () => {
  assert.equal(
    renameCategoryIn("Travel > Flights > Intl", "Travel", "Trips"),
    "Trips > Flights > Intl"
  );
});
