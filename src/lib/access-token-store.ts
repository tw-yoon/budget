import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// The server's one access token, in data/access-token (mode 0600, gitignored).
// Created on first read, so a fresh clone, `next dev` and `next start` need no
// setup step. Re-read when the file changes, so a reset takes effect at once.

const VALID = /^[0-9a-f]{64}$/;

export function accessTokenPath(): string {
  return process.env.ACCESS_TOKEN_PATH ?? path.join(process.cwd(), "data", "access-token");
}

export function createAccessTokenStore(file: string) {
  let cache: { mtimeMs: number; size: number; token: string } | null = null;

  function write(token: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
    cache = null;
    return token;
  }

  const fresh = () => randomBytes(32).toString("hex");

  return {
    read(): string {
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
      } catch {
        return write(fresh());
      }
      if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.token;
      const token = fs.readFileSync(file, "utf8").trim();
      if (!VALID.test(token)) return write(fresh());
      cache = { mtimeMs: st.mtimeMs, size: st.size, token };
      return token;
    },
    reset(): string {
      return write(fresh());
    },
  };
}

let shared: ReturnType<typeof createAccessTokenStore> | null = null;

/** The store at accessTokenPath(), made on first use. */
export const accessTokens = {
  read: () => (shared ??= createAccessTokenStore(accessTokenPath())).read(),
  reset: () => (shared ??= createAccessTokenStore(accessTokenPath())).reset(),
};
