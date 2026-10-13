import { describe, expect, it } from 'vitest';
import { createMask } from '../engine/mask';
import { compositeBand, compositeRadii, distanceSquared, isWholeTarget, markerMarginPhotoPx } from './bands';
import { connectedBlobs, outsideChanges } from './changeMap';
import { applyChannelFit, fitChannels, meanDeltaE } from './colorMatch';
import { affineScale, applyAffine, composeAffine, invertAffine, resampleGray, resampleRGBA, warpAffineRGBA, type Affine } from './resample';
import { ellipseMask, rng, texturedScene } from './testing';

describe('resample', () => {
  it('is the identity at 1:1 and keeps flat colours flat at any scale', () => {
    const img = texturedScene(64, 48, 1);
    const same = resampleRGBA(img, { x: 0, y: 0, w: 64, h: 48 }, 64, 48);
    let diff = 0;
    for (let i = 0; i < img.data.length; i++) diff = Math.max(diff, Math.abs(img.data[i] - same.data[i]));
    expect(diff).toBeLessThanOrEqual(1);
    const flat = { width: 40, height: 30, data: new Uint8Array(1200).fill(77) };
    for (const [w, h] of [
      [13, 9],
      [120, 90],
    ]) {
      const r = resampleGray(flat, { x: 3, y: 2, w: 30, h: 20 }, w, h);
      expect(r.data.every((v) => v === 77)).toBe(true);
    }
  });

  it('crops: resampling a rect at 1:1 copies it', () => {
    const img = texturedScene(50, 40, 2);
    const r = resampleRGBA(img, { x: 10, y: 5, w: 20, h: 15 }, 20, 15);
    const p = (7 * 50 + 13) * 4;
    const q = (2 * 20 + 3) * 4;
    expect(Math.abs(r.data[q] - img.data[p])).toBeLessThanOrEqual(1);
  });

  it('affine helpers compose and invert', () => {
    const a: Affine = [0.75, 0.02, 10, -0.01, 0.76, -4];
    const b: Affine = [2, 0, -3, 0, 2, 5];
    const ab = composeAffine(a, b);
    const p = applyAffine(ab, 7, 9);
    const q = applyAffine(a, ...(Object.values(applyAffine(b, 7, 9)) as [number, number]));
    expect(p.x).toBeCloseTo(q.x, 9);
    const inv = invertAffine(a) as Affine;
    const back = applyAffine(inv, ...(Object.values(applyAffine(a, 3, 4)) as [number, number]));
    expect(back.x).toBeCloseTo(3, 9);
    expect(back.y).toBeCloseTo(4, 9);
    expect(affineScale([2, 0, 0, 0, 2, 0])).toBe(2);
    expect(invertAffine([0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('warps with a validity mask', () => {
    const img = texturedScene(40, 30, 3);
    // Output pixel (u, v) samples the source at (u + 10, v): a shift.
    const w = warpAffineRGBA(img, [1, 0, 10, 0, 1, 0], 40, 30);
    expect(w.valid[0]).toBe(255);
    expect(w.valid[35]).toBe(0); // samples x = 45.5 — outside
    expect(w.image.data[0]).toBe(img.data[10 * 4]);
  });
});

describe('bands', () => {
  it('exact Euclidean distance transform', () => {
    const w = 9;
    const h = 7;
    const d2 = distanceSquared(w, h, (i) => i === 3 * w + 4);
    expect(d2[3 * w + 4]).toBe(0);
    expect(d2[3 * w + 7]).toBe(9);
    expect(d2[0]).toBe(16 + 9);
    expect(distanceSquared(3, 3, () => false)[4]).toBeGreaterThan(1e19);
  });

  it('composite band = target grown and feathered; whole targets are solid', () => {
    const t = ellipseMask(400, 300, 200, 150, 60, 30);
    const band = compositeBand(t);
    const { grow } = compositeRadii(400, 300, { w: 120, h: 60 });
    expect(grow).toBeGreaterThanOrEqual(2);
    expect(band.data[150 * 400 + 200]).toBe(255);
    expect(band.data[150 * 400 + 200 + 60 + grow - 1]).toBeGreaterThan(100); // grown past the edge
    expect(band.data[0]).toBe(0);
    const empty = createMask(400, 300);
    expect(isWholeTarget(empty)).toBe(true);
    expect(compositeBand(empty).data.every((v) => v === 255)).toBe(true);
    expect(isWholeTarget(t)).toBe(false);
  });

  it('marker margin covers gap + stroke at any export scale', () => {
    expect(markerMarginPhotoPx(2048, 1.28)).toBeGreaterThanOrEqual(3 + Math.ceil(7 / 1.28));
    expect(markerMarginPhotoPx(512, 0.32)).toBeGreaterThan(markerMarginPhotoPx(2048, 1.28));
  });
});

describe('colour match', () => {
  it('recovers a per-channel cast despite 10 % changed pixels', () => {
    const orig = texturedScene(120, 90, 4);
    const ret = { width: 120, height: 90, data: new Uint8ClampedArray(orig.data) };
    const gain = [1.08, 0.97, 0.85];
    const offset = [6, 3, -4];
    const rand = rng(9);
    for (let i = 0; i < 120 * 90; i++) {
      const p = i * 4;
      for (let c = 0; c < 3; c++) ret.data[p + c] = gain[c] * orig.data[p + c] + offset[c];
      if (rand() < 0.1) ret.data.set([255, 0, 0], p); // things the model "changed"
    }
    const samples = Uint32Array.from({ length: 120 * 90 }, (_, i) => i);
    const before = meanDeltaE(orig, ret, samples);
    const fit = fitChannels(ret, orig, samples);
    for (let c = 0; c < 3; c++) {
      expect(fit.gain[c]).toBeCloseTo(1 / gain[c], 1);
    }
    expect(meanDeltaE(orig, ret, samples, 0.1, fit)).toBeLessThan(1.2);
    applyChannelFit(ret, fit);
    const after = meanDeltaE(orig, ret, samples);
    expect(after).toBeLessThan(before / 4);
  });

  it('is the identity with too few samples', () => {
    const img = texturedScene(10, 10, 1);
    expect(fitChannels(img, img, new Uint32Array(10))).toEqual({ gain: [1, 1, 1], offset: [0, 0, 0] });
  });
});

describe('change map', () => {
  it('finds 8-connected blobs above a size, largest first', () => {
    const w = 20;
    const h = 10;
    const b = new Uint8Array(w * h);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) b[y * w + x] = 1; // 9 px
    b[5 * w + 10] = 1;
    b[6 * w + 11] = 1; // diagonal pair: 2 px
    for (let y = 2; y < 8; y++) for (let x = 14; x < 19; x++) b[y * w + x] = 1; // 30 px
    const blobs = connectedBlobs(b, w, h, 2);
    expect(blobs.map((x) => x.area)).toEqual([30, 9, 2]);
    expect(blobs[0]).toEqual({ x: 14, y: 2, w: 5, h: 6, area: 30 });
    expect(connectedBlobs(b, w, h, 5).length).toBe(2);
  });

  it('flags only protected pixels that changed', () => {
    const a = texturedScene(100, 80, 6);
    const b = { width: 100, height: 80, data: new Uint8ClampedArray(a.data) };
    for (let y = 10; y < 30; y++) for (let x = 60; x < 85; x++) b.data.set([255, 255, 0], (y * 100 + x) * 4);
    for (let y = 50; y < 70; y++) for (let x = 10; x < 30; x++) b.data.set([0, 0, 255], (y * 100 + x) * 4); // inside the target
    const prot = new Uint8Array(100 * 80).fill(255);
    for (let y = 45; y < 75; y++) for (let x = 5; x < 35; x++) prot[y * 100 + x] = 0;
    const r = outsideChanges(a, b, prot);
    expect(r.blobs.length).toBe(1);
    expect(r.blobs[0].x).toBeGreaterThanOrEqual(57);
    expect(r.blobs[0].y).toBeLessThanOrEqual(12);
    expect(r.changedShare).toBeGreaterThan(0.05);
    expect(r.changedShare).toBeLessThan(0.15);
    expect(r.map[60 * 100 + 20]).toBe(0);
    expect(r.map[20 * 100 + 70]).toBeGreaterThan(200);
  });
});
