import { describe, expect, it } from 'vitest';
import { createMask } from '../../engine/mask';
import { createImageDataLike } from '../../engine/types';
import { alphaComposite, centerCropRect, fitWithin, maskToKeepAlpha } from './composite';

describe('centerCropRect', () => {
  it('keeps the whole source when aspects match', () => {
    expect(centerCropRect(1024, 768, 1600, 1200)).toEqual({ sx: 0, sy: 0, sw: 1024, sh: 768 });
  });
  it('crops the sides of a wider source', () => {
    // square provider output for a 4:3 photo → crop top/bottom
    const r = centerCropRect(1024, 1024, 1600, 1200);
    expect(r.sx).toBe(0);
    expect(r.sw).toBe(1024);
    expect(r.sh).toBeCloseTo(768);
    expect(r.sy).toBeCloseTo(128);
    // landscape output for a portrait photo → crop left/right
    const p = centerCropRect(1536, 1024, 900, 1200);
    expect(p.sh).toBe(1024);
    expect(p.sw).toBeCloseTo(768);
    expect(p.sx).toBeCloseTo((1536 - 768) / 2);
  });
});

describe('alphaComposite', () => {
  const base = createImageDataLike(4, 1, { r: 10, g: 20, b: 30 });
  const top = createImageDataLike(4, 1, { r: 210, g: 120, b: 230 });

  it('keeps base where mask is 0, top where 255, blends between', () => {
    const mask = createMask(4, 1);
    mask.data.set([0, 255, 128, 64]);
    const out = alphaComposite(base, top, mask);
    expect([...out.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect([...out.data.slice(4, 8)]).toEqual([210, 120, 230, 255]);
    const k = 128 / 255;
    expect(out.data[8]).toBe(Math.round(10 + 200 * k));
    expect(out.data[9]).toBe(Math.round(20 + 100 * k));
    expect(out.data[12]).toBe(Math.round(10 + 200 * (64 / 255)));
    // inputs untouched
    expect(base.data[4]).toBe(10);
  });

  it('copies the base exactly for an empty mask', () => {
    const out = alphaComposite(base, top, createMask(4, 1));
    expect([...out.data]).toEqual([...base.data]);
  });

  it('throws on size mismatch', () => {
    expect(() => alphaComposite(base, createImageDataLike(3, 1), createMask(4, 1))).toThrow(/size mismatch/);
  });
});

describe('maskToKeepAlpha', () => {
  it('is opaque where the photo is kept and transparent where it may change', () => {
    const mask = createMask(3, 1);
    mask.data.set([0, 255, 100]);
    const img = maskToKeepAlpha(mask);
    expect([...img.data]).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 155]);
  });
});

describe('fitWithin', () => {
  it('fits the long edge without upscaling', () => {
    expect(fitWithin(1600, 1200, 320)).toEqual({ width: 320, height: 240 });
    expect(fitWithin(200, 100, 320)).toEqual({ width: 200, height: 100 });
  });
});
