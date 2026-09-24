/**
 * Finding the card in a screenshot.
 *
 * A Wallet screenshot is a card sitting on a plain background, with a status
 * bar above it and usually some text below. The card is the one thing wide
 * enough to fill most of the frame, which is what this leans on: the status
 * bar's clock and battery cover a few percent of a row, a caption a little
 * more, and the card covers most of one. So rows are kept only when enough of
 * their width differs from the background, and the longest unbroken run of
 * those rows is the card.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. The same constraint governs `src/lib/pro-mode.ts` and
 * `src/lib/theme.ts`.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A row counts as part of the card when this much of it differs. */
const MIN_ROW_FILL = 0.5;
/** Likewise down the column, within the rows already chosen. */
const MIN_COL_FILL = 0.5;
/** How far a channel may drift from the background and still count as background. */
const DEFAULT_TOLERANCE = 28;

/**
 * Which pixels are not background, as one byte per pixel.
 *
 * The background colour is taken from the four corners: a screenshot has
 * chrome at the top and bottom but its corners are background in every layout
 * Wallet uses. Disagreeing corners mean the guess is unsafe — a card bled to
 * the edge, or a photo rather than a screenshot — and the caller is told so
 * with `null` rather than handed a confident wrong answer.
 */
export function foregroundMask(
  rgba: Uint8ClampedArray | Uint8Array | number[],
  width: number,
  height: number,
  tolerance: number = DEFAULT_TOLERANCE
): Uint8Array | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return null;

  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2]] as const;
  };
  const corners = [
    at(0, 0),
    at(width - 1, 0),
    at(0, height - 1),
    at(width - 1, height - 1),
  ];
  const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, p) => s + p[c], 0) / 4));
  // Every corner has to agree with that average, or the corners are not all
  // background and nothing below can be trusted.
  const agrees = corners.every((p) => p.every((v, c) => Math.abs(v - bg[c]) <= tolerance));
  if (!agrees) return null;

  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
    const off =
      Math.abs(rgba[i] - bg[0]) > tolerance ||
      Math.abs(rgba[i + 1] - bg[1]) > tolerance ||
      Math.abs(rgba[i + 2] - bg[2]) > tolerance;
    mask[p] = off ? 1 : 0;
  }
  return mask;
}

/** The longest unbroken run of true values, as [start, endExclusive]. */
function longestRun(keep: boolean[]): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  for (let i = 0; i <= keep.length; i++) {
    if (i < keep.length && keep[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (!best || i - start > best[1] - best[0]) best = [start, i];
      start = -1;
    }
  }
  return best;
}

/**
 * The card's bounding box within the screenshot, or null when no run of rows
 * looks like one — an empty image, or a crop that is already just the card and
 * so has no background corners to measure against.
 */
export function detectCardRect(
  mask: Uint8Array,
  width: number,
  height: number
): Rect | null {
  if (width <= 0 || height <= 0 || mask.length < width * height) return null;

  const rowKeep: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) n += mask[y * width + x];
    rowKeep.push(n >= width * MIN_ROW_FILL);
  }
  const rows = longestRun(rowKeep);
  if (!rows) return null;
  const [top, bottom] = rows;

  const bandH = bottom - top;
  const colKeep: boolean[] = [];
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = top; y < bottom; y++) n += mask[y * width + x];
    colKeep.push(n >= bandH * MIN_COL_FILL);
  }
  const cols = longestRun(colKeep);
  if (!cols) return null;
  const [left, right] = cols;

  return { x: left, y: top, width: right - left, height: bandH };
}
