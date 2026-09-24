import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";

/**
 * The key-value file behind /api/ui-state. Each write keeps the previous
 * version of the file as <file>.bak.
 */
export function createUiStateStore(file: string) {
  // put is a read-modify-write, so two that overlap would both read the same
  // baseline and the later write would drop the earlier one's key — and both
  // would build the same temp file, leaving one rename to fail with ENOENT.
  // Neither was reachable while every write came from a user changing one
  // setting at a time; a page that restores a preference per card sends a
  // handful at once. One server is one Node process, so chaining the writes
  // here is enough to make each see the previous one's result.
  let writes: Promise<unknown> = Promise.resolve();

  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = writes.then(work, work);
    // The chain has to survive a failed link, or one 500 wedges every later write.
    writes = run.catch(() => {});
    return run;
  }

  async function readAll(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return {}; // missing (first run) or unreadable — start empty
    }
  }

  async function put(key: string, value: unknown): Promise<void> {
    await serialized(async () => {
      const all = await readAll();
      all[key] = value ?? null;
      await fs.mkdir(path.dirname(file), { recursive: true });
      try {
        await fs.copyFile(file, file + ".bak");
      } catch {
        /* first write — nothing to back up */
      }
      // Unique per write: a shared name is still a collision if this ever runs
      // in more than one process against the same data dir.
      const tmp = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify(all, null, 2));
        await fs.rename(tmp, file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
    });
  }

  return { readAll, put };
}
