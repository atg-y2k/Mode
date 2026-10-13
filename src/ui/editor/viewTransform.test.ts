import { describe, expect, it } from 'vitest';
import {
  clampPan,
  fitView,
  layoutPanes,
  paneAt,
  pinchView,
  scaleLimits,
  stepZoom,
  toPhoto,
  toScreen,
  wheelZoomFactor,
  zoomAt,
} from './viewTransform';

const img = { width: 1600, height: 1200 };

describe('fitView', () => {
  it('contains and centers the image inside the padded pane', () => {
    const v = fitView(img, { width: 900, height: 600 }, 20);
    // limited by height: (600 - 40) / 1200
    expect(v.scale).toBeCloseTo(560 / 1200, 6);
    expect(v.ty).toBeCloseTo(20, 6);
    expect(v.tx).toBeCloseTo((900 - 1600 * v.scale) / 2, 6);
  });

  it('never returns a non-positive scale for degenerate panes', () => {
    const v = fitView(img, { width: 0, height: 0 }, 20);
    expect(v.scale).toBeGreaterThan(0);
    expect(Number.isFinite(v.tx)).toBe(true);
  });
});

describe('screen <-> photo mapping', () => {
  it('round trips', () => {
    const v = { scale: 0.37, tx: 12.5, ty: -40 };
    const s = toScreen(v, 812, 333);
    const p = toPhoto(v, s.x, s.y);
    expect(p.x).toBeCloseTo(812, 9);
    expect(p.y).toBeCloseTo(333, 9);
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const v = { scale: 0.5, tx: 30, ty: 10 };
    const before = toPhoto(v, 200, 150);
    const z = zoomAt(v, 2, 200, 150);
    const after = toPhoto(z, 200, 150);
    expect(z.scale).toBe(2);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe('clampPan', () => {
  it('keeps a margin of the image visible', () => {
    const pane = { width: 800, height: 600 };
    const v = clampPan({ scale: 1, tx: 5000, ty: -5000 }, img, pane, 48);
    expect(v.tx).toBe(800 - 48);
    expect(v.ty).toBe(48 - 1200);
  });

  it('leaves a valid view untouched', () => {
    const v = { scale: 0.5, tx: 10, ty: 20 };
    expect(clampPan(v, img, { width: 800, height: 600 }, 48)).toEqual(v);
  });
});

describe('pinchView', () => {
  it('scales with finger distance and follows the midpoint', () => {
    const start = { scale: 1, tx: 0, ty: 0 };
    const limits = { min: 0.1, max: 16 };
    const v = pinchView(start, { x: 100, y: 100 }, 100, { x: 150, y: 120 }, 200, limits);
    expect(v.scale).toBeCloseTo(2, 9);
    // photo point (100,100) is now under (150,120)
    const s = toScreen(v, 100, 100);
    expect(s.x).toBeCloseTo(150, 9);
    expect(s.y).toBeCloseTo(120, 9);
  });

  it('respects scale limits', () => {
    const v = pinchView({ scale: 1, tx: 0, ty: 0 }, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 10000, { min: 0.5, max: 4 });
    expect(v.scale).toBe(4);
  });
});

describe('zoom steps', () => {
  const limits = { min: 0.2, max: 16 };
  it('steps up and down through presets', () => {
    expect(stepZoom(1, 1, limits)).toBe(1.25);
    expect(stepZoom(1, -1, limits)).toBe(0.8);
    expect(stepZoom(0.9, 1, limits)).toBe(1);
  });
  it('clamps to limits', () => {
    expect(stepZoom(0.21, -1, limits)).toBe(0.2);
    expect(stepZoom(16, 1, limits)).toBe(16);
  });
  it('scaleLimits allows zooming out to half of fit', () => {
    const l = scaleLimits(img, { width: 800, height: 600 }, 0);
    expect(l.min).toBeCloseTo(0.25, 6);
    expect(l.max).toBe(16);
  });
  it('wheel factor zooms in for negative delta and is bounded', () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelZoomFactor(-1e6, 0, true)).toBeCloseTo(Math.E, 6);
  });
});

describe('layoutPanes', () => {
  it('single pane fills the stage', () => {
    const l = layoutPanes({ width: 800, height: 600 }, false);
    expect(l.original).toBeNull();
    expect(l.design).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
  it('splits side by side on landscape stages', () => {
    const l = layoutPanes({ width: 802, height: 600 }, true, 2);
    expect(l.orientation).toBe('horizontal');
    expect(l.original).toEqual({ x: 0, y: 0, width: 400, height: 600 });
    expect(l.design).toEqual({ x: 402, y: 0, width: 400, height: 600 });
    expect(paneAt(l, 10, 10).which).toBe('original');
    expect(paneAt(l, 500, 10).which).toBe('design');
  });
  it('stacks on portrait stages', () => {
    const l = layoutPanes({ width: 360, height: 642 }, true, 2);
    expect(l.orientation).toBe('vertical');
    expect(l.original?.height).toBe(320);
    expect(l.design.y).toBe(322);
  });
});
