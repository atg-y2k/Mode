import { describe, expect, it } from 'vitest';
import { createMask } from '../engine/mask';
import type { ImageDataLike } from '../engine/types';
import { BAND_EDGE_THRESHOLD, compositeBand, distanceSquared, isWholeTarget, markerMarginPhotoPx } from './bands';
import {
  CROP_MAX_EDGE,
  FULL_MAX_EDGE,
  HANDOFF_RATIOS,
  MARKER_COLORS,
  chooseMarkerColor,
  exportSize,
  markerColorName,
  planExport,
  ratioLabel,
  renderHandoff,
  snapToRatio,
} from './prepare';
import { resampleRGBA } from './resample';
import { ellipseMask, texturedScene } from './testing';

const W = 1600;
const H = 1200;

function solid(w: number, h: number, rgb: [number, number, number]): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return { width: w, height: h, data };
}

function aspectOf(r: { w: number; h: number }) {
  return r.w / r.h;
}

function contains(outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

describe('snapToRatio', () => {
  it('grows the short side to the closest ratio (never squashes) and keeps the required rect inside', () => {
    const desired = { x: 500, y: 600, w: 600, h: 300 };
    const required = { x: 600, y: 650, w: 400, h: 200 };
    const r = snapToRatio(desired, required, W, H, HANDOFF_RATIOS.gemini);
    expect(r).not.toBeNull();
    expect(r!.ratio.label).toBe('16:9');
    expect(r!.rect.w).toBeGreaterThanOrEqual(desired.w);
    expect(r!.rect.h).toBeGreaterThanOrEqual(desired.h);
    expect(Math.abs(aspectOf(r!.rect) - 16 / 9)).toBeLessThan(0.01);
    expect(contains(r!.rect, required)).toBe(true);
    expect(contains({ x: 0, y: 0, w: W, h: H }, r!.rect)).toBe(true);
  });

  it('only offers the app’s ratios (ChatGPT: 1:1, 3:2, 2:3)', () => {
    const r = snapToRatio({ x: 0, y: 0, w: W, h: H }, { x: 400, y: 300, w: 800, h: 600 }, W, H, HANDOFF_RATIOS.chatgpt);
    expect(r!.ratio.label).toBe('3:2');
    expect(r!.rect.w).toBe(W);
    expect(r!.rect.h).toBe(Math.round(W / 1.5));
  });

  it('returns null when no ratio can hold the required rect inside the photo', () => {
    // 4:3 photo, required = the whole photo: ChatGPT has no 4:3.
    expect(snapToRatio({ x: 0, y: 0, w: W, h: H }, { x: 0, y: 0, w: W, h: H }, W, H, HANDOFF_RATIOS.chatgpt)).toBeNull();
    expect(snapToRatio({ x: 0, y: 0, w: W, h: H }, { x: 0, y: 0, w: W, h: H }, W, H, HANDOFF_RATIOS.gemini)!.ratio.label).toBe('4:3');
  });

  it('shifts against the photo edge instead of leaving the frame', () => {
    const r = snapToRatio({ x: 1300, y: 900, w: 300, h: 300 }, { x: 1350, y: 950, w: 240, h: 240 }, W, H, [{ label: '16:9', w: 16, h: 9 }]);
    expect(r!.rect.x + r!.rect.w).toBeLessThanOrEqual(W);
    expect(r!.rect.y + r!.rect.h).toBeLessThanOrEqual(H);
    expect(contains(r!.rect, { x: 1350, y: 950, w: 240, h: 240 })).toBe(true);
  });
});

describe('planExport', () => {
  const smallBand = { x: 700, y: 800, w: 260, h: 140 };

  it('crops small targets with context, ≥ ⅓ of the photo per side, at an app ratio', () => {
    for (const app of ['chatgpt', 'gemini'] as const) {
      const plan = planExport(W, H, smallBand, 0.03, app, { margin: 12 });
      expect(plan.mode).toBe('crop');
      expect(plan.crop.w).toBeGreaterThanOrEqual(W / 3 - 1);
      expect(plan.crop.h).toBeGreaterThanOrEqual(H / 3 - 1);
      // Band + margin + context inside.
      expect(contains(plan.crop, { x: smallBand.x - 12, y: smallBand.y - 12, w: smallBand.w + 24, h: smallBand.h + 24 })).toBe(true);
      expect(plan.crop.x - (smallBand.x - 12)).toBeLessThan(0);
      const spec = HANDOFF_RATIOS[app].find((r) => r.label === plan.ratio)!;
      expect(spec).toBeDefined();
      expect(Math.abs(aspectOf(plan.crop) - spec.w / spec.h)).toBeLessThan(0.01);
      expect(plan.crop.w * plan.crop.h).toBeLessThan(0.7 * W * H);
    }
  });

  it('sends the full frame for large targets, trimmed to the app ratio when the band fits', () => {
    const big = { x: 200, y: 200, w: 1200, h: 700 };
    const g = planExport(W, H, big, 0.45, 'gemini');
    expect(g.mode).toBe('full');
    expect(g.ratio).toBe('4:3');
    expect(g.crop).toEqual({ x: 0, y: 0, w: W, h: H });
    const c = planExport(W, H, big, 0.45, 'chatgpt');
    expect(c.mode).toBe('full');
    expect(c.ratio).toBe('3:2');
    expect(c.crop.w).toBe(W);
    expect(contains(c.crop, big)).toBe(true);
  });

  it('keeps an unsnapped full frame when the band spans the photo', () => {
    const plan = planExport(W, H, { x: 5, y: 5, w: W - 10, h: H - 10 }, 0.5, 'chatgpt');
    expect(plan.crop).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(plan.ratio).toBe('4:3');
  });

  it('whole image → full frame at its own ratio; fullFrame forces the full frame', () => {
    expect(planExport(W, H, null, 1, 'chatgpt')).toEqual({ crop: { x: 0, y: 0, w: W, h: H }, ratio: '4:3', mode: 'full' });
    expect(planExport(W, H, smallBand, 0.03, 'gemini', { fullFrame: true }).mode).toBe('full');
  });
});

describe('exportSize / ratioLabel', () => {
  it('uses the long edge', () => {
    expect(exportSize({ x: 0, y: 0, w: 1600, h: 1200 }, 2048)).toEqual({ outW: 2048, outH: 1536 });
    expect(exportSize({ x: 0, y: 0, w: 600, h: 900 }, 1536)).toEqual({ outW: 1024, outH: 1536 });
  });
  it('labels common ratios and falls back to a decimal', () => {
    expect(ratioLabel(1600, 1200)).toBe('4:3');
    expect(ratioLabel(1080, 1920)).toBe('9:16');
    expect(ratioLabel(1000, 540)).toBe('1.85:1');
  });
});

describe('marker colour', () => {
  it('avoids the hue that dominates the crop', () => {
    expect(chooseMarkerColor(solid(100, 100, [230, 20, 220])).name).not.toBe('magenta');
    expect(chooseMarkerColor(solid(100, 100, [10, 220, 240])).name).not.toBe('cyan');
    // Magenta flowers and a cyan pool → lime.
    const mixed = solid(100, 100, [230, 20, 220]);
    for (let i = 0; i < 5000; i++) mixed.data.set([10, 220, 240], i * 4);
    expect(chooseMarkerColor(mixed).name).toBe('lime green');
  });
  it('prefers magenta on neutral or green scenes (lawns)', () => {
    expect(chooseMarkerColor(solid(50, 50, [128, 128, 128])).name).toBe('magenta');
    expect(chooseMarkerColor(solid(50, 50, [90, 160, 40])).name).toBe('magenta');
  });
  it('names marker hexes for prompts', () => {
    for (const c of MARKER_COLORS) expect(markerColorName(c.hex)).toBe(c.name);
    expect(markerColorName('')).toBe('');
    expect(markerColorName('#123456')).toBe('colored');
  });
});

describe('renderHandoff', () => {
  const scene = texturedScene(W, H, 5);
  const target = ellipseMask(W, H, 800, 850, 180, 80);

  it('produces a clean export and a marked copy that differs only in a ring outside the band', () => {
    const r = renderHandoff(scene, target, { app: 'gemini' });
    expect(r.mode).toBe('crop');
    expect(Math.max(r.outW, r.outH)).toBe(CROP_MAX_EDGE);
    expect(r.markerColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.markerColorName).toBe(markerColorName(r.markerColor));
    // Clean = the crop resampled.
    expect(Array.from(r.clean.data.subarray(0, 64))).toEqual(Array.from(resampleRGBA(scene, r.crop, r.outW, r.outH).data.subarray(0, 64)));
    // Every changed pixel maps to a photo pixel outside the composite band (so the composite discards it)...
    const band = compositeBand(target);
    const sx = r.crop.w / r.outW;
    const sy = r.crop.h / r.outH;
    let changed = 0;
    let insideBand = 0;
    for (let v = 0; v < r.outH; v++) {
      for (let u = 0; u < r.outW; u++) {
        const p = (v * r.outW + u) * 4;
        if (r.marked.data[p] === r.clean.data[p] && r.marked.data[p + 1] === r.clean.data[p + 1] && r.marked.data[p + 2] === r.clean.data[p + 2]) continue;
        changed++;
        const x = Math.floor(r.crop.x + (u + 0.5) * sx);
        const y = Math.floor(r.crop.y + (v + 0.5) * sy);
        if (band.data[y * W + x] >= BAND_EDGE_THRESHOLD) insideBand++;
      }
    }
    expect(changed).toBeGreaterThan(1000);
    expect(insideBand).toBe(0);
    // ...and within the marker margin of it (the band never touches the export edge).
    const margin = markerMarginPhotoPx(Math.max(r.outW, r.outH), r.outW / r.crop.w);
    const d2 = distanceSquared(W, H, (i) => band.data[i] >= BAND_EDGE_THRESHOLD);
    for (let v = 0; v < r.outH; v += 3) {
      for (let u = 0; u < r.outW; u += 3) {
        const p = (v * r.outW + u) * 4;
        if (r.marked.data[p] === r.clean.data[p] && r.marked.data[p + 1] === r.clean.data[p + 1]) continue;
        const x = Math.floor(r.crop.x + (u + 0.5) * sx);
        const y = Math.floor(r.crop.y + (v + 0.5) * sy);
        expect(Math.sqrt(d2[y * W + x])).toBeLessThanOrEqual(margin + 1);
      }
    }
  });

  it('draws the marker in the chosen colour (outline only: the target interior is untouched)', () => {
    const r = renderHandoff(scene, target, { app: 'chatgpt' });
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(r.markerColor.slice(i, i + 2), 16));
    let inkPixels = 0;
    for (let i = 0; i < r.outW * r.outH; i++) {
      const p = i * 4;
      if (Math.abs(r.marked.data[p] - cr) < 3 && Math.abs(r.marked.data[p + 1] - cg) < 3 && Math.abs(r.marked.data[p + 2] - cb) < 3) inkPixels++;
    }
    expect(inkPixels).toBeGreaterThan(500);
    // Centre of the target (export coords) is unchanged.
    const u = Math.round(((800 - r.crop.x) / r.crop.w) * r.outW);
    const v = Math.round(((850 - r.crop.y) / r.crop.h) * r.outH);
    const p = (v * r.outW + u) * 4;
    expect(r.marked.data[p]).toBe(r.clean.data[p]);
  });

  it('whole-image targets: full frame at the photo ratio, no marker', () => {
    const all = createMask(W, H);
    all.data.fill(255);
    expect(isWholeTarget(all)).toBe(true);
    const r = renderHandoff(scene, all, { app: 'chatgpt' });
    expect(r.crop).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(r.markerColor).toBe('');
    expect(Math.max(r.outW, r.outH)).toBe(FULL_MAX_EDGE);
    let differing = 0;
    for (let i = 0; i < r.clean.data.length; i++) if (r.marked.data[i] !== r.clean.data[i]) differing++;
    expect(differing).toBe(0);
    // An empty mask means the same (a whole-scope run).
    expect(renderHandoff(scene, createMask(W, H), { app: 'gemini' }).markerColor).toBe('');
  });

  it('honours maxEdge and fullFrame', () => {
    const r = renderHandoff(scene, target, { app: 'gemini', fullFrame: true, maxEdge: 1024 });
    expect(r.mode).toBe('full');
    expect(Math.max(r.outW, r.outH)).toBe(1024);
    expect(r.markerColor).not.toBe('');
  });

  it('rejects a mask of the wrong size', () => {
    expect(() => renderHandoff(scene, createMask(10, 10), { app: 'gemini' })).toThrow(/does not match/);
  });
});
