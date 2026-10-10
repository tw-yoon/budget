import test from "node:test";
import assert from "node:assert/strict";
import { withLabelLock } from "../src/lib/next-label.ts";

test("label jobs run one at a time, and a failure doesn't block the next", async () => {
  const log = [];
  const job = (name, fail) => async () => {
    log.push(`${name} start`);
    await new Promise((r) => setTimeout(r, 5));
    log.push(`${name} end`);
    if (fail) throw new Error(name);
  };
  const results = await Promise.allSettled([
    withLabelLock(job("a", true)),
    withLabelLock(job("b")),
  ]);
  assert.deepEqual(log, ["a start", "a end", "b start", "b end"]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
});
