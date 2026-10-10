import { execFile, spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { withServerTiming } from "@/lib/server-timing";
import { createUpdater, UPDATE_COMMAND, updateEnv } from "@/lib/updater";

// The server runs from the Budget folder (Budget.command starts it there).
const dir = process.cwd();

const updater = createUpdater({
  dir,
  runStatus: () =>
    new Promise((resolve, reject) =>
      execFile("./Budget.command", ["--update-status"], { cwd: dir, timeout: 30_000 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout)
      )
    ),
  // detached: its own process group, so stopping the server (or launchd
  // ending the start-at-login job) doesn't take the update down with it.
  // updateEnv: not this server's NODE_ENV=production and Next's own variables.
  startUpdate: () => {
    const child = spawn("/bin/bash", ["-c", UPDATE_COMMAND], {
      cwd: dir,
      env: updateEnv(process.env),
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  },
  now: () => Date.now(),
});

async function handleGET(req: NextRequest) {
  try {
    const check = new URL(req.url).searchParams.get("check") === "1";
    return NextResponse.json(await updater.status(check));
  } catch (err) {
    console.error("update status failed", err);
    return NextResponse.json({ error: "Couldn't check for updates." }, { status: 500 });
  }
}

export const GET = withServerTiming(handleGET);

export async function POST() {
  try {
    const result = await updater.start();
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    console.error("update start failed", err);
    return NextResponse.json({ error: "Couldn't start the update." }, { status: 500 });
  }
}
