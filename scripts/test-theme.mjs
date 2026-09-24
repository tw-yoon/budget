import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEME_KEY, resolveTheme, themeAttribute } from "../src/lib/theme.ts";

// ── the stored choice ────────────────────────────────────────────────────

test("a recognized choice is kept", () => {
  assert.equal(resolveTheme("light"), "light");
  assert.equal(resolveTheme("dark"), "dark");
});

test("anything else means follow the system", () => {
  // The store is a JSON file a user can edit, and older builds wrote other
  // keys: a value nobody recognizes must not take the page down.
  for (const junk of [null, undefined, "", "System", "auto", 1, true, {}, []])
    assert.equal(resolveTheme(junk), "system");
});

test("only an explicit choice sets the attribute", () => {
  assert.equal(themeAttribute("light"), "light");
  assert.equal(themeAttribute("dark"), "dark");
  assert.equal(themeAttribute("system"), null); // nothing to override
});

test("the store key is stable", () => {
  // Renaming it silently resets everyone's choice to system.
  assert.equal(THEME_KEY, "theme");
});

// ── the two dark palettes stay identical ─────────────────────────────────

const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");

const declarations = (block) =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  );

const followsSystem = css.match(
  /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/
);
const chosenDark = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/);
const light = css.match(/^:root \{([^}]*)\}/m);

test("globals.css has all three palettes", () => {
  assert.ok(light, "no light :root block");
  assert.ok(followsSystem, "no prefers-color-scheme dark block");
  assert.ok(chosenDark, "no [data-theme=dark] block");
});

test("choosing dark gives exactly what the system-dark palette gives", () => {
  // Two selectors, no way to share one block without a preprocessor — so the
  // only thing keeping them honest is this test.
  assert.deepEqual(declarations(chosenDark[1]), declarations(followsSystem[1]));
});

test("the dark palettes override every colour light defines", () => {
  // A variable left out of dark keeps its light value, which is how a legible
  // pairing turns into white-on-white.
  const lightVars = Object.keys(declarations(light[1])).filter((v) => !v.startsWith("--back") && !v.startsWith("--fore"));
  const darkVars = Object.keys(declarations(chosenDark[1]));
  assert.deepEqual(lightVars.filter((v) => !darkVars.includes(v)), []);
});

test("an explicit light choice survives a dark system", () => {
  // The :not() is what makes "light" mean light on a dark OS.
  assert.match(followsSystem[0], /:root:not\(\[data-theme="light"\]\)/);
});
