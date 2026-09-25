import test from "node:test";
import assert from "node:assert/strict";
import { detectCardRect, foregroundMask } from "../src/lib/card-crop.ts";

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
// 85.60 x 53.98 mm. A drawn card uses it so the measured and derived heights
// agree; where they must not, the test says so.
const RATIO = 85.6 / 53.98;
const cardHeight = (width) => Math.round(width / RATIO);

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
  const card = { x: 20, y: 60, width: 160, height: cardHeight(160), color: CARD };
  assert.deepEqual(find(200, 300, [card]), { x: 20, y: 60, width: 160, height: cardHeight(160) });
});

test("the status bar above the card is left out", () => {
  // A clock and a battery: a few narrow marks across the top.
  const chrome = [
    { x: 8, y: 4, width: 26, height: 10, color: [240, 240, 240] },
    { x: 160, y: 4, width: 22, height: 10, color: [240, 240, 240] },
  ];
  const card = { x: 20, y: 60, width: 160, height: cardHeight(160), color: CARD };
  assert.deepEqual(find(200, 300, [...chrome, card]), { x: 20, y: 60, width: 160, height: cardHeight(160) });
});

test("a caption under the card is left out", () => {
  const card = { x: 20, y: 60, width: 160, height: cardHeight(160), color: CARD };
  // A line of text: wide, but nowhere near filling the row.
  const caption = { x: 40, y: 200, width: 60, height: 8, color: [200, 200, 200] };
  assert.deepEqual(find(200, 300, [card, caption]), { x: 20, y: 60, width: 160, height: cardHeight(160) });
});

test("the taller of two cards wins when the screenshot has both", () => {
  const small = { x: 20, y: 20, width: 160, height: 30, color: CARD };
  const big = { x: 10, y: 90, width: 180, height: cardHeight(180), color: [40, 90, 200] };
  assert.deepEqual(find(200, 300, [small, big]), { x: 10, y: 90, width: 180, height: cardHeight(180) });
});

test("a card bled to both edges is still found", () => {
  const card = { x: 0, y: 40, width: 200, height: cardHeight(200), color: CARD };
  // The top corners are background, the bottom ones too — only the sides are covered.
  assert.deepEqual(find(200, 300, [card]), { x: 0, y: 40, width: 200, height: cardHeight(200) });
});

test("a light background works the same as a dark one", () => {
  const light = [246, 246, 248];
  const card = { x: 10, y: 30, width: 180, height: cardHeight(180), color: [20, 30, 60] };
  assert.deepEqual(find(200, 200, [card], light), { x: 10, y: 30, width: 180, height: cardHeight(180) });
});

test("an empty screenshot finds nothing", () => {
  assert.equal(find(200, 300, []), null);
});

test("a near-background card is not mistaken for one", () => {
  // Within tolerance of the background: no card, rather than a wrong one.
  const faint = { x: 20, y: 60, width: 160, height: cardHeight(160), color: [20, 21, 22] };
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

// ── the derived bottom ──────────────────────────────────────────────────

test("the bottom comes from the card's proportions, not from the pixels", () => {
  // Drawn far too tall. The top and the sides are measured; the height is
  // whatever those proportions say, so the extra is not kept.
  const tall = { x: 20, y: 60, width: 160, height: 190, color: CARD };
  const box = find(200, 300, [tall]);
  assert.equal(box.y, 60);
  assert.equal(box.width, 160);
  assert.equal(box.height, cardHeight(160));
});

test("a drop shadow under the card changes nothing", () => {
  // The fade below the card is exactly what the measured bottom used to get
  // wrong, in both directions.
  const card = { x: 20, y: 60, width: 160, height: cardHeight(160), color: CARD };
  const cast = shadow(20, 60 + cardHeight(160), 160, 10, [90, 70, 40], BG);
  assert.deepEqual(find(200, 300, [card, ...cast]), {
    x: 20,
    y: 60,
    width: 160,
    height: cardHeight(160),
  });
});

test("a card too near the foot of the frame is cut at the frame", () => {
  // Nothing invents pixels that were never in the screenshot.
  const card = { x: 20, y: 250, width: 160, height: 40, color: CARD };
  const box = find(200, 300, [card]);
  assert.equal(box.y, 250);
  assert.equal(box.y + box.height, 300);
});

test("a wider card is proportionally taller", () => {
  // Each card fills most of its own frame — see the next test for why.
  const narrow = find(200, 400, [{ x: 20, y: 40, width: 120, height: cardHeight(120), color: CARD }]);
  const wide = find(400, 400, [{ x: 20, y: 40, width: 300, height: cardHeight(300), color: CARD }]);
  assert.equal(narrow.height, cardHeight(120));
  assert.equal(wide.height, cardHeight(300));
  assert.ok(wide.height > narrow.height);
});

test("a card filling less than half the frame's width is not found", () => {
  // The known limit of reading rows: the card has to be the wide thing in the
  // picture. A screenshot with the card off to one side falls back to keeping
  // the whole image, which the preview says.
  const small = { x: 10, y: 40, width: 120, height: cardHeight(120), color: CARD };
  assert.equal(find(400, 400, [small]), null);
});
