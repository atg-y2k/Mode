import { describe, expect, it } from 'vitest';
import { emptyBrief, type DesignBrief, type SceneMap, type ScenePath, type SceneZone } from '../../../shared/types';
import { createMask } from '../../engine/mask';
import { blendRadii, briefTargetIds, maskForBrief, maskFromTargets, pathHalfWidthAt, rasterizePath } from './maskFromZones';

const W = 200;
const H = 160;

const square = (id: string, x: number, y: number, s: number, extra: Partial<SceneZone> = {}): SceneZone => ({
  id,
  kind: 'planting-bed',
  label: id,
  description: '',
  polygon: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
  editable: true,
  ...extra,
});

const path = (id: string, points: { x: number; y: number }[], widthPx: number): ScenePath => ({
  id,
  label: id,
  from: '',
  to: '',
  description: '',
  points,
  widthPx,
  kind: 'sketch',
});

function scene(zones: SceneZone[], paths: ScenePath[] = []): SceneMap {
  return {
    category: 'front-yard',
    summary: '',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones,
    paths,
    keep: [],
    opportunities: [],
    createdAt: 0,
    model: 'test',
  };
}

const at = (m: { width: number; data: Uint8Array }, x: number, y: number) => m.data[y * m.width + x];

describe('briefTargetIds', () => {
  it('unions brief targets with element zones/paths and drops unknown ids', () => {
    const sc = scene([square('a', 0, 0, 10), square('b', 20, 0, 10)], [path('p', [{ x: 0, y: 0 }, { x: 5, y: 5 }], 4)]);
    const brief: DesignBrief = {
      ...emptyBrief(),
      targetZoneIds: ['a', 'gone'],
      elements: [
        { id: 'e', type: 'pathway', label: 'Walk', zoneIds: ['b', 'a'], pathIds: ['p', 'nope'], dimensions: [], choices: {}, note: '' },
      ],
    };
    expect(briefTargetIds(brief, sc)).toEqual({ zoneIds: ['a', 'b'], pathIds: ['p'] });
    expect(briefTargetIds(brief, undefined)).toEqual({ zoneIds: [], pathIds: [] });
  });
});

describe('maskFromTargets', () => {
  it('covers zone polygons, grows and feathers the edge', () => {
    const m = maskFromTargets(W, H, [square('a', 50, 40, 60)], [], { grow: 4, feather: 4 });
    expect(m).not.toBeNull();
    const mask = m!;
    expect(at(mask, 80, 70)).toBe(255); // center
    expect(at(mask, 5, 5)).toBe(0); // far away untouched
    expect(at(mask, 47, 70)).toBeGreaterThan(0); // grown past the outline
    // Feathered: some partial coverage exists along the boundary.
    let partial = 0;
    for (let x = 30; x < 60; x++) {
      const v = at(mask, x, 70);
      if (v > 0 && v < 255) partial++;
    }
    expect(partial).toBeGreaterThan(1);
  });

  it('returns null when nothing is targeted', () => {
    expect(maskFromTargets(W, H, [], [])).toBeNull();
    expect(maskFromTargets(W, H, [{ ...square('a', 0, 0, 10), polygon: [] }], [])).toBeNull();
  });

  it('prefers a refined zone mask over the polygon', () => {
    const refined = createMask(W, H);
    for (let y = 100; y < 120; y++) for (let x = 150; x < 170; x++) refined.data[y * W + x] = 255;
    const m = maskFromTargets(W, H, [square('a', 0, 0, 40, { maskId: 'r' })], [], { getMask: () => refined, grow: 0, feather: 0 })!;
    expect(at(m, 160, 110)).toBe(255);
    expect(at(m, 20, 20)).toBe(0);
    // Mask of the wrong size or not loaded → polygon.
    const fallback = maskFromTargets(W, H, [square('a', 0, 0, 40, { maskId: 'r' })], [], { getMask: () => undefined, grow: 0, feather: 0 })!;
    expect(at(fallback, 20, 20)).toBe(255);
  });

  it('buffers paths, wider at the near (lower) end', () => {
    const p = path('walk', [{ x: 100, y: 150 }, { x: 100, y: 60 }], 30);
    expect(pathHalfWidthAt(p, 150, H)).toBeCloseTo(15);
    expect(pathHalfWidthAt(p, 60, H)).toBeLessThan(15);
    const m = createMask(W, H);
    rasterizePath(m, p, H);
    expect(at(m, 100, 150)).toBe(255);
    expect(at(m, 112, 148)).toBe(255); // within near half-width
    expect(at(m, 112, 62)).toBe(0); // the far end is narrower
    expect(at(m, 100, 62)).toBe(255);
  });

  it('blend radii scale with the photo', () => {
    expect(blendRadii(1600, 1200)).toEqual({ grow: 10, feather: 13 });
    expect(blendRadii(100, 80).grow).toBeGreaterThanOrEqual(2);
  });
});

describe('maskForBrief', () => {
  const sc = scene([square('a', 50, 40, 60)]);
  it('is null for whole-image scope or no targets', () => {
    expect(maskForBrief({ width: W, height: H }, sc, { ...emptyBrief(), targetZoneIds: ['a'], scope: 'whole' })).toBeNull();
    expect(maskForBrief({ width: W, height: H }, sc, emptyBrief())).toBeNull();
    expect(maskForBrief({ width: W, height: H }, undefined, { ...emptyBrief(), targetZoneIds: ['a'] })).toBeNull();
  });
  it('covers the targeted zone', () => {
    const m = maskForBrief({ width: W, height: H }, sc, { ...emptyBrief(), targetZoneIds: ['a'] })!;
    expect(m.width).toBe(W);
    expect(at(m, 80, 70)).toBe(255);
  });
});
