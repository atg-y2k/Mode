import { describe, expect, it } from 'vitest';
import type { Pt, SceneZone, ZoneKind } from '../../shared/types';
import { deepestPoint, elongation, negativePoints, pointInPolygon, polygonBox, promptPointCount, sampleInteriorPoints, zonePrompt } from './prompts';

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const zone = (id: string, kind: ZoneKind, polygon: Pt[]): Pick<SceneZone, 'id' | 'kind' | 'polygon'> => ({ id, kind, polygon });

/** Distance from p to the polygon's boundary. */
function edgeDistance(p: Pt, poly: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    d = Math.min(d, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return d;
}

describe('sampleInteriorPoints', () => {
  it('spreads points inside the shrunk polygon, deepest first', () => {
    const poly = rect(100, 100, 400, 200);
    const pts = sampleInteriorPoints(poly, 4, { shrink: 0.35 });
    expect(pts).toHaveLength(4);
    // First point: the pole of inaccessibility (center line of the rectangle).
    expect(Math.abs(pts[0].y - 200)).toBeLessThan(8);
    for (const p of pts) {
      expect(pointInPolygon(p, poly)).toBe(true);
      expect(edgeDistance(p, poly)).toBeGreaterThanOrEqual(0.35 * 100 - 8);
    }
    let minSep = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minSep = Math.min(minSep, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    expect(minSep).toBeGreaterThan(60);
  });

  it('stays inside concave shapes where the centroid is outside', () => {
    const L: Pt[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 160 },
      { x: 200, y: 160 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];
    const pts = sampleInteriorPoints(L, 5);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (const p of pts) expect(pointInPolygon(p, L)).toBe(true);
  });

  it('avoids excluded holes', () => {
    const outer = rect(0, 0, 300, 300);
    const hole = rect(100, 100, 100, 100);
    const pts = sampleInteriorPoints(outer, 5, { exclude: [hole] });
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) expect(pointInPolygon(p, hole)).toBe(false);
  });

  it('spreads points along thin, long shapes', () => {
    const strip = rect(0, 0, 400, 16);
    const pts = sampleInteriorPoints(strip, 3);
    expect(pts).toHaveLength(3);
    for (const p of pts) expect(pointInPolygon(p, strip)).toBe(true);
    const xs = pts.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(200);
  });


  it('returns nothing for degenerate input', () => {
    expect(sampleInteriorPoints([{ x: 0, y: 0 }], 3)).toEqual([]);
    expect(sampleInteriorPoints(rect(0, 0, 10, 10), 0)).toEqual([]);
  });
});

describe('boxes and counts', () => {
  it('pads and clamps the prompt box', () => {
    expect(polygonBox(rect(10, 10, 100, 50), 0.1, 1000, 1000)).toEqual({ x: 0, y: 5, w: 120, h: 60 });
    const clamped = polygonBox(rect(950, 950, 100, 100), 0.1, 1000, 1000);
    expect(clamped.x + clamped.w).toBe(1000);
    expect(clamped.y + clamped.h).toBe(1000);
  });

  it('asks for more clicks on large and long zones', () => {
    expect(promptPointCount(rect(0, 0, 20, 20), 1000, 1000)).toBe(1);
    expect(promptPointCount(rect(0, 0, 150, 150), 1000, 1000)).toBe(2);
    expect(promptPointCount(rect(0, 0, 700, 700), 1000, 1000)).toBe(5);
    expect(promptPointCount(rect(0, 0, 600, 40), 1000, 1000)).toBe(3);
    expect(elongation(rect(0, 0, 600, 40))).toBe(15);
  });
});

describe('negatives from neighbours', () => {
  const W = 1000;
  const H = 800;

  it('carves nested zones out of their container (bed inside the lawn)', () => {
    const lawn = zone('lawn', 'lawn', rect(0, 400, 1000, 400));
    const bed = zone('bed', 'planting-bed', rect(100, 500, 200, 100));
    const neg = negativePoints(lawn, [lawn, bed], polygonBox(lawn.polygon, 0.04, W, H));
    expect(neg).toHaveLength(1);
    expect(pointInPolygon(neg[0], bed.polygon)).toBe(true);
  });

  it('uses the surrounding facade outside a window', () => {
    const facade = zone('f', 'facade', rect(100, 100, 800, 400));
    const win = zone('w', 'windows', rect(300, 200, 100, 120));
    const neg = negativePoints(win, [facade, win], polygonBox(win.polygon, 0.04, W, H));
    expect(neg).toHaveLength(1);
    expect(pointInPolygon(neg[0], facade.polygon)).toBe(true);
    expect(pointInPolygon(neg[0], win.polygon)).toBe(false);
  });

  it('never carves parts out of a container (shrubs in a planting bed) or uses the same kind', () => {
    const bed = zone('bed', 'planting-bed', rect(0, 0, 400, 200));
    const shrubs = zone('s', 'shrubs', rect(50, 50, 80, 80));
    const bed2 = zone('bed2', 'planting-bed', rect(400, 0, 300, 200));
    expect(negativePoints(bed, [bed, shrubs, bed2], polygonBox(bed.polygon, 0.04, W, H))).toEqual([]);
  });

  it('prefers adjacent neighbours over far ones and puts holes first', () => {
    const facade = zone('f', 'facade', rect(200, 200, 600, 300));
    const roof = zone('roof', 'roof', rect(200, 120, 600, 80));
    const sky = zone('sky', 'sky', rect(0, 0, 1000, 120));
    const lawn = zone('lawn', 'lawn', rect(0, 500, 1000, 300));
    const w1 = zone('w1', 'windows', rect(300, 300, 60, 80));
    const w2 = zone('w2', 'windows', rect(500, 300, 60, 80));
    const w3 = zone('w3', 'windows', rect(650, 300, 60, 80));
    const neg = negativePoints(facade, [sky, facade, roof, lawn, w1, w2, w3], polygonBox(facade.polygon, 0.3, W, H), { max: 4 });
    expect(neg).toHaveLength(4);
    expect([w1, w2, w3].filter((w) => pointInPolygon(neg[0], w.polygon) || pointInPolygon(neg[1], w.polygon))).toHaveLength(2);
    expect(pointInPolygon(neg[2], roof.polygon)).toBe(true);
    expect(neg.some((p) => pointInPolygon(p, sky.polygon))).toBe(false);
  });

  it('prefers neighbours inside the prompt box and ignores far ones', () => {
    const walk = zone('walk', 'walkway', rect(450, 400, 100, 400));
    const lawnL = zone('l', 'lawn', rect(0, 400, 450, 400));
    const lawnR = zone('r', 'lawn', rect(550, 400, 450, 400));
    const sky = zone('sky', 'sky', rect(0, 0, 1000, 80));
    const neg = negativePoints(walk, [walk, lawnL, lawnR, sky], polygonBox(walk.polygon, 0.04, W, H));
    expect(neg).toHaveLength(2);
    for (const p of neg) expect(pointInPolygon(p, walk.polygon)).toBe(false);
    expect(neg.some((p) => pointInPolygon(p, sky.polygon))).toBe(false);
  });

  it('limits the number of negatives', () => {
    const center = zone('c', 'patio', rect(300, 300, 200, 200));
    const around = [rect(200, 300, 100, 200), rect(500, 300, 100, 200), rect(300, 200, 200, 100), rect(300, 500, 200, 100)].map((p, i) =>
      zone(`n${i}`, (['lawn', 'planting-bed', 'facade', 'walkway'] as ZoneKind[])[i], p),
    );
    expect(negativePoints(center, [center, ...around], polygonBox(center.polygon, 0.04, W, H), { max: 3 })).toHaveLength(3);
  });
});

describe('zonePrompt', () => {
  it('puts positives in the zone (not in its holes) and negatives outside it', () => {
    const facade = zone('f', 'facade', rect(100, 100, 800, 400));
    const win = zone('w', 'windows', rect(300, 200, 100, 120));
    const door = zone('d', 'front-door', rect(600, 300, 80, 200));
    const p = zonePrompt(facade, [facade, win, door], 1000, 800);
    expect(p.positive.length).toBeGreaterThanOrEqual(3);
    for (const q of p.positive) {
      expect(pointInPolygon(q, facade.polygon)).toBe(true);
      expect(pointInPolygon(q, win.polygon)).toBe(false);
      expect(pointInPolygon(q, door.polygon)).toBe(false);
    }
    expect(p.negative).toHaveLength(2);
    expect(p.box.x).toBeLessThan(100);
    expect(p.box.x + p.box.w).toBeGreaterThan(900);
  });

  it('finds the deepest point of a region minus an excluded one', () => {
    const hit = deepestPoint(rect(0, 0, 200, 100), [rect(0, 0, 100, 100)]);
    expect(hit).not.toBeNull();
    expect(hit!.pt.x).toBeGreaterThan(100);
    expect(hit!.clearance).toBeGreaterThan(30);
    expect(deepestPoint(rect(0, 0, 10, 10), [rect(-5, -5, 30, 30)])).toBeNull();
  });
});
