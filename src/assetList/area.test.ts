import { describe, expect, it } from 'vitest';
import type { AssetDef, Calibration, Pt, Region } from '../../shared/types';
import { createMask, fillPolygon } from '../engine/mask';
import type { Mask } from '../engine/types';
import { defaultObjectHeightPx, pxPerFoot, regionAreaSqFt } from './area';

const W = 600;
const H = 400;

function region(extra: Partial<Region> = {}): Region {
  return { id: 'r', name: 'Floor', surface: 'floor', maskId: 'm', color: '#f00', createdAt: 0, ...extra };
}

function maskOf(points: Pt[], w = W, h = H): Mask {
  const m = createMask(w, h);
  fillPolygon(m, points, 'add');
  return m;
}

/**
 * A synthetic camera looking at a 10 × 10 ft floor: X across (0..10 ft), Y away
 * from the camera (0..10 ft). Depth z = 10 + Y; horizon at image y = 50.
 */
function project(X: number, Y: number): Pt {
  const z = 10 + Y;
  return { x: 300 + (400 * (X - 5)) / z, y: 50 + 3000 / z };
}

/** Clockwise quad (top-left first) of the real rectangle [x0,x1]×[y0,y1] ft. */
function realRect(x0: number, x1: number, y0: number, y1: number): [Pt, Pt, Pt, Pt] {
  return [project(x0, y1), project(x1, y1), project(x1, y0), project(x0, y0)];
}

const cal = (lengthFt: number, px: number): Calibration => ({ a: { x: 10, y: 10 }, b: { x: 10 + px, y: 10 }, lengthFt });

describe('pxPerFoot', () => {
  it('divides the line length by its real length', () => {
    expect(pxPerFoot(cal(5, 100))).toBe(20);
    expect(pxPerFoot({ a: { x: 0, y: 0 }, b: { x: 30, y: 40 }, lengthFt: 10 })).toBe(5);
  });
  it('is null without a usable calibration', () => {
    expect(pxPerFoot(undefined)).toBeNull();
    expect(pxPerFoot(cal(0, 100))).toBeNull();
    expect(pxPerFoot(cal(-2, 100))).toBeNull();
    expect(pxPerFoot(cal(3, 0))).toBeNull();
    expect(pxPerFoot(cal(Number.NaN, 100))).toBeNull();
  });
});

describe('regionAreaSqFt', () => {
  const photo = { width: W, height: H };

  it('prefers a manual override', () => {
    expect(regionAreaSqFt(region({ areaSqFtOverride: 123 }), undefined, photo)).toEqual({ sqft: 123, method: 'override' });
  });

  it('returns none without a mask or any measurement', () => {
    expect(regionAreaSqFt(region(), undefined, photo)).toEqual({ sqft: null, method: 'none' });
    expect(regionAreaSqFt(region(), createMask(W, H), photo)).toEqual({ sqft: null, method: 'none' });
  });

  it('uses calibration as a flat-on approximation (with partial coverage)', () => {
    const m = createMask(W, H);
    m.data.fill(255, 0, 100 * W); // 100 rows → 60 000 px
    const r = regionAreaSqFt(region(), m, { ...photo, calibration: cal(1, 20) }); // 400 px per sq ft
    expect(r.method).toBe('calibration');
    expect(r.sqft).toBeCloseTo(150, 6);
    m.data.fill(51, 0, 100 * W); // 20 % coverage
    expect(regionAreaSqFt(region(), m, { ...photo, calibration: cal(1, 20) }).sqft).toBeCloseTo(30, 6);
  });

  it('scales masks stored at a different resolution than the photo', () => {
    const m = createMask(W / 2, H / 2);
    m.data.fill(255, 0, 50 * (W / 2)); // = 100 photo rows
    expect(regionAreaSqFt(region(), m, { ...photo, calibration: cal(1, 20) }).sqft).toBeCloseTo(150, 6);
  });

  it('plane without perspective: coverage share × real quad area', () => {
    const quad: [Pt, Pt, Pt, Pt] = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }];
    const plane = { quad, widthFt: 10, heightFt: 5 };
    const full = maskOf(quad);
    expect(regionAreaSqFt(region({ plane }), full, photo).method).toBe('plane');
    expect(regionAreaSqFt(region({ plane }), full, photo).sqft).toBeCloseTo(50, 0);
    const half = maskOf([{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }]);
    expect(regionAreaSqFt(region({ plane }), half, photo).sqft).toBeCloseTo(25, 0);
  });

  it('plane with perspective weights far pixels correctly', () => {
    const plane = { quad: realRect(0, 10, 0, 10), widthFt: 10, heightFt: 10 };
    const full = regionAreaSqFt(region({ plane }), maskOf(plane.quad), photo);
    expect(full.method).toBe('plane');
    expect(full.sqft!).toBeGreaterThan(97);
    expect(full.sqft!).toBeLessThan(103);
    // The far half of the floor is half the area even though it is ~26 % of the pixels.
    const farHalf = regionAreaSqFt(region({ plane }), maskOf(realRect(0, 10, 5, 10)), photo);
    expect(farHalf.sqft!).toBeGreaterThan(48);
    expect(farHalf.sqft!).toBeLessThan(52);
  });

  it('extrapolates a small reference plane over the whole mask', () => {
    const plane = { quad: realRect(4, 6, 4, 6), widthFt: 2, heightFt: 2 };
    const r = regionAreaSqFt(region({ plane }), maskOf(realRect(0, 10, 0, 10)), photo);
    expect(r.sqft!).toBeGreaterThan(96);
    expect(r.sqft!).toBeLessThan(104);
  });

  it('ignores masked pixels beyond the horizon and caps near-horizon blow-ups', () => {
    const plane = { quad: realRect(0, 10, 0, 10), widthFt: 10, heightFt: 10 };
    const floor = maskOf(plane.quad);
    const base = regionAreaSqFt(region({ plane }), floor, photo).sqft!;
    const sky = maskOf(plane.quad);
    sky.data.fill(255, 0, 40 * W); // rows above the horizon (y < 50)
    expect(regionAreaSqFt(region({ plane }), sky, photo).sqft).toBeCloseTo(base, 6);
    const nearHorizon = maskOf(plane.quad);
    nearHorizon.data.fill(255, 51 * W, 52 * W); // one row just below the horizon
    const capped = regionAreaSqFt(region({ plane }), nearHorizon, photo).sqft!;
    expect(Number.isFinite(capped)).toBe(true);
    expect(capped).toBeGreaterThan(base);
    expect(capped).toBeLessThan(base + 600 * 4 * 0.05); // ≤ 4× the largest in-quad pixel area per pixel
  });

  it('falls back to calibration when the plane has no real size or is degenerate', () => {
    const m = maskOf([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]);
    const calibrated = { ...photo, calibration: cal(1, 10) };
    const noSize = region({ plane: { quad: realRect(0, 10, 0, 10) } });
    expect(regionAreaSqFt(noSize, m, calibrated)).toMatchObject({ method: 'calibration' });
    expect(regionAreaSqFt(noSize, m, calibrated).sqft).toBeCloseTo(200, 0);
    const flat: [Pt, Pt, Pt, Pt] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];
    expect(regionAreaSqFt(region({ plane: { quad: flat, widthFt: 4, heightFt: 4 } }), m, calibrated).method).toBe('calibration');
    expect(regionAreaSqFt(noSize, m, photo)).toEqual({ sqft: null, method: 'none' });
  });
});

describe('defaultObjectHeightPx', () => {
  const asset = (extra: Partial<AssetDef>): AssetDef => ({
    id: 'a', name: 'A', category: 'decor', source: 'builtin', aspect: 1, realHeightFt: 3, tags: [], ...extra,
  });
  const plant = (type: NonNullable<AssetDef['plant']>['type']): AssetDef =>
    asset({ category: 'plant', plant: { type, sun: ['full-sun'], water: 'medium', matureHeightFt: 4, matureWidthFt: 4, evergreen: true, indoor: false } });

  it('uses real height × px per foot when calibrated', () => {
    expect(defaultObjectHeightPx(asset({ realHeightFt: 3 }), { width: 1000, height: 800, calibration: cal(1, 50) })).toBe(150);
  });

  it('falls back to category fractions of the photo height', () => {
    const photo = { width: 1000, height: 1000 };
    expect(defaultObjectHeightPx(plant('tree'), photo)).toBe(450);
    expect(defaultObjectHeightPx(plant('shrub'), photo)).toBe(180);
    expect(defaultObjectHeightPx(plant('perennial'), photo)).toBe(100);
    expect(defaultObjectHeightPx(asset({ category: 'lighting' }), photo)).toBe(80);
    expect(defaultObjectHeightPx(asset({ category: 'decor' }), photo)).toBe(150);
    expect(defaultObjectHeightPx(asset({ category: 'plant', tags: ['shade', 'tree'] }), photo)).toBe(450);
  });

  it('ignores calibration for assets without a real height and clamps to sane sizes', () => {
    const photo = { width: 1000, height: 1000, calibration: cal(1, 50) };
    expect(defaultObjectHeightPx(asset({ realHeightFt: 0 }), photo)).toBe(150);
    expect(defaultObjectHeightPx(asset({ realHeightFt: 0.01 }), photo)).toBe(10);
    expect(defaultObjectHeightPx(asset({ realHeightFt: 400 }), photo)).toBe(1500);
  });
});
