import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const version = JSON.parse(read("../package.json")).version;
const changelog = read("../CHANGELOG.md");

// Every "## …" line, taken whole rather than by a pattern that only matches
// what is expected: a heading the pattern misses would drop out of the checks
// entirely, which is how a dated "## Unreleased" first slipped through.
const headings = [...changelog.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
const RELEASE = /^(\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/;
const releases = headings
  .filter((h) => RELEASE.test(h))
  .map((h) => ({ version: h.match(RELEASE)[1], date: h.match(RELEASE)[2] }));

test("the version is MAJOR.MINOR.PATCH", () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("package.json carries the newest released version", () => {
  // Versions number releases, not commits: this field is what has actually
  // been published, so unreleased work on main leaves it alone. The launcher
  // compares it across clones to tell you an update is waiting, so a release
  // that forgets to bump it is silently invisible.
  assert.ok(releases.length > 0, "no releases found in CHANGELOG.md");
  assert.equal(releases[0].version, version);
});

test("every heading is either Unreleased or a dated release", () => {
  // Dating the Unreleased section would make unshipped work look published; it
  // gets a number and a date at the moment it is released, and not before.
  for (const h of headings)
    assert.ok(h === "Unreleased" || RELEASE.test(h), `malformed heading: "## ${h}"`);
});

test("unreleased work is collected above the releases", () => {
  const unreleased = headings.filter((h) => h === "Unreleased");
  assert.ok(unreleased.length <= 1, "more than one Unreleased section");
  if (unreleased.length) assert.equal(headings[0], "Unreleased");
});

test("releases are listed newest first, with no repeats", () => {
  const rank = (v) => v.split(".").map(Number);
  const cmp = (a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };
  for (let i = 1; i < releases.length; i++) {
    assert.ok(
      cmp(releases[i - 1].version, releases[i].version) > 0,
      `${releases[i - 1].version} should come after ${releases[i].version}`
    );
  }
});

test("the dates run newest first too", () => {
  const dates = releases.map((r) => r.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});
