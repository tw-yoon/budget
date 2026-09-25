import test from "node:test";
import assert from "node:assert/strict";
import { TOLERANCES, detectCardRect, foregroundMask } from "../src/lib/card-crop.ts";

// A synthetic screenshot: a background, with rectangles painted on it.
function screenshot(width, height, bg, rects) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set([...bg, 255], i * 4);
  }
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++)
        rgba.set([...r.color, 255], (y * width + x) * 4);
  }
  return rgba;
}
const BG = [10, 11, 12];
const CARD = [200, 140, 60];

const find = (w, h, rects, bg = BG, tolerance = undefined) => {
  const mask = foregroundMask(screenshot(w, h, bg, rects), w, h, tolerance);
  return mask && detectCardRect(mask, w, h);
};

// A row of the card's width that fades toward the background, the way a drop
// shadow under a card does.
const shadow = (x, y, width, rows, from, to) =>
  Array.from({ length: rows }, (_, i) => ({
    x,
    y: y + i,
    width,
    height: 1,
    color: from.map((c, k) => Math.round(c + ((to[k] - c) * (i + 1)) / (rows + 1))),
  }));

test("a card on a plain background is found exactly", () => {
  const card = { x: 20, y: 60, width: 160, height: 100, color: CARD };
  assert.deepEqual(find(200, 300, [card]), { x: 20, y: 60, width: 160, height: 100 });
});

test("the status bar above the card is left out", () => {
  // A clock and a battery: a few narrow marks across the top.
  const chrome = [
    { x: 8, y: 4, width: 26, height: 10, color: [240, 240, 240] },
    { x: 160, y: 4, width: 22, height: 10, color: [240, 240, 240] },
  ];
  const card = { x: 20, y: 60, width: 160, height: 100, color: CARD };
  assert.deepEqual(find(200, 300, [...chrome, card]), { x: 20, y: 60, width: 160, height: 100 });
});

test("a caption under the card is left out", () => {
  const card = { x: 20, y: 60, width: 160, height: 100, color: CARD };
  // A line of text: wide, but nowhere near filling the row.
  const caption = { x: 40, y: 180, width: 60, height: 8, color: [200, 200, 200] };
  assert.deepEqual(find(200, 300, [card, caption]), { x: 20, y: 60, width: 160, height: 100 });
});

test("the taller of two cards wins when the screenshot has both", () => {
  const small = { x: 20, y: 20, width: 160, height: 30, color: CARD };
  const big = { x: 10, y: 90, width: 180, height: 120, color: [40, 90, 200] };
  assert.deepEqual(find(200, 300, [small, big]), { x: 10, y: 90, width: 180, height: 120 });
});

test("a card bled to both edges is still found", () => {
  const card = { x: 0, y: 40, width: 200, height: 90, color: CARD };
  // The top corners are background, the bottom ones too — only the sides are covered.
  assert.deepEqual(find(200, 300, [card]), { x: 0, y: 40, width: 200, height: 90 });
});

test("a light background works the same as a dark one", () => {
  const light = [246, 246, 248];
  const card = { x: 10, y: 30, width: 180, height: 80, color: [20, 30, 60] };
  assert.deepEqual(find(200, 200, [card], light), { x: 10, y: 30, width: 180, height: 80 });
});

test("an empty screenshot finds nothing", () => {
  assert.equal(find(200, 300, []), null);
});

test("a near-background card is not mistaken for one", () => {
  // Within tolerance of the background: no card, rather than a wrong one.
  const faint = { x: 20, y: 60, width: 160, height: 100, color: [20, 21, 22] };
  assert.equal(find(200, 300, [faint]), null);
});

// ── the corner check ─────────────────────────────────────────────────────

test("corners that disagree refuse rather than guess", () => {
  // An image already cropped to the card: its corners are the card itself, so
  // there is no background to measure and the answer would be meaningless.
  const w = 100, h = 60;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // A gradient, so opposite corners differ well beyond the tolerance.
    const x = i % w;
    rgba.set([20 + Math.round((x / w) * 200), 40, 60, 255], i * 4);
  }
  assert.equal(foregroundMask(rgba, w, h), null);
});

test("a buffer too small for its dimensions is refused", () => {
  assert.equal(foregroundMask(new Uint8ClampedArray(10), 100, 100), null);
  assert.equal(detectCardRect(new Uint8Array(10), 100, 100), null);
});

test("zero dimensions are refused", () => {
  assert.equal(foregroundMask(new Uint8ClampedArray(0), 0, 0), null);
  assert.equal(detectCardRect(new Uint8Array(0), 0, 0), null);
});

// ── soft edges ───────────────────────────────────────────────────────────

test("a drop shadow under the card is kept, not clipped away", () => {
  // The shadow never fills half a row, so the first pass stops above it and
  // the card looks cut off along the bottom.
  const card = { x: 20, y: 60, width: 160, height: 100, color: CARD };
  const cast = shadow(20, 160, 160, 8, [90, 70, 40], BG);
  const box = find(200, 300, [card, ...cast]);
  assert.equal(box.y, 60);
  assert.ok(box.height > 100, `height ${box.height} should reach past the solid rows`);
  assert.ok(box.height <= 108, `height ${box.height} should stop at the shadow`);
});

test("growing over a shadow never reaches the caption below it", () => {
  const card = { x: 20, y: 60, width: 160, height: 100, color: CARD };
  const cast = shadow(20, 160, 160, 6, [90, 70, 40], BG);
  const caption = { x: 40, y: 185, width: 60, height: 8, color: [200, 200, 200] };
  const box = find(200, 300, [card, ...cast, caption]);
  assert.ok(box.y + box.height < 185, `bottom ${box.y + box.height} ran into the caption`);
});

// ── sensitivity ──────────────────────────────────────────────────────────

test("a higher sensitivity finds a card that barely differs from its backdrop", () => {
  // 18 per channel from the background: past the default, inside the high one.
  const faint = { x: 20, y: 60, width: 160, height: 100, color: [28, 29, 30] };
  assert.equal(find(200, 300, [faint]), null);
  assert.deepEqual(find(200, 300, [faint], BG, TOLERANCES.high), {
    x: 20,
    y: 60,
    width: 160,
    height: 100,
  });
});

test("a lower sensitivity ignores a faint backdrop texture", () => {
  const card = { x: 20, y: 60, width: 160, height: 100, color: CARD };
  // A band of noise across the backdrop, well inside the low tolerance.
  const texture = { x: 0, y: 250, width: 200, height: 20, color: [34, 35, 36] };
  assert.deepEqual(find(200, 300, [card, texture], BG, TOLERANCES.low), {
    x: 20,
    y: 60,
    width: 160,
    height: 100,
  });
});

test("the sensitivities are ordered, fussiest first", () => {
  assert.ok(TOLERANCES.high < TOLERANCES.medium);
  assert.ok(TOLERANCES.medium < TOLERANCES.low);
});
