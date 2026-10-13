import { describe, expect, it } from 'vitest';
import type { Pt } from '../../shared/types';
import { douglasPeucker, joinRings, labelComponents, largestContour, maskContours, signedArea2, simplifyClosed, traceOutline, zonePolygon } from './contours';
import { pointInPolygon } from './prompts';

function grid(width: number, height: number, on: (x: number, y: number) => boolean) {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (on(x, y)) data[y * width + x] = 255;
  return { width, height, data };
}

const area = (ring: Pt[]) => Math.abs(signedArea2(ring)) / 2;

describe('labelComponents', () => {
  it('finds separate blobs with their areas and bounds', () => {
    const g = grid(20, 10, (x, y) => (x >= 1 && x <= 4 && y >= 1 && y <= 3) || (x >= 10 && x <= 18 && y >= 5 && y <= 9));
    const { components, labels } = labelComponents(g);
    expect(components).toHaveLength(2);
    const [a, b] = components;
    expect(a).toMatchObject({ area: 12, x0: 1, y0: 1, x1: 4, y1: 3, touchesBorder: false });
    expect(b).toMatchObject({ area: 45, x0: 10, y0: 5, x1: 18, y1: 9, touchesBorder: true });
    expect(labels[1 * 20 + 1]).toBe(1);
    expect(labels[0]).toBe(0);
  });

  it('treats diagonal-only contact as separate (4-connectivity)', () => {
    const g = grid(4, 4, (x, y) => (x === 0 && y === 0) || (x === 1 && y === 1));
    expect(labelComponents(g).components).toHaveLength(2);
  });

  it('labels the background when inverted, limited to a region', () => {
    const g = grid(10, 10, (x, y) => x >= 2 && x <= 7 && y >= 2 && y <= 7 && !(x >= 4 && x <= 5 && y >= 4 && y <= 5));
    const holes = labelComponents(g, 128, { invert: true, region: { x: 3, y: 3, w: 4, h: 4 } });
    expect(holes.components).toHaveLength(1);
    expect(holes.components[0].area).toBe(4);
  });
});

describe('traceOutline / maskContours', () => {
  it('traces a rectangle along pixel edges, clockwise, with its exact area', () => {
    const g = grid(40, 20, (x, y) => x >= 10 && x <= 30 && y >= 5 && y <= 15);
    const ring = largestContour(g, { tolerancePx: 0.5 });
    expect(ring).toHaveLength(4);
    expect(signedArea2(ring)).toBeGreaterThan(0);
    expect(area(ring)).toBe(21 * 11);
    const xs = ring.map((p) => p.x).sort((a, b) => a - b);
    const ys = ring.map((p) => p.y).sort((a, b) => a - b);
    expect(xs[0]).toBe(10);
    expect(xs[3]).toBe(31);
    expect(ys[0]).toBe(5);
    expect(ys[3]).toBe(16);
  });

  it('traces a single pixel as a unit square', () => {
    const g = grid(3, 3, (x, y) => x === 1 && y === 1);
    const ring = largestContour(g);
    expect(area(ring)).toBe(1);
  });

  it('keeps the corners of a concave L shape', () => {
    const g = grid(30, 30, (x, y) => (x >= 5 && x < 10 && y >= 5 && y < 25) || (x >= 5 && x < 25 && y >= 20 && y < 25));
    const ring = largestContour(g, { tolerancePx: 0.5 });
    expect(ring).toHaveLength(6);
    expect(area(ring)).toBe(5 * 20 + 15 * 5);
  });

  it('simplifies a disc to a compact polygon with nearly the same area', () => {
    const r = 60;
    const g = grid(160, 160, (x, y) => (x + 0.5 - 80) ** 2 + (y + 0.5 - 80) ** 2 <= r * r);
    let pixels = 0;
    for (const v of g.data) if (v) pixels++;
    const ring = largestContour(g, { tolerancePx: 1.5 });
    expect(ring.length).toBeGreaterThan(12);
    expect(ring.length).toBeLessThan(80);
    expect(Math.abs(area(ring) - pixels) / pixels).toBeLessThan(0.03);
  });

  it('returns the outer boundary of the largest component only (holes ignored)', () => {
    const g = grid(50, 50, (x, y) => {
      const inBig = x >= 10 && x < 40 && y >= 10 && y < 40 && !(x >= 20 && x < 30 && y >= 20 && y < 30);
      const small = x >= 1 && x < 4 && y >= 1 && y < 4;
      return inBig || small;
    });
    const rings = maskContours(g, { tolerancePx: 0.5 });
    expect(rings).toHaveLength(2);
    expect(area(rings[0])).toBe(900);
    expect(area(rings[1])).toBe(9);
    expect(maskContours(g, { minArea: 10 })).toHaveLength(1);
  });

  it('terminates on components that touch themselves diagonally', () => {
    // A ring whose corners only touch diagonally plus a checkerboard patch.
    const g = grid(12, 12, (x, y) => (x + y) % 2 === 0 && x >= 2 && x < 10 && y >= 2 && y < 10);
    const rings = maskContours(g);
    expect(rings.length).toBe(32);
    for (const r of rings) expect(area(r)).toBe(1);
  });

  it('handles a U shape whose arms enclose background', () => {
    const g = grid(20, 20, (x, y) => x >= 2 && x < 18 && y >= 2 && y < 18 && !(x >= 6 && x < 14 && y < 14));
    const ring = largestContour(g, { tolerancePx: 0.5 });
    expect(area(ring)).toBe(16 * 16 - 8 * 12);
    expect(ring).toHaveLength(8);
  });

  it('scales coordinates when asked', () => {
    const g = grid(10, 10, (x, y) => x >= 2 && x < 4 && y >= 2 && y < 4);
    const ring = largestContour(g, { scaleX: 10, scaleY: 5 });
    expect(area(ring)).toBe(4 * 50);
  });

  it('returns nothing for an empty mask or a bad start', () => {
    expect(largestContour(grid(5, 5, () => false))).toEqual([]);
    expect(traceOutline(() => false, 0, 0)).toEqual([]);
  });
});

describe('Douglas–Peucker', () => {
  it('drops collinear points of an open polyline', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.05 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ];
    expect(douglasPeucker(pts, 0.2)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ]);
  });

  it('keeps at least a triangle for closed rings', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0.1 },
      { x: 20, y: 0 },
      { x: 10, y: 0.2 },
    ];
    expect(simplifyClosed(ring, 100).length).toBeGreaterThanOrEqual(3);
  });
});

describe('zonePolygon', () => {
  it('keeps every significant part of a split area in one outline', () => {
    // Lawn on both sides of a walk, plus a speck.
    const g = grid(100, 60, (x, y) => (y >= 30 && x < 40) || (y >= 30 && x >= 55) || (x === 2 && y === 2));
    const poly = zonePolygon(g, { tolerancePx: 0.5 });
    expect(pointInPolygon({ x: 10, y: 45 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 80, y: 45 }, poly)).toBe(true);
    // The walk between the parts and the dropped speck stay outside.
    expect(pointInPolygon({ x: 47, y: 45 }, poly)).toBe(false);
    expect(pointInPolygon({ x: 2.5, y: 2.5 }, poly)).toBe(false);
    // Bridges add no area.
    expect(Math.abs(signedArea2(poly)) / 2).toBe(40 * 30 + 45 * 30);
  });

  it('is the plain outline for a single part and empty for an empty mask', () => {
    const g = grid(20, 20, (x, y) => x >= 5 && x < 15 && y >= 5 && y < 15);
    expect(zonePolygon(g, { tolerancePx: 0.5 })).toHaveLength(4);
    expect(zonePolygon(grid(5, 5, () => false))).toEqual([]);
    expect(joinRings([])).toEqual([]);
  });
});
