import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";
import { serverTiming, withServerTiming } from "../src/lib/server-timing.ts";

test("the header carries the duration in milliseconds, one decimal", () => {
  assert.equal(serverTiming(12.345), "app;dur=12.3");
});

test("a wrapped handler's answer gains the header and keeps its body", async () => {
  const handler = withServerTiming(async (n) => Response.json({ n }, { status: 201 }));
  const res = await handler(7);
  assert.equal(res.status, 201);
  assert.match(res.headers.get("Server-Timing"), /^app;dur=\d+\.\d$/);
  assert.deepEqual(await res.json(), { n: 7 });
});

// Next compresses pages but not route handlers, and the phone reads only
// route handlers, so the wrapper gzips large JSON answers itself.
const big = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Sample Mart ${i}` })) };
const ask = (encoding) =>
  new Request("http://localhost/api/x", encoding ? { headers: { "Accept-Encoding": encoding } } : {});

test("a large JSON answer is gzipped for a caller that accepts gzip", async () => {
  const handler = withServerTiming(async () => Response.json(big, { status: 200 }));
  const res = await handler(ask("gzip, deflate, br"));
  assert.equal(res.headers.get("Content-Encoding"), "gzip");
  assert.match(res.headers.get("Vary"), /Accept-Encoding/);
  assert.match(res.headers.get("Server-Timing"), /^app;dur=/);
  assert.equal(res.headers.get("Content-Type"), "application/json");
  const raw = Buffer.from(await res.arrayBuffer());
  assert.ok(raw.length < JSON.stringify(big).length / 3);
  assert.deepEqual(JSON.parse(gunzipSync(raw).toString()), big);
});

test("no gzip when the caller doesn't ask for it", async () => {
  const handler = withServerTiming(async () => Response.json(big));
  for (const res of [await handler(ask()), await handler(ask("identity")), await handler(7)]) {
    assert.equal(res.headers.get("Content-Encoding"), null);
    assert.deepEqual(await res.json(), big);
  }
});

test("small answers, non-JSON answers and empty bodies are left alone", async () => {
  const small = await withServerTiming(async () => Response.json({ ok: true }))(ask("gzip"));
  assert.equal(small.headers.get("Content-Encoding"), null);
  assert.deepEqual(await small.json(), { ok: true });

  const png = new Uint8Array(4096).fill(7);
  const image = await withServerTiming(async () =>
    new Response(png, { headers: { "Content-Type": "image/png" } }))(ask("gzip"));
  assert.equal(image.headers.get("Content-Encoding"), null);
  assert.equal((await image.arrayBuffer()).byteLength, 4096);

  const empty = await withServerTiming(async () => new Response(null, { status: 204 }))(ask("gzip"));
  assert.equal(empty.status, 204);
  assert.equal(empty.headers.get("Content-Encoding"), null);
});

test("an answer that is already encoded is not gzipped twice", async () => {
  const already = gzipSync(JSON.stringify(big));
  const res = await withServerTiming(async () => new Response(already, {
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
  }))(ask("gzip"));
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()), big);
});
