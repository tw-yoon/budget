import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const version = JSON.parse(read("../package.json")).version;
const changelog = read("../CHANGELOG.md");

// "## 0.4.0 — 2026-09-24", newest first.
const releases = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?: — (\d{4}-\d{2}-\d{2}))?$/gm)].map(
  (m) => ({ version: m[1], date: m[2] })
);

test("the version is MAJOR.MINOR.PATCH", () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("the changelog's newest entry is the version being shipped", () => {
  // The launcher compares this field across clones to tell you an update is
  // waiting, so a release that forgets to bump it is silently invisible.
  assert.ok(releases.length > 0, "no releases found in CHANGELOG.md");
  assert.equal(releases[0].version, version);
});

test("every release is dated", () => {
  for (const r of releases) assert.ok(r.date, `${r.version} has no date`);
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
