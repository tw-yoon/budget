import fs from "node:fs";
import path from "node:path";
import type { UpdateStatusDTO } from "@/types";

// Updating from the app (docs/superpowers/specs/2026-10-06-self-update-design.md).
// Budget.command stays the one place that knows how to update: this reads its
// --update-status line and starts its --update, detached, so the update
// outlives the server it stops. Process calls are injected for the tests.

export const STATUS_TTL_MS = 60 * 60 * 1000;
export const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;
export const UPDATE_COMMAND =
  "./Budget.command --update --no-open > .update.log 2>&1; echo $? > .update-exit";

export interface LauncherStatus {
  version: string;
  latest: string | null;
  behind: number;
  blocker: string;
}

export interface UpdaterDeps {
  dir: string;
  runStatus: () => Promise<string>;
  startUpdate: () => void;
  now: () => number;
}

export type StartResult = { ok: true } | { error: string };

/**
 * The environment the app-started update runs in. `next start` set NODE_ENV to
 * production, which makes the update's `npm install` drop devDependencies (and
 * the build then fails with the server already stopped); __NEXT_PROCESSED_ENV
 * would make the new build and server skip the .env files; PORT, NEXT_* and
 * npm_* belong to this server's own `npm run start`.
 */
export function updateEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "NODE_ENV" || k === "PORT" || /^(NEXT_|__NEXT_|npm_)/.test(k)) continue;
    out[k] = v;
  }
  // Next types NODE_ENV as always set; leaving it out is the point.
  return out as NodeJS.ProcessEnv;
}

/** The last line of `--update-status`'s output; throws when it isn't the JSON. */
export function parseLauncherStatus(out: string): LauncherStatus {
  const last = out.trim().split("\n").pop() ?? "";
  const v = JSON.parse(last);
  if (typeof v?.version !== "string" || typeof v?.blocker !== "string") {
    throw new Error("Unexpected --update-status output");
  }
  return { version: v.version, latest: v.latest ?? null, behind: Number(v.behind) || 0, blocker: v.blocker };
}

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** What the state files say about the last update started from the app. */
export function readUpdateState(dir: string, now: number): { updating: boolean; failed: string | null } {
  const started = Number(read(path.join(dir, ".update-started"))?.trim());
  if (!started) return { updating: false, failed: null };
  const exitFile = path.join(dir, ".update-exit");
  let exitedAt = 0;
  try {
    exitedAt = fs.statSync(exitFile).mtimeMs;
  } catch {}
  const ended = exitedAt >= started;
  if (!ended) return { updating: now - started < UPDATE_TIMEOUT_MS, failed: null };
  const code = Number(read(exitFile)?.trim());
  if (code === 0) return { updating: false, failed: null };
  const lines = (read(path.join(dir, ".update.log")) ?? "").split("\n").filter((l) => l.trim() !== "");
  return { updating: false, failed: lines.slice(-5).join("\n") || "The update stopped." };
}

export function createUpdater(deps: UpdaterDeps) {
  let cached: { status: LauncherStatus; at: number } | null = null;

  async function launcher(check: boolean): Promise<{ status: LauncherStatus; at: number }> {
    if (!check && cached && deps.now() - cached.at < STATUS_TTL_MS) return cached;
    cached = { status: parseLauncherStatus(await deps.runStatus()), at: deps.now() };
    return cached;
  }

  async function status(check = false): Promise<UpdateStatusDTO> {
    const state = readUpdateState(deps.dir, deps.now());
    // While an update runs, --update-status's `git fetch` would race the
    // update's `git pull` for the same refs and fail it. start() always
    // fills the cache first; a server started after the update has no cache,
    // and by then the pull is done.
    const { status: s, at } = state.updating && cached ? cached : await launcher(check);
    return {
      version: s.version,
      latest: s.latest,
      available: s.blocker === "" && s.behind > 0,
      canUpdate: s.blocker === "",
      updating: state.updating,
      failed: state.updating ? null : state.failed,
      checkedAt: new Date(at).toISOString(),
    };
  }

  async function start(): Promise<StartResult> {
    const s = await status();
    if (!s.canUpdate) return { error: "This copy is updated from its repository, not from here." };
    if (s.updating) return { error: "An update is already running." };
    if (!s.available) return { error: "Budget is already up to date." };
    fs.writeFileSync(path.join(deps.dir, ".update-started"), `${deps.now()}\n`);
    fs.rmSync(path.join(deps.dir, ".update-exit"), { force: true });
    deps.startUpdate();
    return { ok: true };
  }

  return { status, start };
}
