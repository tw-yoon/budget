import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSynced, pushSynced } from "../src/lib/ui-state.ts";
import { createUiStateStore } from "../src/lib/ui-state-store.ts";

// ── the browser side: server copy first, localStorage as cache/fallback ──

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  delete globalThis.localStorage;
});

/**
 * Stubs fetch and localStorage. `server` is "down" (fetch rejects), or the
 * {status, value} that GET /api/ui-state answers with; PUTs succeed unless
 * the server is down. Returns the calls made and the localStorage contents.
 */
function browser({ server, local = {}, storageThrows = false }) {
  const calls = [];
  const storage = new Map(Object.entries(local));
  globalThis.localStorage = storageThrows
    ? {
        getItem() {
          throw new Error("SecurityError");
        },
        setItem() {
          throw new Error("SecurityError");
        },
      }
    : {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
      };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (server === "down") throw new TypeError("fetch failed");
    if (method === "PUT") return { ok: true, json: async () => ({ ok: true }) };
    return { ok: server.status === 200, json: async () => ({ value: server.value }) };
  };
  const puts = () => calls.filter((c) => c.method === "PUT");
  return { calls, puts, storage };
}

// Let a fire-and-forget fetch settle, so an unhandled rejection would surface.
const settle = () => new Promise((r) => setImmediate(r));

test("the server's value wins and is cached locally", async () => {
  const b = browser({ server: { status: 200, value: { open: true } }, local: { k: '"stale"' } });
  assert.deepEqual(await loadSynced("k"), { open: true });
  assert.equal(b.storage.get("k"), '{"open":true}');
  assert.equal(b.puts().length, 0);
});

test("a falsy server value still beats the local copy", async () => {
  browser({ server: { status: 200, value: false }, local: { k: "true" } });
  assert.equal(await loadSynced("k"), false);
});

test("when the server has nothing, this browser's value is adopted and pushed up", async () => {
  const b = browser({ server: { status: 200, value: null }, local: { k: "[1,2]" } });
  assert.deepEqual(await loadSynced("k"), [1, 2]);
  assert.deepEqual(b.puts().map((c) => c.body), [{ key: "k", value: [1, 2] }]);
});

test("a legacy plain-string value is read as a string and migrated", async () => {
  const b = browser({ server: { status: 200, value: null }, local: { k: "dark" } });
  assert.equal(await loadSynced("k"), "dark");
  assert.deepEqual(b.puts()[0].body, { key: "k", value: "dark" });
});

test("an unreachable server falls back to the local copy without pushing", async () => {
  const b = browser({ server: "down", local: { k: "42" } });
  assert.equal(await loadSynced("k"), 42);
  assert.equal(b.puts().length, 0);
});

test("a failing server isn't seeded from the local copy", async () => {
  // A 500 says nothing about what the server holds; pushing could clobber it.
  const b = browser({ server: { status: 500 }, local: { k: "42" } });
  assert.equal(await loadSynced("k"), 42);
  assert.equal(b.puts().length, 0);
});

test("nothing saved anywhere reads as null", async () => {
  const b = browser({ server: { status: 200, value: null } });
  assert.equal(await loadSynced("k"), null);
  assert.equal(b.puts().length, 0);
});

test("an empty local value counts as nothing saved", async () => {
  const b = browser({ server: { status: 200, value: null }, local: { k: "" } });
  assert.equal(await loadSynced("k"), null);
  assert.equal(b.puts().length, 0);
});

test("blocked localStorage doesn't stop the server value loading", async () => {
  browser({ server: { status: 200, value: "x" }, storageThrows: true });
  assert.equal(await loadSynced("k"), "x");
  browser({ server: { status: 200, value: null }, storageThrows: true });
  assert.equal(await loadSynced("k"), null);
});

test("the key is URL-encoded", async () => {
  const b = browser({ server: { status: 200, value: 1 } });
  await loadSynced("income&range=all");
  assert.equal(b.calls[0].url, "/api/ui-state?key=income%26range%3Dall");
});

test("a push writes the local copy and sends it to the server", async () => {
  const b = browser({ server: { status: 200, value: null } });
  pushSynced("k", { a: 1 });
  assert.equal(b.storage.get("k"), '{"a":1}');
  assert.deepEqual(b.puts().map((c) => c.body), [{ key: "k", value: { a: 1 } }]);
});

test("a push while offline keeps the local copy and doesn't throw", async () => {
  const b = browser({ server: "down" });
  pushSynced("k", 7);
  await settle();
  assert.equal(b.storage.get("k"), "7");
});

test("a push with blocked localStorage still reaches the server", async () => {
  const b = browser({ server: { status: 200, value: null }, storageThrows: true });
  pushSynced("k", 7);
  assert.equal(b.puts().length, 1);
});

// ── the server side: data/ui-state.json ──────────────────────────────────

// Scratch space inside the app folder (gitignored), not the system temp dir.
const TMP_ROOT = fileURLToPath(new URL("../.test-tmp/", import.meta.url));
let dir;
before(async () => {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  dir = await fs.mkdtemp(path.join(TMP_ROOT, "ui-state-"));
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rmdir(TMP_ROOT).catch(() => {}); // only if nothing else is using it
});

let n = 0;
const freshStore = () => {
  const file = path.join(dir, `store-${++n}`, "ui-state.json");
  return { file, store: createUiStateStore(file) };
};
const tmpFilesIn = async (file) =>
  (await fs.readdir(path.dirname(file))).filter((f) => f.endsWith(".tmp"));

test("a store with no file yet reads as empty", async () => {
  const { store } = freshStore();
  assert.deepEqual(await store.readAll(), {});
});

test("a put is read back, and creates the data folder", async () => {
  const { store } = freshStore();
  await store.put("limit", 500);
  assert.deepEqual(await store.readAll(), { limit: 500 });
});

test("a put replaces only its own key", async () => {
  const { store } = freshStore();
  await store.put("a", 1);
  await store.put("b", 2);
  await store.put("a", 3);
  assert.deepEqual(await store.readAll(), { a: 3, b: 2 });
});

test("an undefined value is stored as null", async () => {
  const { store } = freshStore();
  await store.put("a", undefined);
  assert.deepEqual(await store.readAll(), { a: null });
});

test("the previous version of the file is kept as .bak", async () => {
  const { file, store } = freshStore();
  await store.put("a", 1);
  await store.put("a", 2);
  assert.deepEqual(JSON.parse(await fs.readFile(file + ".bak", "utf8")), { a: 1 });
});

test("an unreadable file reads as empty", async () => {
  const { file, store } = freshStore();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "{not json");
  assert.deepEqual(await store.readAll(), {});
});

test("overlapping puts all land", async () => {
  // The bug this pins: each put read the same baseline, so the last rename won
  // and every other key was lost.
  const { file, store } = freshStore();
  const keys = Array.from({ length: 25 }, (_, i) => `card-${i}`);
  await Promise.all(keys.map((k, i) => store.put(k, i)));
  const all = await store.readAll();
  assert.deepEqual(Object.keys(all).sort(), [...keys].sort());
  assert.deepEqual(await tmpFilesIn(file), []);
});

test("a failed put doesn't block the ones queued behind it", async () => {
  const { file, store } = freshStore();
  const results = await Promise.allSettled([
    store.put("a", 1),
    store.put("bad", 10n), // BigInt: JSON.stringify throws
    store.put("b", 2),
  ]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.deepEqual(await store.readAll(), { a: 1, b: 2 });
  assert.deepEqual(await tmpFilesIn(file), []);
});
