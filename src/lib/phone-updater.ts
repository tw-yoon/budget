import fs from "node:fs";
import path from "node:path";
import type { PhoneUpdateStatusDTO } from "@/types";

// Update iPhone: the Mac rebuilds the iPhone app and installs it on the paired
// phone, as `bash ios/scripts/phone.sh install` does in Terminal. phone.sh
// stays the one place that knows how; this starts it, detached, and reads the
// files it leaves in ios/build/phone. Process calls are injected for the tests.

export const PHONE_TIMEOUT_MS = 20 * 60 * 1000;
export const PHONE_COMMAND =
  "bash ios/scripts/phone.sh install > ios/build/phone/app-output 2>&1; echo $? > ios/build/phone/app-exit";

export interface PhoneUpdaterDeps {
  dir: string;
  startInstall: () => void;
  now: () => number;
}

export type PhoneStartResult = { ok: true } | { error: string };

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function createPhoneUpdater(deps: PhoneUpdaterDeps) {
  const ios = path.join(deps.dir, "ios");
  const state = path.join(ios, "build", "phone");

  function status(): PhoneUpdateStatusDTO {
    // Local.xcconfig is written once the iPhone app is set up on this Mac.
    const available =
      fs.existsSync(path.join(ios, "scripts", "phone.sh")) &&
      fs.existsSync(path.join(ios, "Config", "Local.xcconfig"));
    const last = Number(read(path.join(state, "last-success"))?.trim());
    const lastInstalled = last ? new Date(last * 1000).toISOString() : null;
    const started = Number(read(path.join(state, "app-started"))?.trim());
    if (!started) return { available, installing: false, failed: null, lastInstalled };
    const exitFile = path.join(state, "app-exit");
    let exitedAt = 0;
    try {
      exitedAt = fs.statSync(exitFile).mtimeMs;
    } catch {}
    if (exitedAt < started) {
      return { available, installing: deps.now() - started < PHONE_TIMEOUT_MS, failed: null, lastInstalled };
    }
    if (Number(read(exitFile)?.trim()) === 0) return { available, installing: false, failed: null, lastInstalled };
    // phone.sh prints one plain line saying why (the details go to its log).
    const lines = (read(path.join(state, "app-output")) ?? "").split("\n").filter((l) => l.trim() !== "");
    return { available, installing: false, failed: lines.at(-1) ?? "The install stopped.", lastInstalled };
  }

  function start(): PhoneStartResult {
    const s = status();
    if (!s.available) return { error: "The iPhone app isn't set up on this Mac." };
    if (s.installing) return { error: "The iPhone is already updating." };
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, "app-started"), `${deps.now()}\n`);
    fs.rmSync(path.join(state, "app-exit"), { force: true });
    deps.startInstall();
    return { ok: true };
  }

  return { status, start };
}
