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
/**
 * How much of a column must be covered for it to be part of the card.
 *
 * High, and deliberately so. Within the card's own rows a column that is card
 * is covered essentially end to end, while one a few pixels outside catches
 * only the blur of the shadow — so a demanding threshold lands on the edge
 * itself instead of a few pixels into the glow around it. Those few pixels
 * matter twice over: the height is derived from this width, so a box that is
 * loose at the sides is loose along the bottom as well.
 */
const MIN_COL_FILL = 0.85;

/**
 * Columns are judged over the top of the card's rows, not all of them. The
 * lower part is where art fades toward the backdrop and the shadow begins, so
 * including it drags every column's coverage down and lets the threshold above
 * eat into the card.
 */
const COL_PROBE = 0.6;

/**
 * How strong a column must be, against the card's own interior, to be card
 * rather than the glow beside it. A fraction rather than a fixed number: a
 * pale card on a dark backdrop and a dark one on a pale backdrop differ by
 * wildly different amounts, and only the ratio holds across both.
 */
const SIDE_STRENGTH = 0.6;
/** How much of a line must still be covered for the box to grow over it. */
const EDGE_FILL = 0.25;
/** How far a channel may drift from the background and still count as background. */
const DEFAULT_TOLERANCE = 22;

/**
 * 85.60 × 53.98 mm — the ID-1 format every bank card is cut to, and what Wallet
 * draws them at. The bottom edge is derived from it rather than measured.
 */
const CARD_RATIO = 85.6 / 53.98;

/**
 * How far each pixel is from the background, as one byte per pixel.
 *
 * Strength rather than a yes/no, because the two things this has to tell apart
 * — the card and the glow of its shadow — are both "not background". Only the
 * size of the difference separates them.
 *
 * The background colour is taken from the four corners: a screenshot has
 * chrome at the top and bottom but its corners are background in every layout
 * Wallet uses. Disagreeing corners mean the guess is unsafe — a card bled to
 * the edge, or a photo rather than a screenshot — and the caller is told so
 * with `null` rather than handed a confident wrong answer.
 */
export function differenceMap(
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

  const diff = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < diff.length; p++, i += 4) {
    diff[p] = Math.max(
      Math.abs(rgba[i] - bg[0]),
      Math.abs(rgba[i + 1] - bg[1]),
      Math.abs(rgba[i + 2] - bg[2])
    );
  }
  return diff;
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
  diff: Uint8Array,
  width: number,
  height: number,
  tolerance: number = DEFAULT_TOLERANCE
): Rect | null {
  if (width <= 0 || height <= 0 || diff.length < width * height) return null;

  const on = (x: number, y: number) => (diff[y * width + x] > tolerance ? 1 : 0);

  const rowKeep: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) n += on(x, y);
    rowKeep.push(n >= width * MIN_ROW_FILL);
  }
  const rows = longestRun(rowKeep);
  if (!rows) return null;
  const [top, bottom] = rows;

  // Columns are judged over the top of those rows, where the card is solid.
  // Lower down its art fades toward the backdrop and the shadow starts, which
  // drags every measurement there toward the wrong answer.
  const bandH = bottom - top;
  const probeEnd = top + Math.max(1, Math.round(bandH * COL_PROBE));
  const probeH = probeEnd - top;

  const colKeep: boolean[] = [];
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = top; y < probeEnd; y++) n += on(x, y);
    colKeep.push(n >= probeH * MIN_COL_FILL);
  }
  const cols = longestRun(colKeep);
  if (!cols) return null;
  const [left, right] = cols;

  // Now the sides properly. Everything above treats a pixel as on or off, and
  // by that measure a column of the shadow's outer glow looks exactly like a
  // column of card — both are "not background" top to bottom. What separates
  // them is how far from the background they are, so the edges are found by
  // strength: walk out from the middle while a column is still as strong as
  // the card's interior, and stop where it drops off.
  //
  // Those few pixels matter twice, since the height is derived from this
  // width: a box loose at the sides is loose along the bottom too.
  const strength = (x: number) => {
    let sum = 0;
    for (let y = top; y < probeEnd; y++) sum += diff[y * width + x];
    return sum / probeH;
  };
  const inner: number[] = [];
  const quarter = Math.floor((right - left) / 4);
  for (let x = left + quarter; x < right - quarter; x++) inner.push(strength(x));
  inner.sort((a, b) => a - b);
  const reference = inner.length ? inner[Math.floor(inner.length / 2)] : 0;
  const floor = reference * SIDE_STRENGTH;

  const middle = Math.floor((left + right) / 2);
  let x0 = middle;
  while (x0 - 1 >= 0 && strength(x0 - 1) >= floor) x0--;
  let x1 = middle;
  while (x1 + 1 < width && strength(x1 + 1) >= floor) x1++;
  x1 += 1; // exclusive

  const rowFloor = (x1 - x0) * EDGE_FILL;
  const rowCover = (y: number) => {
    let n = 0;
    for (let x = x0; x < x1; x++) n += on(x, y);
    return n;
  };
  // Only the top grows over a soft join; the sides are already tight.
  let y0 = top;
  while (y0 > 0 && rowCover(y0 - 1) >= rowFloor) y0--;

  // The top and the sides are measured; the bottom is not.
  //
  // The bottom is where a card sits over its own drop shadow: the fade never
  // covers half a row, so a strict rule stops short of it and a loose one runs
  // down into it. Either way it is the worst measurement of the four. A bank
  // card is cut to a fixed ratio, which is what Wallet draws and therefore
  // what the screenshot holds, so the height follows from the width exactly.
  const w = x1 - x0;
  const h = Math.min(Math.round(w / CARD_RATIO), height - y0);
  return { x: x0, y: y0, width: w, height: h };
}

/**
 * A crop held as fractions of the picture rather than pixels.
 *
 * Wallet puts the card in the same place on every screenshot from the same
 * phone, so a crop that was right once is right again — but only if it is kept
 * in a form that survives a different screen. Fractions do; pixels do not.
 */
export interface CropFractions {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Back to pixels for a given picture, clamped to it. A remembered crop from a
 * taller screen can reach past the bottom of a shorter one, and a crop is only
 * ever a window onto pixels that exist.
 */
export function fromFractions(f: CropFractions, width: number, height: number): Rect | null {
  if (width <= 0 || height <= 0) return null;
  const x = Math.max(0, Math.min(width - 1, Math.round(f.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(f.y * height)));
  const w = Math.max(1, Math.min(width - x, Math.round(f.width * width)));
  const h = Math.max(1, Math.min(height - y, Math.round(f.height * height)));
  return { x, y, width: w, height: h };
}

/**
 * Where the card sits in a Wallet screenshot, per screen.
 *
 * A screenshot of a given phone puts the card in the same place every time, so
 * the reliable way to cut one out is to know the screen rather than to read the
 * picture. Each preset is matched on the shape of the screenshot and holds its
 * crop as fractions, so one entry covers that phone at any scale — the 603 x
 * 1311 the numbers were taken from and the 1206 x 2622 the phone writes alike.
 */
export interface CropPreset {
  name: string;
  /** width / height of the screenshots this was measured on. */
  aspect: number;
  crop: CropFractions;
}

export const CROP_PRESETS: CropPreset[] = [
  {
    // Measured on an iPhone 16 Pro: the card 543 x 342 at 30, 192.
    name: "iPhone",
    aspect: 603 / 1311,
    crop: { x: 30 / 603, y: 192 / 1311, width: 543 / 603, height: 342 / 1311 },
  },
];

/** How far a picture's shape may be from a preset's and still be that screen. */
const ASPECT_SLACK = 0.02;

/**
 * The preset for a picture, or null when none fits — another phone, or a photo
 * rather than a screenshot, in which case the edges are read instead.
 */
export function presetFor(width: number, height: number): CropPreset | null {
  if (width <= 0 || height <= 0) return null;
  const aspect = width / height;
  return CROP_PRESETS.find((p) => Math.abs(aspect - p.aspect) <= ASPECT_SLACK) ?? null;
}
