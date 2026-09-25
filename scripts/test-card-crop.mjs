import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CROP,
  detectCardRect,
  differenceMap,
  fromFractions,
  isCropFractions,
  matchesDefaultCrop,
  toFractions,
} from "../src/lib/card-crop.ts";

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
  const diff = differenceMap(screenshot(w, h, bg, rects), w, h);
  return diff && detectCardRect(diff, w, h, tolerance);
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
  assert.equal(differenceMap(rgba, w, h), null);
});

test("a buffer too small for its dimensions is refused", () => {
  assert.equal(differenceMap(new Uint8ClampedArray(10), 100, 100), null);
  assert.equal(detectCardRect(new Uint8Array(10), 100, 100), null);
});

test("zero dimensions are refused", () => {
  assert.equal(differenceMap(new Uint8ClampedArray(0), 0, 0), null);
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

// ── tight sides ──────────────────────────────────────────────────────────

test("the glow beside a card is not counted as part of it", () => {
  // A few columns either side, fading out — a blurred drop shadow seen from
  // the left and right. Taking them into the width makes the card wider, and
  // since the height comes from the width, taller as well: a gap under the
  // card's real bottom edge.
  const w = 160;
  const card = { x: 20, y: 60, width: w, height: cardHeight(w), color: CARD };
  const glow = [];
  for (let i = 1; i <= 5; i++) {
    const fade = [90, 70, 40].map((c, k) => Math.round(c + ((BG[k] - c) * i) / 6));
    glow.push({ x: 20 - i, y: 64, width: 1, height: cardHeight(w), color: fade });
    glow.push({ x: 20 + w - 1 + i, y: 64, width: 1, height: cardHeight(w), color: fade });
  }
  assert.deepEqual(find(200, 300, [...glow, card]), {
    x: 20,
    y: 60,
    width: w,
    height: cardHeight(w),
  });
});

test("art that fades down the card does not pull the sides inward", () => {
  // Columns are judged over the top of the card, where it is solid, so a lower
  // half that dims toward the backdrop cannot narrow the box.
  const w = 180;
  const h = cardHeight(w);
  const rows = Array.from({ length: h }, (_, i) => ({
    x: 15,
    y: 50 + i,
    width: w,
    height: 1,
    // Solid at the top, close to the background by the bottom.
    color: [200, 140, 60].map((c, k) => Math.round(c + ((BG[k] - c) * i) / (h - 1))),
  }));
  assert.deepEqual(find(200, 300, rows), { x: 15, y: 50, width: w, height: h });
});

// ── a remembered crop ────────────────────────────────────────────────────

test("a crop survives the round trip through fractions", () => {
  const rect = { x: 24, y: 150, width: 342, height: 216 };
  const f = toFractions(rect, 390, 844);
  assert.deepEqual(fromFractions(f, 390, 844), rect);
});

test("the same crop lands proportionally on a bigger screen", () => {
  // The same Wallet layout photographed at 3x rather than 2x.
  const f = toFractions({ x: 24, y: 150, width: 342, height: 216 }, 390, 844);
  assert.deepEqual(fromFractions(f, 780, 1688), { x: 48, y: 300, width: 684, height: 432 });
});

test("a crop reaching past a shorter picture is clamped to it", () => {
  const f = toFractions({ x: 10, y: 700, width: 300, height: 130 }, 390, 844);
  const rect = fromFractions(f, 390, 500);
  assert.ok(rect.y + rect.height <= 500, `${rect.y}+${rect.height} ran off the bottom`);
  assert.ok(rect.x + rect.width <= 390);
});

test("zero dimensions have no fractions", () => {
  assert.equal(toFractions({ x: 0, y: 0, width: 1, height: 1 }, 0, 0), null);
  assert.equal(fromFractions({ x: 0, y: 0, width: 1, height: 1 }, 0, 0), null);
});

test("only a sane stored crop is trusted", () => {
  assert.ok(isCropFractions({ x: 0.1, y: 0.2, width: 0.8, height: 0.3 }));
  assert.ok(isCropFractions({ x: 0, y: 0, width: 1, height: 1 }));
  for (const junk of [
    null, undefined, 42, "crop", [],
    { x: 0, y: 0, width: 0, height: 0.5 },      // nothing to crop
    { x: -0.1, y: 0, width: 0.5, height: 0.5 }, // off the picture
    { x: 0, y: 0, width: 1.5, height: 0.5 },    // wider than the picture
    { x: 0, y: 0, width: 0.5 },                 // half a rectangle
    { x: NaN, y: 0, width: 0.5, height: 0.5 },
  ])
    assert.equal(isCropFractions(junk), false, JSON.stringify(junk));
});

// ── the built-in starting crop ───────────────────────────────────────────

test("the built-in crop is a card, and fits the screen it was measured on", () => {
  const [W, H] = [603, 1311];
  const box = fromFractions(DEFAULT_CROP, W, H);
  assert.deepEqual(box, { x: 30, y: 192, width: 543, height: 342 });
  assert.ok(box.x + box.width <= W, "runs off the side");
  assert.ok(box.y + box.height <= H, "runs off the bottom");
  // 85.60 x 53.98 mm, within a pixel of rounding.
  assert.ok(Math.abs(box.width / box.height - 85.6 / 53.98) < 0.01);
});

test("the same crop lands on the full-resolution screenshot", () => {
  // The measurements were taken at half scale; the phone writes 1206 x 2622.
  const box = fromFractions(DEFAULT_CROP, 1206, 2622);
  assert.deepEqual(box, { x: 60, y: 384, width: 1086, height: 684 });
});

test("it applies to that screen at any scale, and not to others", () => {
  assert.ok(matchesDefaultCrop(603, 1311));
  assert.ok(matchesDefaultCrop(1206, 2622));
  assert.ok(matchesDefaultCrop(1179, 2556)); // a near-enough iPhone
  assert.ok(!matchesDefaultCrop(1024, 768)); // a landscape screen
  assert.ok(!matchesDefaultCrop(1000, 1000)); // a square photo
  assert.ok(!matchesDefaultCrop(0, 0));
});
