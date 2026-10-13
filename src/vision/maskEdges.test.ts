import { describe, expect, it } from 'vitest';
import { signedArea2 } from './contours';
import { deepestPoint, downsampleMask, hasEdges, maskEdges } from './maskEdges';

function grid(width: number, height: number, on: (x: number, y: number) => boolean) {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (on(x, y)) data[y * width + x] = 255;
  return { width, height, data };
}

const bbox = (ring: { x: number; y: number }[]) => ({
  x0: Math.min(...ring.map((p) => p.x)),
  y0: Math.min(...ring.map((p) => p.y)),
  x1: Math.max(...ring.map((p) => p.x)),
  y1: Math.max(...ring.map((p) => p.y)),
});

describe('maskEdges', () => {
  it('traces a square with a hole as one outer ring and one hole', () => {
    const m = grid(100, 80, (x, y) => x >= 10 && x < 90 && y >= 10 && y < 70 && !(x >= 40 && x < 60 && y >= 30 && y < 50));
    const e = maskEdges(m);
    expect(e.outer).toHaveLength(1);
    expect(e.holes).toHaveLength(1);
    expect(bbox(e.outer[0])).toEqual({ x0: 10, y0: 10, x1: 90, y1: 70 });
    expect(bbox(e.holes[0])).toEqual({ x0: 40, y0: 30, x1: 60, y1: 50 });
    // outer clockwise on screen, hole counter-clockwise
    expect(signedArea2(e.outer[0])).toBeGreaterThan(0);
    expect(signedArea2(e.holes[0])).toBeLessThan(0);
  });

  it('keeps every significant part, largest first, and drops specks', () => {
    const m = grid(200, 100, (x, y) => (x >= 5 && x < 95 && y >= 5 && y < 95) || (x >= 120 && x < 160 && y >= 20 && y < 60) || (x === 190 && y === 90));
    const e = maskEdges(m);
    expect(e.outer).toHaveLength(2);
    expect(bbox(e.outer[0])).toEqual({ x0: 5, y0: 5, x1: 95, y1: 95 });
    expect(bbox(e.outer[1])).toEqual({ x0: 120, y0: 20, x1: 160, y1: 60 });
    expect(e.holes).toHaveLength(0);
  });

  it('ignores background enclosed by nothing (touching the border) and empty masks', () => {
    expect(maskEdges(grid(50, 50, () => false))).toEqual({ outer: [], holes: [], labelPoint: null });
    expect(hasEdges(maskEdges(grid(50, 50, () => false)))).toBe(false);
    // a U shape: the notch touches the border, so it is not a hole
    const u = maskEdges(grid(60, 60, (x, y) => x >= 10 && x < 50 && y >= 10 && !(x >= 25 && x < 35 && y >= 30)));
    expect(u.outer).toHaveLength(1);
    expect(u.holes).toHaveLength(0);
  });

  it('downsamples large masks and maps the edges back to photo px', () => {
    const w = 4000;
    const h = 3000;
    const m = grid(w, h, (x, y) => x >= 1000 && x < 3000 && y >= 600 && y < 2400);
    const { grid: small, factor } = downsampleMask(m, 1024);
    expect(factor).toBe(4);
    expect(small.width).toBe(1000);
    expect(small.height).toBe(750);
    const e = maskEdges(m);
    expect(e.outer).toHaveLength(1);
    const b = bbox(e.outer[0]);
    for (const [got, want] of [
      [b.x0, 1000],
      [b.y0, 600],
      [b.x1, 3000],
      [b.y1, 2400],
    ]) {
      expect(Math.abs(got - want)).toBeLessThanOrEqual(factor);
    }
    // a simplified rectangle: a handful of vertices, not thousands
    expect(e.outer[0].length).toBeLessThan(12);
  });

  it('puts the label point deep inside the mask, never in a hole', () => {
    // A ring: the centre of its bounding box is the hole.
    const ring = grid(100, 100, (x, y) => {
      const r = Math.hypot(x + 0.5 - 50, y + 0.5 - 50);
      return r <= 45 && r >= 25;
    });
    const p = maskEdges(ring).labelPoint!;
    const r = Math.hypot(p.x - 50, p.y - 50);
    expect(r).toBeGreaterThan(30);
    expect(r).toBeLessThan(40);
    // A rectangle: its centre.
    const c = deepestPoint(grid(40, 20, (x, y) => x >= 10 && x < 30 && y >= 4 && y < 16))!;
    expect(Math.abs(c.x - 20)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.y - 10)).toBeLessThanOrEqual(1);
    expect(deepestPoint(grid(5, 5, () => false))).toBeNull();
    // Scaled back to photo px for a downsampled mask.
    const big = maskEdges(grid(4000, 3000, (x, y) => x >= 1000 && x < 3000 && y >= 600 && y < 2400)).labelPoint!;
    expect(Math.abs(big.x - 2000)).toBeLessThan(40);
    expect(Math.abs(big.y - 1500)).toBeLessThan(40);
  });

  it('averages partial coverage when downsampling (half-covered blocks stay at the edge)', () => {
    const m = grid(8, 2, (x) => x < 4);
    const { grid: small, factor } = downsampleMask(m, 2);
    expect(factor).toBe(4);
    expect(Array.from(small.data as Uint8Array)).toEqual([255, 0]);
    const half = downsampleMask(grid(4, 4, (x) => x < 2), 1);
    expect(Array.from(half.grid.data as Uint8Array)).toEqual([128]);
  });
});
