import { describe, expect, it } from 'vitest';
import { createImageDataLike, type ImageDataLike, type RGB } from '../engine/types';
import { hasTransparency, removeBackground, trimTransparent } from './backgroundRemoval';

/** Deterministic PRNG so the "camera noise" is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(img: ImageDataLike, inside: (x: number, y: number) => boolean, c: RGB) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!inside(x, y)) continue;
      const p = (y * img.width + x) * 4;
      img.data[p] = c.r;
      img.data[p + 1] = c.g;
      img.data[p + 2] = c.b;
    }
  }
}

function addNoise(img: ImageDataLike, amount: number, seed = 1) {
  const r = rng(seed);
  for (let p = 0; p < img.data.length; p += 4) {
    for (let c = 0; c < 3; c++) img.data[p + c] += (r() - 0.5) * 2 * amount;
  }
}

const alphaAt = (img: ImageDataLike, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
const rgbAt = (img: ImageDataLike, x: number, y: number) => {
  const p = (y * img.width + x) * 4;
  return [img.data[p], img.data[p + 1], img.data[p + 2]];
};
const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

describe('removeBackground', () => {
  it('cuts an object out of a noisy plain background', () => {
    const img = createImageDataLike(120, 100, { r: 244, g: 242, b: 238 });
    paint(img, circle(60, 50, 30), { r: 180, g: 40, b: 40 });
    addNoise(img, 5);
    const out = removeBackground(img);
    expect(out).not.toBe(img);
    expect(out.data).not.toBe(img.data);
    expect(alphaAt(img, 0, 0)).toBe(255); // input untouched
    for (const [x, y] of [[0, 0], [119, 99], [10, 50], [60, 5], [100, 90]]) expect(alphaAt(out, x, y)).toBe(0);
    for (const [x, y] of [[60, 50], [45, 50], [60, 30], [75, 65]]) expect(alphaAt(out, x, y)).toBe(255);
    // Interior colors are not altered.
    expect(rgbAt(out, 60, 50)).toEqual(rgbAt(img, 60, 50));
    // Coverage close to the true circle area.
    let opaque = 0;
    for (let p = 3; p < out.data.length; p += 4) opaque += out.data[p] / 255;
    expect(opaque).toBeGreaterThan(Math.PI * 30 * 30 * 0.92);
    expect(opaque).toBeLessThan(Math.PI * 30 * 30 * 1.03);
  });

  it('feathers the edge inward without a background halo', () => {
    const img = createImageDataLike(80, 80, { r: 255, g: 255, b: 255 });
    paint(img, (x, y) => x >= 20 && x < 60 && y >= 20 && y < 60, { r: 30, g: 90, b: 40 });
    const out = removeBackground(img, { feather: 2 });
    // Just outside the square: fully transparent.
    expect(alphaAt(out, 19, 40)).toBe(0);
    // On the rim: partially transparent; deep inside: opaque.
    expect(alphaAt(out, 20, 40)).toBeGreaterThan(0);
    expect(alphaAt(out, 20, 40)).toBeLessThan(255);
    expect(alphaAt(out, 40, 40)).toBe(255);
    // Edge colors are decontaminated (not lightened toward the white background).
    const [r, g, b] = rgbAt(out, 20, 40);
    expect(Math.abs(r - 30) + Math.abs(g - 90) + Math.abs(b - 40)).toBeLessThan(30);
    const hard = removeBackground(img, { feather: 0 });
    expect(alphaAt(hard, 21, 40)).toBe(255);
  });

  it('un-mixes anti-aliased edge pixels (alpha from the mix, color from the object)', () => {
    const img = createImageDataLike(80, 80, { r: 255, g: 255, b: 255 });
    paint(img, (x, y) => x >= 20 && x < 60 && y >= 20 && y < 60, { r: 30, g: 90, b: 40 });
    // Column 19: half object, half white.
    paint(img, (x, y) => x === 19 && y >= 20 && y < 60, { r: 143, g: 173, b: 148 });
    const out = removeBackground(img, { feather: 0 });
    expect(alphaAt(out, 19, 40)).toBeGreaterThan(110);
    expect(alphaAt(out, 19, 40)).toBeLessThan(145);
    const [r, g, b] = rgbAt(out, 19, 40);
    expect(Math.abs(r - 30) + Math.abs(g - 90) + Math.abs(b - 40)).toBeLessThan(12);
    expect(alphaAt(out, 18, 40)).toBe(0);
  });

  it('follows smooth gradients such as a sky', () => {
    const img = createImageDataLike(100, 120);
    for (let y = 0; y < 120; y++) paint(img, (_x, yy) => yy === y, { r: 120 + y * 0.8, g: 170 + y * 0.6, b: 235 - y * 0.3 });
    paint(img, circle(50, 60, 22), { r: 60, g: 110, b: 50 });
    addNoise(img, 3, 7);
    const out = removeBackground(img);
    for (const [x, y] of [[50, 2], [50, 117], [5, 60], [95, 60], [20, 100]]) expect(alphaAt(out, x, y)).toBe(0);
    expect(alphaAt(out, 50, 60)).toBe(255);
  });

  it('removes enclosed background holes but keeps small light details', () => {
    const img = createImageDataLike(120, 120, { r: 250, g: 250, b: 250 });
    const ring = (x: number, y: number) => circle(60, 60, 45)(x, y) && !circle(60, 60, 25)(x, y);
    paint(img, ring, { r: 90, g: 60, b: 30 });
    // A 4×4 near-white highlight on the ring (e.g. a white flower) must stay.
    paint(img, (x, y) => x >= 22 && x < 26 && y >= 58 && y < 62, { r: 248, g: 248, b: 246 });
    const out = removeBackground(img);
    expect(alphaAt(out, 60, 60)).toBe(0); // hole
    expect(alphaAt(out, 60, 25)).toBe(255); // ring
    expect(alphaAt(out, 23, 60)).toBe(255); // small highlight kept
  });

  it('keeps an object that touches the frame', () => {
    const img = createImageDataLike(100, 100, { r: 240, g: 240, b: 240 });
    paint(img, (x, y) => x >= 40 && x < 60 && y >= 45, { r: 240, g: 240, b: 240 }); // same as bg…
    paint(img, (x, y) => x >= 40 && x < 60 && y >= 45, { r: 110, g: 70, b: 40 }); // …then a pot reaching the bottom edge
    const out = removeBackground(img);
    expect(alphaAt(out, 50, 99)).toBe(255);
    expect(alphaAt(out, 50, 70)).toBe(255);
    expect(alphaAt(out, 10, 99)).toBe(0);
  });

  it('does nothing on a busy image without a plain border', () => {
    const img = createImageDataLike(64, 64);
    const r = rng(3);
    for (let p = 0; p < img.data.length; p += 4) {
      img.data[p] = r() * 255;
      img.data[p + 1] = r() * 255;
      img.data[p + 2] = r() * 255;
    }
    const out = removeBackground(img);
    let transparent = 0;
    for (let p = 3; p < out.data.length; p += 4) if (out.data[p] < 255) transparent++;
    expect(transparent / (64 * 64)).toBeLessThan(0.02);
  });

  it('keeps existing transparency and treats it as background', () => {
    const img = createImageDataLike(50, 50, { r: 200, g: 30, b: 30 });
    for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) if (!circle(25, 25, 15)(x, y)) img.data[(y * 50 + x) * 4 + 3] = 0;
    const out = removeBackground(img);
    expect(alphaAt(out, 0, 0)).toBe(0);
    expect(alphaAt(out, 25, 25)).toBe(255);
  });

  it('handles empty and 1-pixel images', () => {
    expect(removeBackground({ width: 0, height: 0, data: new Uint8ClampedArray(0) }).width).toBe(0);
    const one = removeBackground(createImageDataLike(1, 1, { r: 9, g: 9, b: 9 }));
    expect(one.data.length).toBe(4);
  });

  it('is fast enough for interactive previews (1 MP)', () => {
    const img = createImageDataLike(1024, 1024, { r: 245, g: 245, b: 245 });
    paint(img, circle(512, 512, 300), { r: 50, g: 120, b: 60 });
    addNoise(img, 4);
    const t0 = performance.now();
    removeBackground(img);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('trimTransparent', () => {
  it('crops to the visible pixels with a 2 px margin', () => {
    const img = createImageDataLike(50, 40);
    for (let p = 3; p < img.data.length; p += 4) img.data[p] = 0;
    const set = (x: number, y: number) => {
      const p = (y * 50 + x) * 4;
      img.data[p] = 77;
      img.data[p + 3] = 200;
    };
    set(10, 12);
    set(20, 30);
    const out = trimTransparent(img);
    expect(out.width).toBe(20 - 10 + 1 + 4);
    expect(out.height).toBe(30 - 12 + 1 + 4);
    expect(out.data[((2) * out.width + 2) * 4]).toBe(77);
    expect(out.data[((2) * out.width + 2) * 4 + 3]).toBe(200);
  });

  it('clamps the margin at the image edge and leaves fully transparent images alone', () => {
    const img = createImageDataLike(10, 10);
    for (let p = 3; p < img.data.length; p += 4) img.data[p] = 0;
    expect(trimTransparent(img)).toMatchObject({ width: 10, height: 10 });
    img.data[3] = 255; // (0,0)
    expect(trimTransparent(img)).toMatchObject({ width: 3, height: 3 });
  });
});

describe('hasTransparency', () => {
  it('needs more than 2 % transparent pixels', () => {
    const img = createImageDataLike(10, 10);
    expect(hasTransparency(img)).toBe(false);
    img.data[3] = 0;
    img.data[7] = 0;
    expect(hasTransparency(img)).toBe(false);
    img.data[11] = 10;
    expect(hasTransparency(img)).toBe(true);
    expect(hasTransparency({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBe(false);
  });
});
