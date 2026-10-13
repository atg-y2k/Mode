import { describe, expect, it } from 'vitest';
import { PAINT_FINISHES, type PaintFinish } from '../../shared/types';
import { deltaE, hexToLab, labToRgb, rgbToLab } from './color';
import { createMask, fillMask } from './mask';
import { applyPaint, computeRegionStats, FINISH_HIGHLIGHT, regionStatsMemo } from './recolor';
import { cloneImageData, createImageDataLike, type ImageDataLike, type Mask, type RGB } from './types';

function pixel(img: ImageDataLike, x: number, y: number): RGB {
  const p = (y * img.width + x) * 4;
  return { r: img.data[p], g: img.data[p + 1], b: img.data[p + 2] };
}

function fullMask(w: number, h: number): Mask {
  const m = createMask(w, h);
  fillMask(m);
  return m;
}

/** Horizontal gray ramp from `lo` to `hi` (one column per value step). */
function grayRamp(w: number, h: number, lo: number, hi: number): ImageDataLike {
  const img = createImageDataLike(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(lo + ((hi - lo) * x) / (w - 1));
      const p = (y * w + x) * 4;
      img.data[p] = v;
      img.data[p + 1] = v;
      img.data[p + 2] = v;
    }
  }
  return img;
}

const L = (c: RGB) => rgbToLab(c).l;

describe('computeRegionStats', () => {
  it('returns neutral values for an empty mask', () => {
    const img = createImageDataLike(8, 8, { r: 200, g: 10, b: 10 });
    expect(computeRegionStats(img, createMask(8, 8))).toEqual({
      count: 0,
      meanL: 50,
      meanA: 0,
      meanB: 0,
      p10L: 50,
      p90L: 50,
    });
  });

  it('measures a uniform region exactly', () => {
    const img = createImageDataLike(10, 10, { r: 120, g: 140, b: 90 });
    const ref = rgbToLab({ r: 120, g: 140, b: 90 });
    const st = computeRegionStats(img, fullMask(10, 10));
    expect(st.count).toBe(100);
    expect(st.meanL).toBeCloseTo(ref.l, 2);
    expect(st.meanA).toBeCloseTo(ref.a, 2);
    expect(st.meanB).toBeCloseTo(ref.b, 2);
    expect(Math.abs(st.p10L - ref.l)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(st.p90L - ref.l)).toBeLessThanOrEqual(0.06);
  });

  it('weights by coverage and finds percentiles', () => {
    const img = grayRamp(101, 1, 0, 255);
    const m = fullMask(101, 1);
    const st = computeRegionStats(img, m);
    expect(st.count).toBe(101);
    expect(st.p10L).toBeLessThan(st.meanL);
    expect(st.p90L).toBeGreaterThan(st.meanL);
    // p10 ≈ L of the 10th darkest pixel
    expect(Math.abs(st.p10L - L(pixel(img, 10, 0)))).toBeLessThan(1.5);
    expect(Math.abs(st.p90L - L(pixel(img, 90, 0)))).toBeLessThan(1.5);

    // Half-covered pixels count half.
    const two = createImageDataLike(2, 1);
    two.data.set([0, 0, 0, 255, 255, 255, 255, 255]);
    const half = { width: 2, height: 1, data: new Uint8Array([255, 85]) };
    const s2 = computeRegionStats(two, half);
    expect(s2.count).toBeCloseTo(4 / 3, 10);
    expect(s2.meanL).toBeCloseTo(25, 1); // (0·255 + 100·85) / 340
  });
});

describe('applyPaint', () => {
  const targets = ['#1f3a5f', '#9caf88', '#f4f1ea', '#2b2b2b', '#c0392b', '#ffffff', '#000000', '#e9c46a'];
  const sources: RGB[] = [
    { r: 184, g: 180, b: 173 }, // greige wall
    { r: 245, g: 245, b: 245 }, // white wall
    { r: 40, g: 50, b: 70 }, // navy wall
    { r: 0, g: 0, b: 0 }, // black
    { r: 255, g: 255, b: 255 }, // white
  ];

  it('paints a uniform region the target color (ΔE2000 < 2)', () => {
    for (const src of sources) {
      for (const hex of targets) {
        for (const finish of PAINT_FINISHES) {
          const img = createImageDataLike(6, 6, src);
          const dst = cloneImageData(img);
          applyPaint(img, dst, fullMask(6, 6), { hex, finish, strength: 1 });
          const got = rgbToLab(pixel(dst, 3, 3));
          expect(deltaE(got, hexToLab(hex))).toBeLessThan(2);
        }
      }
    }
  });

  it('preserves shading order and never clips flat (light, dark and mid targets)', () => {
    const img = grayRamp(256, 2, 20, 235);
    for (const hex of ['#1f3a5f', '#f4f1ea', '#111111', '#9caf88', '#ffffff']) {
      const dst = cloneImageData(img);
      applyPaint(img, dst, fullMask(256, 2), { hex, finish: 'eggshell', strength: 1 });
      let prev = -Infinity;
      let distinct = 0;
      let last = -1;
      for (let x = 0; x < 256; x++) {
        const l = L(pixel(dst, x, 0));
        expect(l).toBeGreaterThanOrEqual(prev - 0.6); // 8-bit rounding noise only
        prev = Math.max(prev, l);
        const key = pixel(dst, x, 0).r * 65536 + pixel(dst, x, 0).g * 256 + pixel(dst, x, 0).b;
        if (key !== last) distinct++;
        last = key;
      }
      // shading survives: the brightest and darkest ends differ clearly
      expect(L(pixel(dst, 255, 0)) - L(pixel(dst, 0, 0))).toBeGreaterThan(3);
      // and is not posterized into a few flat bands
      expect(distinct).toBeGreaterThan(30);
    }
  });

  it('keeps proportionally softer shading on dark paint and keeps hue in shadows', () => {
    const img = grayRamp(64, 1, 90, 200);
    const navy = cloneImageData(img);
    applyPaint(img, navy, fullMask(64, 1), { hex: '#1f3a5f', finish: 'flat', strength: 1 });
    const srcRange = L(pixel(img, 63, 0)) - L(pixel(img, 0, 0));
    const navyRange = L(pixel(navy, 63, 0)) - L(pixel(navy, 0, 0));
    expect(navyRange).toBeGreaterThan(3);
    expect(navyRange).toBeLessThan(srcRange * 0.6);
    // shadow end is still blue (b* negative), not neon or gray
    const shadow = rgbToLab(pixel(navy, 0, 0));
    expect(shadow.b).toBeLessThan(-5);
    const mid = rgbToLab(pixel(navy, 32, 0));
    expect(Math.hypot(shadow.a, shadow.b)).toBeLessThanOrEqual(Math.hypot(mid.a, mid.b) + 1);
  });

  it('leaves mask = 0 pixels untouched and blends partial coverage', () => {
    const src = createImageDataLike(4, 1, { r: 180, g: 180, b: 180 });
    const dst = createImageDataLike(4, 1, { r: 10, g: 200, b: 30 }); // composite so far differs from src
    const mask = { width: 4, height: 1, data: new Uint8Array([0, 255, 128, 0]) };
    applyPaint(src, dst, mask, { hex: '#1f3a5f', finish: 'satin', strength: 1 });
    expect(pixel(dst, 0, 0)).toEqual({ r: 10, g: 200, b: 30 });
    expect(pixel(dst, 3, 0)).toEqual({ r: 10, g: 200, b: 30 });
    const full = pixel(dst, 1, 0);
    expect(deltaE(rgbToLab(full), hexToLab('#1f3a5f'))).toBeLessThan(2);
    const half = pixel(dst, 2, 0);
    expect(Math.abs(half.r - (10 + (full.r - 10) * (128 / 255)))).toBeLessThanOrEqual(1);
    expect(Math.abs(half.g - (200 + (full.g - 200) * (128 / 255)))).toBeLessThanOrEqual(1);
    for (let i = 0; i < 4; i++) expect(dst.data[i * 4 + 3]).toBe(255);
  });

  it('strength 0 is a no-op and strength scales the blend', () => {
    const src = grayRamp(32, 4, 60, 200);
    const dst0 = cloneImageData(src);
    applyPaint(src, dst0, fullMask(32, 4), { hex: '#c0392b', finish: 'flat', strength: 0 });
    expect(dst0.data).toEqual(src.data);
    const full = cloneImageData(src);
    applyPaint(src, full, fullMask(32, 4), { hex: '#c0392b', finish: 'flat', strength: 1 });
    const half = cloneImageData(src);
    applyPaint(src, half, fullMask(32, 4), { hex: '#c0392b', finish: 'flat', strength: 0.5 });
    for (let i = 0; i < src.data.length; i++) {
      if (i % 4 === 3) continue;
      expect(Math.abs(half.data[i] - (src.data[i] + full.data[i]) / 2)).toBeLessThanOrEqual(1);
    }
  });

  it('ignores invalid colors, empty masks, NaN strength and mismatched sizes without throwing', () => {
    const src = grayRamp(16, 16, 50, 200);
    const dst = cloneImageData(src);
    applyPaint(src, dst, fullMask(16, 16), { hex: 'not-a-color', finish: 'flat', strength: 1 });
    applyPaint(src, dst, createMask(16, 16), { hex: '#ff0000', finish: 'flat', strength: 1 });
    applyPaint(src, dst, fullMask(16, 16), { hex: '#ff0000', finish: 'flat', strength: NaN });
    expect(dst.data).toEqual(src.data);
    expect(() => applyPaint(src, dst, fullMask(8, 20), { hex: '#ff0000', finish: 'gloss', strength: 1 })).not.toThrow();
    for (const v of dst.data) expect(Number.isNaN(v)).toBe(false);
  });

  it('glossier finishes keep more of the highlights, flat keeps none', () => {
    // Mostly mid-gray wall with a bright specular streak.
    const w = 100;
    const img = createImageDataLike(w, 1, { r: 150, g: 150, b: 150 });
    for (let x = 90; x < w; x++) img.data.set([252, 252, 252], x * 4);
    for (let x = 0; x < 90; x++) img.data.set([140 + (x % 20), 140 + (x % 20), 140 + (x % 20)], x * 4);
    const lightness: Record<string, number> = {};
    let body: RGB | null = null;
    for (const finish of PAINT_FINISHES) {
      const dst = cloneImageData(img);
      applyPaint(img, dst, fullMask(w, 1), { hex: '#1f3a5f', finish: finish as PaintFinish, strength: 1 });
      lightness[finish] = L(pixel(dst, 95, 0));
      // non-highlight pixels are unaffected by the finish
      body ??= pixel(dst, 10, 0);
      expect(pixel(dst, 10, 0)).toEqual(body);
    }
    const order = PAINT_FINISHES.map((f) => lightness[f]);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(FINISH_HIGHLIGHT.flat).toBe(0);
    expect(FINISH_HIGHLIGHT.gloss).toBe(0.75);
    // gloss highlight approaches the original highlight lightness
    expect(lightness.gloss).toBeGreaterThan(70);
  });

  it('a finish never darkens a highlight below the plain shading result', () => {
    // Dark original repainted white: original highlights are darker than the new paint.
    const img = grayRamp(64, 1, 20, 90);
    const flat = cloneImageData(img);
    const gloss = cloneImageData(img);
    applyPaint(img, flat, fullMask(64, 1), { hex: '#f4f1ea', finish: 'flat', strength: 1 });
    applyPaint(img, gloss, fullMask(64, 1), { hex: '#f4f1ea', finish: 'gloss', strength: 1 });
    for (let x = 0; x < 64; x++) expect(L(pixel(gloss, x, 0))).toBeGreaterThanOrEqual(L(pixel(flat, x, 0)) - 0.5);
  });

  it('uses given stats, and memoized stats match fresh ones until the mask changes', () => {
    const img = grayRamp(40, 10, 70, 210);
    const mask = fullMask(40, 10);
    const st = computeRegionStats(img, mask);
    const a = cloneImageData(img);
    const b = cloneImageData(img);
    applyPaint(img, a, mask, { hex: '#9caf88', finish: 'satin', strength: 1 }, st);
    applyPaint(img, b, mask, { hex: '#9caf88', finish: 'satin', strength: 1 });
    expect(b.data).toEqual(a.data);

    const memo1 = regionStatsMemo(img, mask);
    expect(regionStatsMemo(img, mask)).toBe(memo1);
    for (let x = 0; x < 20; x++) mask.data[x] = 0; // in-place edit
    const memo2 = regionStatsMemo(img, mask);
    expect(memo2).not.toBe(memo1);
    expect(memo2).toEqual(computeRegionStats(img, mask));
    expect(regionStatsMemo(cloneImageData(img), mask)).not.toBe(memo2); // different source image
  });

  it('carries a little of the original color variation (8%)', () => {
    // Two pixels of equal lightness: one warm (b* +15), one cool (b* −15).
    const warm = labToRgb({ l: 60, a: 0, b: 15 });
    const cool = labToRgb({ l: 60, a: 0, b: -15 });
    const img = createImageDataLike(2, 1);
    img.data.set([warm.r, warm.g, warm.b, 255, cool.r, cool.g, cool.b, 255]);
    const dst = cloneImageData(img);
    applyPaint(img, dst, fullMask(2, 1), { hex: '#9caf88', finish: 'flat', strength: 1 });
    const p0 = rgbToLab(pixel(dst, 0, 0));
    const p1 = rgbToLab(pixel(dst, 1, 0));
    const s0 = rgbToLab(pixel(img, 0, 0));
    const s1 = rgbToLab(pixel(img, 1, 0));
    const ratio = (p0.b - p1.b) / (s0.b - s1.b);
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.11);
  });
});
