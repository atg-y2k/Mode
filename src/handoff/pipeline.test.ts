// Import pipeline end to end, in node, with the same OpenCV.js build the browser uses.
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ImageDataLike } from '../engine/types';
import { alignFeatures } from './alignCore';
import { compositeBand } from './bands';
import { resolveOpenCv, type CvLike } from './cv';
import { looksUnchanged, plainMapping, runImport } from './pipeline';
import { parseRatioList, renderHandoff } from './prepare';
import { applyAffine, invertAffine, resampleGray, toGray, type Affine } from './resample';
import { ellipseMask, simulateReturn, texturedScene } from './testing';

let cv: CvLike;

beforeAll(async () => {
  // require() the CommonJS build directly: vitest's ESM interop exposes the
  // exported Promise's `then` on the namespace, which breaks module loading.
  cv = await resolveOpenCv(createRequire(import.meta.url)('@techstark/opencv-js'));
}, 60_000);

const W = 1200;
const H = 900;
const scene = texturedScene(W, H, 11);
// A path-sized target in the lower centre (~3 % of the frame → crop export).
const target = ellipseMask(W, H, 600, 650, 150, 70);

/** Max distance (photo px) between where `found` and `truth` send sample points of the crop region outside the target. */
function transformError(found: Affine, truth: Affine, crop: { x: number; y: number; w: number; h: number }): number {
  const back = invertAffine(truth) as Affine;
  let worst = 0;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const x = crop.x + (crop.w * i) / 8;
      const y = crop.y + (crop.h * j) / 8;
      const q = applyAffine(found, x, y);
      const p = applyAffine(back, q.x, q.y);
      worst = Math.max(worst, Math.hypot(p.x - x, p.y - y));
    }
  }
  return worst;
}

function meanColorWhere(img: ImageDataLike, pick: (i: number) => boolean): [number, number, number] {
  const acc = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    if (!pick(i)) continue;
    acc[0] += img.data[i * 4];
    acc[1] += img.data[i * 4 + 1];
    acc[2] += img.data[i * 4 + 2];
    n++;
  }
  return [acc[0] / n, acc[1] / n, acc[2] / n];
}

describe('runImport (synthetic round trip)', () => {
  const exp = renderHandoff(scene, target, { app: 'gemini' });

  it('exports a crop for a small target', () => {
    expect(exp.mode).toBe('crop');
    expect(exp.markerColor).not.toBe('');
  });

  it('aligns a 0.75× zoomed, shifted, colour-cast return to < 2 px and removes the cast', () => {
    const sim = simulateReturn(exp.marked, exp.crop, target);
    const res = runImport(cv, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: sim.returned });
    expect(res.report.aligned).toBe(true);
    expect(res.report.inliers).toBeGreaterThanOrEqual(40);
    expect(res.report.residualPx).toBeLessThan(2);
    expect(transformError(res.transform as Affine, sim.truth, exp.crop)).toBeLessThan(2);
    // The plain mapping alone would be off by several px (zoom + shift).
    const plain = plainMapping(exp.crop, sim.returned.width, sim.returned.height);
    expect(transformError(plain, sim.truth, exp.crop)).toBeGreaterThan(5);
    // Colour drift drops substantially.
    expect(res.report.driftBefore).toBeGreaterThan(4);
    expect(res.report.driftAfter).toBeLessThan(res.report.driftBefore * 0.6);
    expect(res.report.driftAfter).toBeLessThan(3);
    // Nothing outside the target changed (the leftover marker ring is ignored).
    expect(res.report.outsideChanged).toBeLessThan(0.02);
    expect(res.outsideBlobs.length).toBe(0);
  }, 60_000);

  it('composites: original outside the band bit-exactly, the colour-corrected edit inside', () => {
    const sim = simulateReturn(exp.marked, exp.crop, target, { editColor: [150, 110, 80] });
    const res = runImport(cv, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: sim.returned });
    const band = compositeBand(target);
    let diffOutside = 0;
    for (let i = 0; i < W * H; i++) {
      if (band.data[i] !== 0) continue;
      const p = i * 4;
      if (res.composite.data[p] !== scene.data[p] || res.composite.data[p + 1] !== scene.data[p + 1] || res.composite.data[p + 2] !== scene.data[p + 2]) diffOutside++;
    }
    expect(diffOutside).toBe(0);
    // Deep inside the target: stripes of (150,110,80) and 0.75× that, cast removed → mean ≈ 0.875 × colour.
    const inner = ellipseMask(W, H, 600, 650, 120, 50);
    const mean = meanColorWhere(res.composite, (i) => inner.data[i] === 255);
    expect(Math.abs(mean[0] - 150 * 0.875)).toBeLessThan(8);
    expect(Math.abs(mean[1] - 110 * 0.875)).toBeLessThan(8);
    expect(Math.abs(mean[2] - 80 * 0.875)).toBeLessThan(8);
  }, 60_000);

  it('wrong-image check: flags a return that changed nothing inside the target', () => {
    // The clean export pasted straight back.
    const same = simulateReturn(exp.clean, exp.crop, target, { noEdit: true, scale: 1, zoom: 1, shift: { x: 0, y: 0 }, cast: { gain: [1, 1, 1], offset: [0, 0, 0] } });
    const a = runImport(cv, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: same.returned });
    expect(a.insideCheck?.unchanged).toBe(true);
    expect(a.insideCheck!.medianInside).toBeLessThan(3);
    // Gemini saved the uploaded original: resized, shifted, colour-shifted — still nothing changed in the area.
    const original = simulateReturn(exp.marked, exp.crop, target, { noEdit: true });
    const b = runImport(cv, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: original.returned });
    expect(b.report.aligned).toBe(true);
    expect(b.insideCheck?.unchanged).toBe(true);
    // A real edit is not flagged.
    const edited = simulateReturn(exp.marked, exp.crop, target);
    const c = runImport(cv, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: edited.returned });
    expect(c.insideCheck?.unchanged).toBe(false);
    expect(c.insideCheck!.medianInside).toBeGreaterThan(10);
  }, 60_000);

  it('wrong-image check: a target with room beside the element compares the element’s own area', () => {
    // Room for a wider path: the target is much larger than what the model edited.
    const room = ellipseMask(W, H, 600, 650, 330, 150);
    const edited = simulateReturn(exp.marked, exp.crop, target, { cast: { gain: [1, 1, 1], offset: [0, 0, 0] }, shift: { x: 0, y: 0 }, scale: 1, zoom: 1 });
    const job = { original: scene, target: room, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: edited.returned };
    const plain = runImport(cv, job);
    expect(plain.insideCheck!.medianInside).toBeLessThan(3); // the unchanged room dominates
    const core = runImport(cv, { ...job, inside: target });
    expect(core.insideCheck?.unchanged).toBe(false);
    expect(core.insideCheck!.medianInside).toBeGreaterThan(10);
  }, 60_000);

  it('wrong-image rule: inside median < 3 and < 1.5 × the outside median (no outside: < 3)', () => {
    expect(looksUnchanged(1.2, 1.1)).toBe(true);
    expect(looksUnchanged(2.5, 1.0)).toBe(false); // subtle but real change
    expect(looksUnchanged(3.5, 3.0)).toBe(false);
    expect(looksUnchanged(2.9, null)).toBe(true);
    // The export pasted back bit-exact: nothing changed inside or out.
    expect(looksUnchanged(0, 0)).toBe(true);
    expect(looksUnchanged(0.3, 0.1)).toBe(true);
    expect(looksUnchanged(4, null)).toBe(false);
  });

  it('reports changes the model made outside the target, with their location', () => {
    const sim = simulateReturn(exp.marked, exp.crop, target, { outsideChange: { x: 380, y: 560, r: 45, color: [220, 30, 40] } });
    const res = runImport(cv, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: sim.returned });
    expect(res.report.aligned).toBe(true);
    expect(res.report.outsideChanged).toBeGreaterThan(0.005);
    expect(res.outsideBlobs.length).toBeGreaterThanOrEqual(1);
    const b = res.outsideBlobs[0];
    expect(b.x).toBeLessThan(380);
    expect(b.x + b.w).toBeGreaterThan(380);
    expect(b.y).toBeLessThan(560);
    expect(b.y + b.h).toBeGreaterThan(560);
    // The heatmap lights up there and is dark far away.
    const m = res.outsideChangeMap;
    const kx = m.width / W;
    expect(m.data[Math.round(560 * kx) * m.width + Math.round(380 * kx)]).toBeGreaterThan(100);
    expect(m.data[Math.round(100 * kx) * m.width + Math.round(100 * kx)]).toBe(0);
    // ...but the composite still restores the original there.
    const p = (560 * W + 380) * 4;
    expect(res.composite.data[p]).toBe(scene.data[p]);
  }, 60_000);

  it('aligns a full-frame export that the app returned at a different aspect (ChatGPT 3:2)', () => {
    const big = ellipseMask(W, H, 600, 450, 420, 300); // ~37 % → full frame
    // The API's recommended sizes only (a user override of the ratio table): the 4:3 photo is trimmed to 3:2.
    const full = renderHandoff(scene, big, { app: 'chatgpt', ratios: parseRatioList('1:1, 3:2, 2:3') });
    expect(full.mode).toBe('full');
    expect(full.ratio).toBe('3:2');
    const sim = simulateReturn(full.marked, full.crop, big, { scale: 0.75, zoom: 1.0, shift: { x: 4, y: 3 } });
    const res = runImport(cv, { original: scene, target: big, crop: full.crop, outW: full.outW, outH: full.outH, returned: sim.returned });
    expect(res.report.aligned).toBe(true);
    expect(res.report.residualPx).toBeLessThan(2);
    expect(transformError(res.transform as Affine, sim.truth, full.crop)).toBeLessThan(2.5);
  }, 60_000);

  it('recovers when the app changed the aspect ratio (16:9 export → square, centre-cropped)', () => {
    const side = Math.round(exp.outH * 0.9);
    const sim = simulateReturn(exp.marked, exp.crop, target, { scale: 0.9 * 1.08, zoom: 1, size: { w: side, h: side }, shift: { x: 6, y: 0 } });
    expect(sim.returned.width).toBe(sim.returned.height);
    const res = runImport(cv, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: sim.returned });
    expect(res.report.aligned).toBe(true);
    expect(res.report.residualPx).toBeLessThan(2);
    // Compare inside the part of the crop the square return still shows.
    const back = invertAffine(sim.truth) as Affine;
    const tl = applyAffine(back, 0, 0);
    const br = applyAffine(back, side, side);
    const visible = { x: Math.max(exp.crop.x, tl.x), y: Math.max(exp.crop.y, tl.y), w: 0, h: 0 };
    visible.w = Math.min(exp.crop.x + exp.crop.w, br.x) - visible.x;
    visible.h = Math.min(exp.crop.y + exp.crop.h, br.y) - visible.y;
    expect(transformError(res.transform as Affine, sim.truth, visible)).toBeLessThan(2);
  }, 60_000);

  it('falls back to the plain mapping when the return is unrelated (aligned: false)', () => {
    const other = texturedScene(exp.outW, exp.outH, 99);
    const res = runImport(cv, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: other });
    expect(res.report.aligned).toBe(false);
    expect(res.alignNote).not.toBe('');
    const plain = plainMapping(exp.crop, other.width, other.height);
    expect(transformError(res.transform as Affine, plain, exp.crop)).toBeLessThan(1e-6);
    // Lots changed outside → flagged.
    expect(res.report.outsideChanged).toBeGreaterThan(0.3);
  }, 60_000);

  it('works without OpenCV (plain mapping) and still protects the outside', () => {
    const sim = simulateReturn(exp.clean, exp.crop, target, { scale: 0.5, zoom: 1, shift: { x: 0, y: 0 }, noise: 0 });
    const res = runImport(null, { original: scene, target, crop: exp.crop, outW: exp.outW, outH: exp.outH, returned: sim.returned });
    expect(res.report.aligned).toBe(false);
    expect(res.report.inliers).toBe(0);
    expect(res.report.driftAfter).toBeLessThan(res.report.driftBefore);
    expect(res.composite.width).toBe(W);
  });

  it('whole-image targets: everything comes from the return, nothing is protected', () => {
    const all = ellipseMask(W, H, 600, 450, 2000, 2000);
    const wholeExp = renderHandoff(scene, all, { app: 'gemini' });
    expect(wholeExp.markerColor).toBe('');
    expect(wholeExp.crop).toEqual({ x: 0, y: 0, w: W, h: H });
    const sim = simulateReturn(wholeExp.clean, wholeExp.crop, all, { zoom: 1, shift: { x: 2, y: 1 } });
    const res = runImport(cv, { original: scene, target: all, crop: wholeExp.crop, outW: wholeExp.outW, outH: wholeExp.outH, returned: sim.returned });
    expect(res.report.outsideChanged).toBe(0);
    expect(res.outsideBlobs).toEqual([]);
    // The centre pixel is the (striped) edit, not the original scene.
    const inner = ellipseMask(W, H, 600, 450, 300, 200);
    const mean = meanColorWhere(res.composite, (i) => inner.data[i] === 255);
    expect(Math.abs(mean[0] - (150 * 0.875 * 1.06 + 8))).toBeLessThan(10);
  }, 60_000);
});

describe('alignFeatures', () => {
  it('recovers a known affine between two grayscale images', () => {
    const g = toGray(scene);
    const O = resampleGray(g, { x: 0, y: 0, w: W, h: H }, 800, 600);
    // Returned = O scaled 0.8 and shifted (+15, −10).
    const truth: Affine = [0.8, 0, 15, 0, 0.8, -10];
    const inv = invertAffine(truth) as Affine;
    const R = { width: 660, height: 470, data: new Uint8Array(660 * 470) };
    for (let v = 0; v < R.height; v++) {
      for (let u = 0; u < R.width; u++) {
        const p = applyAffine(inv, u + 0.5, v + 0.5);
        const x = Math.min(O.width - 1, Math.max(0, Math.floor(p.x)));
        const y = Math.min(O.height - 1, Math.max(0, Math.floor(p.y)));
        R.data[v * R.width + u] = O.data[y * O.width + x];
      }
    }
    const res = alignFeatures(cv, O, R, null, [0.8, 0, 0, 0, 0.8, 0]);
    expect(res.accepted).toBe(true);
    expect(res.residualPx).toBeLessThan(1.5);
    for (const [x, y] of [
      [100, 100],
      [700, 500],
    ]) {
      const a = applyAffine(res.matrix, x, y);
      const b = applyAffine(truth, x, y);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1.5);
    }
  }, 60_000);

  it('rejects featureless input', () => {
    const flat = { width: 300, height: 200, data: new Uint8Array(300 * 200).fill(128) };
    const res = alignFeatures(cv, flat, flat, null, [1, 0, 0, 0, 1, 0]);
    expect(res.accepted).toBe(false);
    expect(res.matrix).toEqual([1, 0, 0, 0, 1, 0]);
  });
});
