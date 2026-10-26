import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

test("globals.css has no terminal rules", () => {
  assert.doesNotMatch(css, /border-radius:\s*0\s*!important/);
  assert.doesNotMatch(css.match(/html,\s*body\s*\{[^}]*\}/)?.[0] ?? "", /monospace/);
  assert.doesNotMatch(css, /text-transform:\s*uppercase/);
  assert.doesNotMatch(css, /content:\s*"▪/);
  assert.doesNotMatch(css, /@keyframes blink/);
});

test("dark variant follows the explicit choice", () => {
  const block = css.match(/@custom-variant dark \{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, "no @custom-variant dark");
  assert.ok(block.includes('[data-theme="dark"]'));
  assert.ok(block.includes(':not([data-theme="light"])'));
});

test("tokens match the spec", () => {
  const light = css.match(/^:root \{([^}]*)\}/m)[1];
  const dark = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)[1];
  for (const d of ["--accent: #007aff", "--bg: #f2f2f7", "--panel: #ffffff"]) assert.ok(light.includes(d), d);
  for (const d of ["--accent: #0a84ff", "--bg: #000000", "--panel: #1c1c1e"]) assert.ok(dark.includes(d), d);
});

const tsx = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return p === join(root, "src/app/api") ? [] : tsx(p);
    return p.endsWith(".tsx") ? [p] : [];
  });

test("no terminal leftovers in components", () => {
  const bad = /\buppercase\b|tracking-(wide|wider|widest|\[)|font-mono|▪|className="blink"/;
  const hits = tsx(join(root, "src")).filter((f) => bad.test(readFileSync(f, "utf8")));
  assert.deepEqual(hits, []);
});
