import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteAccessToken, getAccessToken, saveAccessToken } from "../src/lib/token-store.ts";

test("plaid tokens round-trip encrypted, delete removes one, a wrong key fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-store-"));
  const file = path.join(dir, "tokens.enc");
  process.env.TOKEN_STORE_PATH = file;
  process.env.TOKEN_STORE_KEY = "1".repeat(64);
  try {
    saveAccessToken("item-a", "access-sandbox-a");
    saveAccessToken("item-b", "access-sandbox-b");
    assert.ok(!fs.readFileSync(file, "utf8").includes("access-sandbox"), "stored in plain text");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dir), ["tokens.enc"], "temp file left behind");

    deleteAccessToken("item-a");
    assert.throws(() => getAccessToken("item-a"), /No access token/);
    assert.equal(getAccessToken("item-b"), "access-sandbox-b");

    process.env.TOKEN_STORE_KEY = "2".repeat(64);
    assert.throws(() => getAccessToken("item-b"), /Failed to decrypt/);
  } finally {
    delete process.env.TOKEN_STORE_PATH;
    delete process.env.TOKEN_STORE_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
