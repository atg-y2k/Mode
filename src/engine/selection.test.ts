import { describe, expect, it } from 'vitest';
import { rgbToLab } from './color';
import { createMask, isMaskEmpty, maskCoverage } from './mask';
import { computeLabImage, magicWand, sampleLab, sampleLabSimilar, smartBrushStamp, smartBrushStroke } from './selection';
import { createImageDataLike, type ImageDataLike, type Mask, type RGB } from './types';

const RED: RGB = { r: 200, g: 40, b: 40 };
const BLUE: RGB = { r: 40, g: 60, b: 200 };

function setPx(img: ImageDataLike, x: number, y: number, c: RGB) {
  const p = (y * img.width + x) * 4;
  img.data[p] = c.r;
  img.data[p + 1] = c.g;
  img.data[p + 2] = c.b;
}

/** Left half `a`, right half `b`. */
function twoColor(w: number, h: number, a: RGB, b: RGB): ImageDataLike {
  const img = createImageDataLike(w, h, a);
  for (let y = 0; y < h; y++) for (let x = w / 2; x < w; x++) setPx(img, x, y, b);
  return img;
}

const at = (m: Mask, x: number, y: number) => m.data[y * m.width + x];

describe('computeLabImage', () => {
  it('stores L, a, b per pixel', () => {
    const img = twoColor(4, 2, RED, BLUE);
    const lab = computeLabImage(img);
    expect(lab.width).toBe(4);
    expect(lab.height).toBe(2);
    expect(lab.data.length).toBe(24);
    const red = rgbToLab(RED);
    const blue = rgbToLab(BLUE);
    expect(lab.data[0]).toBeCloseTo(red.l, 2);
    expect(lab.data[1]).toBeCloseTo(red.a, 2);
    expect(lab.data[2]).toBeCloseTo(red.b, 2);
    const o = (1 * 4 + 3) * 3;
    expect(lab.data[o]).toBeCloseTo(blue.l, 2);
    expect(lab.data[o + 2]).toBeCloseTo(blue.b, 2);
    expect(computeLabImage(createImageDataLike(0, 0)).data.length).toBe(0);
  });

  it('sampleLab averages a clipped window', () => {
    const lab = computeLabImage(twoColor(4, 4, RED, BLUE));
    const s = sampleLab(lab, 0, 0, 1); // 2×2 window of red
    expect(s.l).toBeCloseTo(rgbToLab(RED).l, 2);
    const mixed = sampleLab(lab, 2, 1, 1); // columns 1..3 → 1 red + 2 blue
    expect(mixed.l).toBeCloseTo((rgbToLab(RED).l + 2 * rgbToLab(BLUE).l) / 3, 2);
    // edge-aware variant ignores the other side of the edge
    const similar = sampleLabSimilar(lab, 1, 1, 1, 8);
    expect(similar.l).toBeCloseTo(rgbToLab(RED).l, 2);
  });
});

describe('magicWand', () => {
  it('selects exactly one half of a two-color image', () => {
    const img = twoColor(40, 20, RED, BLUE);
    const lab = computeLabImage(img);
    const m = magicWand(lab, { x: 5, y: 5 }, { tolerance: 10, contiguous: true });
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 40; x++) expect(at(m, x, y)).toBe(x < 20 ? 255 : 0);
    }
    const g = magicWand(lab, { x: 35, y: 12 }, { tolerance: 10, contiguous: false });
    expect(maskCoverage(g)).toBe(400);
    expect(at(g, 30, 0)).toBe(255);
    expect(at(g, 10, 0)).toBe(0);
  });

  it('contiguous fill stops at barriers; global mode selects all similar pixels', () => {
    // red | blue stripe | red, plus a concave red "U" to exercise the scanline fill
    const img = createImageDataLike(30, 30, RED);
    for (let y = 0; y < 30; y++) for (let x = 14; x < 16; x++) setPx(img, x, y, BLUE);
    for (let y = 5; y < 25; y++) for (let x = 4; x < 10; x++) if (!(x >= 6 && x < 8 && y < 20)) setPx(img, x, y, BLUE);
    const lab = computeLabImage(img);
    const c = magicWand(lab, { x: 1, y: 1 }, { tolerance: 8, contiguous: true });
    expect(at(c, 0, 29)).toBe(255);
    expect(at(c, 6, 10)).toBe(255); // inside the U, reached around the blue walls
    expect(at(c, 20, 10)).toBe(0); // across the stripe
    expect(at(c, 14, 10)).toBe(0);
    const red = 30 * 30 - 60 - (6 * 20 - 2 * 15);
    expect(maskCoverage(c)).toBe(red - 14 * 30); // left part only (columns 16..29 are the right part)
    const g = magicWand(lab, { x: 1, y: 1 }, { tolerance: 8, contiguous: false });
    expect(maskCoverage(g)).toBe(red);
  });

  it('always includes the seed pixel, even when it is an outlier', () => {
    const img = createImageDataLike(9, 9, { r: 128, g: 128, b: 128 });
    setPx(img, 4, 4, { r: 255, g: 0, b: 0 });
    const lab = computeLabImage(img);
    const m = magicWand(lab, { x: 4.5, y: 4.5 }, { tolerance: 2, contiguous: true, sampleRadius: 0 });
    expect(at(m, 4, 4)).toBe(255);
    expect(maskCoverage(m)).toBe(1);
    // with the default sample window the seed color is the gray average -> gray is selected, red pinhole filled
    const m2 = magicWand(lab, { x: 4, y: 4 }, { tolerance: 8, contiguous: true });
    expect(at(m2, 0, 0)).toBe(255);
    expect(at(m2, 4, 4)).toBe(255);
  });

  it('returns an empty mask for seeds outside the image', () => {
    const lab = computeLabImage(twoColor(10, 10, RED, BLUE));
    for (const seed of [{ x: -1, y: 2 }, { x: 10, y: 2 }, { x: 3, y: 10.2 }, { x: NaN, y: 1 }]) {
      const m = magicWand(lab, seed, { tolerance: 50, contiguous: true });
      expect(m.width).toBe(10);
      expect(isMaskEmpty(m)).toBe(true);
    }
    const empty = magicWand(computeLabImage(createImageDataLike(0, 0)), { x: 0, y: 0 }, { tolerance: 5, contiguous: false });
    expect(empty.data.length).toBe(0);
  });

  it('gives blended edge pixels partial coverage (1px anti-aliased edge)', () => {
    const W = 20;
    const img = twoColor(W, 6, RED, BLUE);
    // column 10 is a 50/50 blend (an anti-aliased edge in the photo)
    for (let y = 0; y < 6; y++) setPx(img, 10, y, { r: 120, g: 50, b: 120 });
    const m = magicWand(computeLabImage(img), { x: 2, y: 2 }, { tolerance: 10, contiguous: true });
    expect(at(m, 9, 3)).toBe(255);
    expect(at(m, 10, 3)).toBeGreaterThan(70);
    expect(at(m, 10, 3)).toBeLessThan(190);
    expect(at(m, 11, 3)).toBe(0);
  });

  it('does not bleed onto a different object next to the selection', () => {
    const img = twoColor(20, 6, RED, BLUE);
    for (let y = 0; y < 6; y++) setPx(img, 10, y, { r: 30, g: 160, b: 40 }); // green strip: not a red/blue mix
    const m = magicWand(computeLabImage(img), { x: 2, y: 2 }, { tolerance: 10, contiguous: true });
    expect(at(m, 9, 3)).toBe(255);
    expect(at(m, 10, 3)).toBe(0);
  });

  it('handles large images quickly', () => {
    const W = 1600;
    const H = 1600;
    const img = createImageDataLike(W, H);
    let s = 1;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const n = (s >>> 24) % 9;
      const y = Math.floor(i / W);
      const v = y < H * 0.7 ? 170 + n : 90 + n;
      img.data[p] = v;
      img.data[p + 1] = v - 4;
      img.data[p + 2] = v - 10;
    }
    const lab = computeLabImage(img);
    magicWand(lab, { x: 10, y: 10 }, { tolerance: 12, contiguous: true }); // warm up
    const t0 = performance.now();
    const m = magicWand(lab, { x: 800, y: 300 }, { tolerance: 12, contiguous: true });
    const ms = performance.now() - t0;
    expect(maskCoverage(m)).toBeGreaterThan(W * H * 0.69);
    expect(maskCoverage(m)).toBeLessThan(W * H * 0.71);
    // Spec target is ~150 ms; generous bound so loaded CI machines don't flake.
    expect(ms).toBeLessThan(1500);
  });
});

describe('smart brush', () => {
  const opts = { radius: 6, hardness: 1, mode: 'add' as const, tolerance: 15 };

  it('only paints pixels similar to the color under the cursor', () => {
    const img = twoColor(40, 20, RED, BLUE);
    const lab = computeLabImage(img);
    const m = createMask(40, 20);
    const ref = smartBrushStamp(lab, m, 19, 10, opts); // on the red side, brush overlaps blue
    expect(ref.l).toBeCloseTo(rgbToLab(RED).l, 1);
    expect(at(m, 17, 10)).toBe(255);
    expect(at(m, 19, 10)).toBe(255);
    expect(at(m, 21, 10)).toBe(0);
    expect(at(m, 23, 10)).toBe(0);
  });

  it('keeps the stroke reference constant and covers the segment', () => {
    const img = twoColor(60, 20, RED, BLUE);
    const lab = computeLabImage(img);
    const m = createMask(60, 20);
    const ref = smartBrushStamp(lab, m, 5, 10, opts);
    smartBrushStroke(lab, m, { x: 5, y: 10 }, { x: 55, y: 10 }, opts, ref); // crosses into blue
    for (let x = 0; x < 30; x++) expect(at(m, x, 10)).toBe(255);
    for (let x = 30; x < 60; x++) expect(at(m, x, 10)).toBe(0);
    const before = new Uint8Array(m.data);
    smartBrushStroke(lab, m, { x: 50, y: 10 }, { x: 50, y: 10 }, opts, ref); // zero length
    expect(m.data).toEqual(before);
  });

  it('ramps coverage down over the last 25% of the tolerance', () => {
    // Pixels at increasing ΔE from the reference gray.
    const img = createImageDataLike(5, 1, { r: 128, g: 128, b: 128 });
    const ref = rgbToLab({ r: 128, g: 128, b: 128 });
    const lab = computeLabImage(img);
    // Override Lab directly for precise distances: 0, 0.7T, 0.8T, 0.9T, 1.1T along +L
    const T = 20;
    [0, 0.7, 0.8, 0.9, 1.1].forEach((f, i) => (lab.data[i * 3] = ref.l + f * T));
    const m = createMask(5, 1);
    smartBrushStroke(lab, m, { x: 0, y: 0.5 }, { x: 5, y: 0.5 }, { radius: 3, hardness: 1, mode: 'add', tolerance: T }, ref);
    expect(m.data[0]).toBe(255);
    expect(m.data[1]).toBe(255);
    expect(m.data[2]).toBeGreaterThan(160);
    expect(m.data[2]).toBeLessThan(215);
    expect(m.data[3]).toBeGreaterThan(80);
    expect(m.data[3]).toBeLessThan(130);
    expect(m.data[4]).toBe(0);
  });

  it('erases only similar pixels and tolerates out-of-bounds input', () => {
    const img = twoColor(40, 20, RED, BLUE);
    const lab = computeLabImage(img);
    const m = createMask(40, 20);
    m.data.fill(255);
    smartBrushStamp(lab, m, 22, 10, { ...opts, mode: 'erase' }); // blue reference
    expect(at(m, 22, 10)).toBe(0);
    expect(at(m, 18, 10)).toBe(255);
    // outside the image: reference clamps to the nearest pixel, nothing breaks
    const m2 = createMask(40, 20);
    const ref = smartBrushStamp(lab, m2, -3, 10, opts);
    expect(ref.l).toBeCloseTo(rgbToLab(RED).l, 1);
    expect(at(m2, 0, 10)).toBe(255);
    const r3 = smartBrushStamp(lab, createMask(40, 20), NaN, 5, opts);
    expect(Number.isFinite(r3.l)).toBe(true);
  });
});
