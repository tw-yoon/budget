import { promises as fs } from "fs";
import path from "path";

/**
 * Where a card's image lives: data/card-art, beside the other files the app
 * writes for itself. Relative to the app folder, like every other path here,
 * so nothing is left behind elsewhere on the machine when this folder moves.
 */
const DIR = path.join(process.cwd(), "data", "card-art");

/** Only PNG: the browser re-encodes whatever was picked before uploading. */
const EXT = ".png";

/**
 * The file name for a card. Derived from the card's id rather than taken from
 * the upload, so a request cannot name a path of its own — the id comes from
 * the database, and "<id>.png" has no separators to escape the directory with.
 */
export function artFileFor(cardId: string): string {
  return `${cardId}${EXT}`;
}

/**
 * Resolve a stored name to a path inside the directory, or null. Rejects
 * anything that escapes it even though names are generated, not supplied:
 * the check costs nothing and the file is served to the browser.
 */
export function artPathFor(name: string): string | null {
  if (!name.endsWith(EXT)) return null;
  const full = path.join(DIR, path.basename(name));
  const inside = path.relative(DIR, full);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return full;
}

export async function saveArt(cardId: string, bytes: Buffer): Promise<string> {
  await fs.mkdir(DIR, { recursive: true });
  const name = artFileFor(cardId);
  // Write beside and rename, so a failed write cannot leave a card pointing at
  // half an image.
  const tmp = path.join(DIR, `${name}.tmp`);
  try {
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, path.join(DIR, name));
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return name;
}

export async function deleteArt(name: string): Promise<void> {
  const full = artPathFor(name);
  if (full) await fs.rm(full, { force: true });
}

export async function readArt(name: string): Promise<Buffer | null> {
  const full = artPathFor(name);
  if (!full) return null;
  try {
    return await fs.readFile(full);
  } catch {
    return null; // deleted underneath us, or never written
  }
}
