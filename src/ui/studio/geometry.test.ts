import { describe, expect, it } from 'vitest';
import type { ScenePath, SceneZone } from '../../../shared/types';
import {
  bestGridColumns,
  boundsOf,
  clampPan,
  distToPolyline,
  fitView,
  hitTestScene,
  interiorPoint,
  placeLabel,
  pointAlong,
  pointInPolygon,
  polygonArea,
  toPhoto,
  toScreen,
  zoomAt,
} from './geometry';

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const zone = (id: string, polygon: { x: number; y: number }[], extra: Partial<SceneZone> = {}): SceneZone => ({
  id,
  kind: 'other',
  label: id,
  description: '',
  polygon,
  editable: true,
  ...extra,
});

describe('view transform', () => {
  it('fits and round-trips photo <-> screen', () => {
    const v = fitView({ width: 1600, height: 1200 }, { width: 900, height: 600 }, 20);
    expect(v.scale).toBeCloseTo(560 / 1200);
    const s = toScreen(v, 800, 600);
    expect(s.x).toBeCloseTo(450);
    expect(s.y).toBeCloseTo(300);
    const p = toPhoto(v, s.x, s.y);
    expect(p.x).toBeCloseTo(800);
    expect(p.y).toBeCloseTo(600);
  });

  it('zooms around a fixed screen point', () => {
    const v = { scale: 0.5, tx: 10, ty: 20 };
    const before = toPhoto(v, 300, 200);
    const z = zoomAt(v, 2, 300, 200);
    const after = toPhoto(z, 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('keeps part of the image on screen when panning', () => {
    const v = clampPan({ scale: 1, tx: -5000, ty: 9000 }, { width: 1000, height: 800 }, { width: 600, height: 400 }, 40);
    expect(v.tx).toBe(40 - 1000);
    expect(v.ty).toBe(400 - 40);
  });
});

describe('polygons', () => {
  it('point in polygon handles concave shapes', () => {
    // C shape opening to the right
    const c = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 7 },
      { x: 10, y: 7 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 1, y: 5 }, c)).toBe(true);
    expect(pointInPolygon({ x: 6, y: 5 }, c)).toBe(false);
    expect(pointInPolygon({ x: 8, y: 1 }, c)).toBe(true);
    const p = interiorPoint(c);
    expect(pointInPolygon(p, c)).toBe(true);
  });

  it('area, bounds and distances', () => {
    expect(polygonArea(rect(0, 0, 4, 5))).toBe(20);
    expect(boundsOf(rect(2, 3, 4, 5))).toEqual({ x: 2, y: 3, width: 4, height: 5 });
    expect(
      distToPolyline({ x: 5, y: 3 }, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(3);
    const mid = pointAlong(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      0.75,
    );
    expect(mid.p).toEqual({ x: 10, y: 5 });
    expect(mid.angle).toBeCloseTo(Math.PI / 2);
  });
});

describe('hitTestScene', () => {
  const facade = zone('facade', rect(0, 0, 100, 100));
  const door = zone('door', rect(40, 50, 20, 50));
  const walk: ScenePath = {
    id: 'walk',
    label: 'Walk',
    from: 'drive',
    to: 'door',
    description: '',
    points: [
      { x: 0, y: 150 },
      { x: 100, y: 150 },
    ],
    widthPx: 20,
    kind: 'existing',
  };

  it('prefers the most specific zone', () => {
    expect(hitTestScene({ x: 50, y: 70 }, [facade, door], [], { pathSlop: 2 })).toEqual({ kind: 'zone', id: 'door' });
    expect(hitTestScene({ x: 10, y: 10 }, [facade, door], [], { pathSlop: 2 })).toEqual({ kind: 'zone', id: 'facade' });
    expect(hitTestScene({ x: 500, y: 500 }, [facade, door], [], { pathSlop: 2 })).toBeNull();
  });

  it('hits paths near their centerline before zones', () => {
    const lawn = zone('lawn', rect(0, 120, 100, 60));
    expect(hitTestScene({ x: 50, y: 155 }, [lawn], [walk], { pathSlop: 2 })).toEqual({ kind: 'path', id: 'walk' });
    expect(hitTestScene({ x: 50, y: 175 }, [lawn], [walk], { pathSlop: 2 })).toEqual({ kind: 'zone', id: 'lawn' });
  });

  it('uses a refined mask when one is loaded', () => {
    const refined = zone('bed', rect(0, 0, 10, 10), { maskId: 'm1' });
    const maskAt = (_z: SceneZone, x: number) => (x > 50 ? 255 : 0);
    expect(hitTestScene({ x: 60, y: 60 }, [refined], [], { pathSlop: 0, maskAt })).toEqual({ kind: 'zone', id: 'bed' });
    expect(hitTestScene({ x: 5, y: 5 }, [refined], [], { pathSlop: 0, maskAt })).toBeNull();
    // Not loaded → polygon.
    expect(hitTestScene({ x: 5, y: 5 }, [refined], [], { pathSlop: 0, maskAt: () => undefined })).toEqual({ kind: 'zone', id: 'bed' });
  });
});

describe('placeLabel', () => {
  const stage = { width: 1000, height: 700 };
  const label = { width: 200, height: 60 };
  const overlaps = (p: { x: number; y: number }, t: { x: number; y: number; width: number; height: number }) =>
    p.x < t.x + t.width && p.x + label.width > t.x && p.y < t.y + t.height && p.y + label.height > t.y;

  it('sits above the zone when there is room', () => {
    const t = { x: 400, y: 300, width: 200, height: 100 };
    const p = placeLabel(t, label, stage);
    expect(p.y + label.height).toBeLessThanOrEqual(t.y);
    expect(overlaps(p, t)).toBe(false);
  });

  it('moves below a zone touching the top edge', () => {
    const t = { x: 400, y: 0, width: 200, height: 100 };
    const p = placeLabel(t, label, stage);
    expect(p.y).toBeGreaterThanOrEqual(t.y + t.height);
    expect(overlaps(p, t)).toBe(false);
  });

  it('goes beside a zone spanning the full height', () => {
    const t = { x: 100, y: 0, width: 300, height: 700 };
    const p = placeLabel(t, label, stage);
    expect(overlaps(p, t)).toBe(false);
    expect(p.x).toBeGreaterThanOrEqual(t.x + t.width);
  });

  it('stays inside the stage when the zone covers everything', () => {
    const t = { x: 0, y: 0, width: 1000, height: 700 };
    const p = placeLabel(t, label, stage, { focus: { x: 50, y: 50 } });
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + label.width).toBeLessThanOrEqual(stage.width);
    expect(p.y + label.height).toBeLessThanOrEqual(stage.height);
    // Far from the pointer.
    expect(p.x).toBeGreaterThan(500);
    expect(p.y).toBeGreaterThan(300);
  });
});

describe('bestGridColumns', () => {
  it('chooses the layout with the largest images', () => {
    expect(bestGridColumns(1, 1000, 600, 4 / 3, 8)).toBe(1);
    expect(bestGridColumns(2, 1600, 600, 4 / 3, 8)).toBe(2);
    expect(bestGridColumns(4, 1200, 900, 4 / 3, 8)).toBe(2);
    expect(bestGridColumns(4, 2400, 500, 4 / 3, 8)).toBe(4);
    expect(bestGridColumns(6, 1500, 800, 4 / 3, 8)).toBe(3);
  });
});

describe('freehand helpers', () => {
  it('simplifies nearly straight strokes', async () => {
    const { simplifyPolyline, nearEndIndex, normalAt } = await import('./geometry');
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i % 2 === 0 ? 0 : 0.2 }));
    const s = simplifyPolyline(pts, 1);
    expect(s).toHaveLength(2);
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPolyline(corner, 1).map((p) => p.x)).toEqual([0, 10, 10]);
    expect(
      nearEndIndex([
        { x: 0, y: 5 },
        { x: 0, y: 50 },
        { x: 0, y: 20 },
      ]),
    ).toBe(1);
    const n = normalAt(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      0,
    );
    expect(n.x).toBeCloseTo(0);
    expect(Math.abs(n.y)).toBeCloseTo(1);
  });
});
