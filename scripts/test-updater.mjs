import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUpdater, parseLauncherStatus, readUpdateState, UPDATE_COMMAND, updateEnv } from "../src/lib/updater.ts";
import { pollOutcome } from "../src/lib/update-poll.ts";
import { createPhoneUpdater, PHONE_COMMAND } from "../src/lib/phone-updater.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "updater-"));
const line = (o) => JSON.stringify({ version: "1.0.0", latest: "1.1.0", behind: 2, blocker: "", ...o }) + "\n";

function fake(dir, out = line({}), now = 1_000_000) {
  const calls = { status: 0, start: 0 };
  const clock = { now };
  const updater = createUpdater({
    dir,
    runStatus: async () => { calls.status++; return out; },
    startUpdate: () => { calls.start++; },
    now: () => clock.now,
  });
  return { updater, calls, clock };
}

test("parses the launcher's line, ignoring anything printed before it", () => {
  assert.deepEqual(parseLauncherStatus("noise\n" + line({})), { version: "1.0.0", latest: "1.1.0", behind: 2, blocker: "" });
  assert.throws(() => parseLauncherStatus("not json"));
});

test("status maps the launcher's answer", async () => {
  const { updater } = fake(tmp());
  const s = await updater.status();
  assert.equal(s.version, "1.0.0");
  assert.equal(s.latest, "1.1.0");
  assert.equal(s.available, true);
  assert.equal(s.canUpdate, true);
  assert.equal(s.updating, false);
  assert.equal(s.failed, null);
});

test("a blocker means no Install", async () => {
  const { updater } = fake(tmp(), line({ blocker: "subfolder", latest: null, behind: 0 }));
  const s = await updater.status();
  assert.equal(s.canUpdate, false);
  assert.equal(s.available, false);
});

test("the launcher runs at most once an hour unless asked", async () => {
  const { updater, calls, clock } = fake(tmp());
  await updater.status();
  await updater.status();
  assert.equal(calls.status, 1);
  await updater.status(true);
  assert.equal(calls.status, 2);
  clock.now += 60 * 60 * 1000 + 1;
  await updater.status();
  assert.equal(calls.status, 3);
});

test("start writes the start time, clears the last exit and spawns once", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".update-exit"), "1\n");
  const { updater, calls } = fake(dir);
  assert.deepEqual(await updater.start(), { ok: true });
  assert.equal(calls.start, 1);
  assert.equal(fs.readFileSync(path.join(dir, ".update-started"), "utf8").trim(), "1000000");
  assert.equal(fs.existsSync(path.join(dir, ".update-exit")), false);
  assert.equal((await updater.status()).updating, true);
  assert.deepEqual(await updater.start(), { error: "An update is already running." });
  assert.equal(calls.start, 1);
});

test("while an update runs, status never runs the launcher (its fetch would race the pull)", async () => {
  const { updater, calls, clock } = fake(tmp());
  assert.deepEqual(await updater.start(), { ok: true });
  assert.equal(calls.status, 1);
  const s = await updater.status(true);
  assert.equal(s.updating, true);
  assert.equal(s.version, "1.0.0");
  clock.now += 10 * 60 * 1000; // still within the update's 15 minutes
  await updater.status(true);
  await updater.status(true);
  assert.equal(calls.status, 1);
});

test("a server with no cache still answers while the state files say updating", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".update-started"), "1000000\n");
  const { updater, calls } = fake(dir);
  assert.equal((await updater.status()).updating, true);
  assert.equal(calls.status, 1);
});

test("the update gets a clean environment, not the server's", () => {
  const env = updateEnv({
    PATH: "/usr/bin", BUDGET_PORT: "39173", DATABASE_URL: "file:x",
    NODE_ENV: "production", PORT: "3000", __NEXT_PROCESSED_ENV: "true", NEXT_RUNTIME: "nodejs",
    NEXT_PUBLIC_X: "1", npm_lifecycle_event: "start", npm_config_prefix: "/x",
  });
  assert.deepEqual(env, { PATH: "/usr/bin", BUDGET_PORT: "39173", DATABASE_URL: "file:x" });
});

test("start refuses a copy that can't update, and an up-to-date one", async () => {
  assert.deepEqual(await fake(tmp(), line({ blocker: "subfolder" })).updater.start(),
    { error: "This copy is updated from its repository, not from here." });
  assert.deepEqual(await fake(tmp(), line({ behind: 0, latest: "1.0.0" })).updater.start(),
    { error: "Budget is already up to date." });
});

test("updating ends with the exit file, or after 15 minutes", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".update-started"), "1000000\n");
  assert.equal(readUpdateState(dir, 1_000_000 + 1000).updating, true);
  assert.equal(readUpdateState(dir, 1_000_000 + 15 * 60 * 1000 + 1).updating, false);
  fs.writeFileSync(path.join(dir, ".update-exit"), "0\n");
  fs.utimesSync(path.join(dir, ".update-exit"), 1001, 1001); // seconds: after the start
  assert.deepEqual(readUpdateState(dir, 1_002_000), { updating: false, failed: null });
});

test("a non-zero exit reports the log's last five lines", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".update-started"), "1000000\n");
  fs.writeFileSync(path.join(dir, ".update.log"), "a\nb\n\nc\nd\ne\nf\n\n");
  fs.writeFileSync(path.join(dir, ".update-exit"), "1\n");
  fs.utimesSync(path.join(dir, ".update-exit"), 1001, 1001);
  assert.deepEqual(readUpdateState(dir, 1_002_000), { updating: false, failed: "b\nc\nd\ne\nf" });
});

test("the update runs the launcher detached and records its exit", () => {
  assert.equal(UPDATE_COMMAND, "./Budget.command --update --no-open > .update.log 2>&1; echo $? > .update-exit");
});

test("polling is done once the update ended without a failure, version bump or not", () => {
  const base = { version: "1.0.0", latest: "1.1.0", available: true, canUpdate: true, updating: false, failed: null, checkedAt: "" };
  assert.equal(pollOutcome(null), "waiting");
  assert.equal(pollOutcome({ ...base, updating: true }), "waiting");
  assert.equal(pollOutcome({ ...base, version: "1.1.0", updating: true }), "waiting");
  assert.equal(pollOutcome({ ...base, version: "1.1.0" }), "done");
  assert.equal(pollOutcome(base), "done");
  assert.equal(pollOutcome({ ...base, failed: "boom" }), "failed");
});

test("after a successful update clears the state files, polling sees done", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".update-exit"), "0\n"); // the app's wrapper, after the launcher cleared both
  const { updater } = fake(dir);
  assert.equal(pollOutcome(await updater.status()), "done");
});

// Update iPhone (src/lib/phone-updater.ts).
function fakePhone(dir, now = 1_000_000) {
  const calls = { start: 0 };
  const phone = createPhoneUpdater({ dir, startInstall: () => { calls.start++; }, now: () => now });
  return { phone, calls };
}
function phoneDir({ setUp = true } = {}) {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "ios/scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ios/Config"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ios/scripts/phone.sh"), "");
  if (setUp) fs.writeFileSync(path.join(dir, "ios/Config/Local.xcconfig"), "");
  return dir;
}
const phoneState = (dir, f) => path.join(dir, "ios/build/phone", f);

test("Update iPhone needs the iPhone app set up on this Mac", () => {
  const { phone, calls } = fakePhone(phoneDir({ setUp: false }));
  assert.equal(phone.status().available, false);
  assert.deepEqual(phone.start(), { error: "The iPhone app isn't set up on this Mac." });
  assert.equal(calls.start, 0);
});

test("Update iPhone starts once and reports the last install", () => {
  const dir = phoneDir();
  const { phone, calls } = fakePhone(dir);
  assert.deepEqual(phone.status(), { available: true, installing: false, failed: null, lastInstalled: null });
  assert.deepEqual(phone.start(), { ok: true });
  assert.equal(phone.status().installing, true);
  assert.deepEqual(phone.start(), { error: "The iPhone is already updating." });
  assert.equal(calls.start, 1);
  fs.writeFileSync(phoneState(dir, "last-success"), "1001\n");
  fs.writeFileSync(phoneState(dir, "app-exit"), "0\n");
  fs.utimesSync(phoneState(dir, "app-exit"), 1001, 1001);
  assert.deepEqual(phone.status(), {
    available: true, installing: false, failed: null, lastInstalled: new Date(1_001_000).toISOString(),
  });
});

test("a failed Update iPhone reports phone.sh's last line", () => {
  const dir = phoneDir();
  const { phone } = fakePhone(dir);
  phone.start();
  fs.writeFileSync(phoneState(dir, "app-output"), "Building for the iPhone…\nInstall failed. Is the iPhone unlocked?\n");
  fs.writeFileSync(phoneState(dir, "app-exit"), "1\n");
  fs.utimesSync(phoneState(dir, "app-exit"), 1001, 1001);
  assert.equal(phone.status().failed, "Install failed. Is the iPhone unlocked?");
});

test("Update iPhone runs phone.sh and records its exit", () => {
  assert.equal(PHONE_COMMAND,
    "bash ios/scripts/phone.sh install > ios/build/phone/app-output 2>&1; echo $? > ios/build/phone/app-exit");
});
