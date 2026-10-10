import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { withServerTiming } from "@/lib/server-timing";
import { createPhoneUpdater, PHONE_COMMAND } from "@/lib/phone-updater";
import { updateEnv } from "@/lib/updater";

const dir = process.cwd();

const phone = createPhoneUpdater({
  dir,
  // detached: a server restart mid-install doesn't take the install down.
  startInstall: () => {
    const child = spawn("/bin/bash", ["-c", PHONE_COMMAND], {
      cwd: dir,
      env: updateEnv(process.env),
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  },
  now: () => Date.now(),
});

async function handleGET() {
  return NextResponse.json(phone.status());
}

export const GET = withServerTiming(handleGET);

export async function POST() {
  try {
    const result = phone.start();
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    console.error("phone update start failed", err);
    return NextResponse.json({ error: "Couldn't start the iPhone update." }, { status: 500 });
  }
}
