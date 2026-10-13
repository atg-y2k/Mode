import { describe, expect, it } from 'vitest';
import type { Pt } from '../../shared/types';
import { polygonArea } from './geometry';
import {
  brushFalloff,
  brushProfile,
  clearMask,
  cloneMask,
  combineMasks,
  copyMaskInto,
  createMask,
  decodeMaskRLE,
  encodeMaskRLE,
  featherMask,
  fillMask,
  fillPolygon,
  growMask,
  invertMask,
  isMaskEmpty,
  maskBounds,
  maskCoverage,
  maskOutline,
  maskToOverlay,
  resizeMask,
  shrinkMask,
  stampBrush,
  strokeBrush,
} from './mask';
import type { Mask } from './types';

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (m: Mask, x: number, y: number) => m.data[y * m.width + x];

function rect(m: Mask, x0: number, y0: number, x1: number, y1: number, v = 255) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.data[y * m.width + x] = v;
}

describe('basics', () => {
  it('creates, clones and copies', () => {
    const m = createMask(5, 3);
    expect(m.width).toBe(5);
    expect(m.height).toBe(3);
    expect(m.data.length).toBe(15);
    expect(createMask(-1, NaN).data.length).toBe(0);
    m.data[4] = 9;
    const c = cloneMask(m);
    c.data[4] = 1;
    expect(m.data[4]).toBe(9);
    copyMaskInto(c, m);
    expect(c.data[4]).toBe(9);
    expect(() => copyMaskInto(createMask(2, 2), m)).toThrow();
  });

  it('coverage, emptiness and bounds', () => {
    const m = createMask(10, 8);
    expect(isMaskEmpty(m)).toBe(true);
    expect(maskBounds(m)).toBeNull();
    expect(maskCoverage(m)).toBe(0);
    m.data[3 * 10 + 7] = 255;
    m.data[5 * 10 + 2] = 51;
    expect(isMaskEmpty(m)).toBe(false);
    expect(maskCoverage(m)).toBeCloseTo(1.2, 10);
    expect(maskBounds(m)).toEqual({ x: 2, y: 3, w: 6, h: 3 });
    fillMask(m);
    expect(maskBounds(m)).toEqual({ x: 0, y: 0, w: 10, h: 8 });
    expect(maskCoverage(m)).toBe(80);
    clearMask(m);
    expect(isMaskEmpty(m)).toBe(true);
    expect(maskBounds(createMask(0, 0))).toBeNull();
  });

  it('isMaskEmpty works on unaligned views', () => {
    const buf = new Uint8Array(23);
    const view = { width: 11, height: 2, data: buf.subarray(1) };
    expect(isMaskEmpty(view)).toBe(true);
    buf[22] = 1; // last byte of the view (tail after the 32-bit words)
    expect(isMaskEmpty(view)).toBe(false);
  });

  it('invert', () => {
    const m = createMask(2, 1);
    m.data[0] = 10;
    invertMask(m);
    expect([...m.data]).toEqual([245, 255]);
  });
});

describe('brushes', () => {
  it('profile: hard brushes keep a ~1px anti-aliased rim, soft ones fall off from the center', () => {
    const hard = brushProfile(10, 1);
    expect(hard.inner).toBeCloseTo(9.5);
    expect(hard.outer).toBeCloseTo(10.5);
    const soft = brushProfile(10, 0);
    expect(soft.inner).toBe(0);
    let prev = 1;
    for (let d = 0; d <= 11; d += 0.25) {
      const v = brushFalloff(d, soft);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    expect(brushFalloff(0, soft)).toBe(1);
    expect(brushFalloff(10.5, soft)).toBe(0);
    // degenerate inputs stay usable
    const tiny = brushProfile(0, NaN);
    expect(tiny.outer).toBeGreaterThan(tiny.inner);
  });

  it('hard stamp covers ≈ πr²', () => {
    const m = createMask(100, 100);
    stampBrush(m, 50, 50, { radius: 20, hardness: 1, mode: 'add' });
    expect(maskCoverage(m)).toBeGreaterThan(Math.PI * 400 * 0.98);
    expect(maskCoverage(m)).toBeLessThan(Math.PI * 400 * 1.02);
    expect(at(m, 50, 50)).toBe(255);
    expect(at(m, 50, 72)).toBe(0);
  });

  it('stamps never exceed their opacity (max-combine)', () => {
    const m = createMask(40, 40);
    const opts = { radius: 10, hardness: 1, mode: 'add' as const, opacity: 0.5 };
    stampBrush(m, 20, 20, opts);
    stampBrush(m, 20, 20, opts);
    stampBrush(m, 21, 20, opts);
    expect(Math.max(...m.data)).toBe(128);
  });

  it('erase min-combines down to 255·(1 − opacity)', () => {
    const m = createMask(40, 40);
    fillMask(m);
    const opts = { radius: 10, hardness: 1, mode: 'erase' as const, opacity: 0.75 };
    stampBrush(m, 20, 20, opts);
    stampBrush(m, 20, 20, opts);
    expect(at(m, 20, 20)).toBe(64);
    stampBrush(m, 20, 20, { radius: 10, hardness: 1, mode: 'erase' });
    expect(at(m, 20, 20)).toBe(0);
    expect(at(m, 0, 0)).toBe(255);
  });

  it('soft brushes fall off toward the rim', () => {
    const m = createMask(64, 64);
    stampBrush(m, 32, 32, { radius: 20, hardness: 0, mode: 'add' });
    const row = Array.from({ length: 25 }, (_, i) => at(m, 32 + i, 32));
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]);
    expect(row[0]).toBeGreaterThan(240);
    expect(row[10]).toBeGreaterThan(50);
    expect(row[10]).toBeLessThan(200);
    expect(row[22]).toBe(0);
  });

  it('only touches the stamp bounding box and survives out-of-bounds / invalid input', () => {
    const m = createMask(50, 50);
    m.data.fill(7);
    stampBrush(m, 10, 10, { radius: 4, hardness: 1, mode: 'add' });
    expect(at(m, 30, 30)).toBe(7);
    expect(at(m, 10, 10)).toBe(255);
    const before = cloneMask(m);
    stampBrush(m, -100, -100, { radius: 5, hardness: 1, mode: 'add' });
    stampBrush(m, NaN, 3, { radius: 5, hardness: 1, mode: 'add' });
    stampBrush(m, 3, 3, { radius: 5, hardness: 1, mode: 'add', opacity: 0 });
    expect(m.data).toEqual(before.data);
    stampBrush(m, -2, 25, { radius: 5, hardness: 1, mode: 'add' }); // partially inside
    expect(at(m, 0, 25)).toBe(255);
    stampBrush(m, 40.5, 40.5, { radius: 0, hardness: 1, mode: 'add' }); // degenerate radius → single pixel
    expect(at(m, 40, 40)).toBe(255);
    expect(at(m, 41, 40)).toBe(7);
  });

  it('strokes cover the segment like dense stamps; zero-length strokes do nothing', () => {
    const m = createMask(100, 40);
    const opts = { radius: 5, hardness: 1, mode: 'add' as const };
    strokeBrush(m, { x: 10, y: 20 }, { x: 90, y: 20 }, opts);
    for (let x = 10; x < 90; x++) expect(at(m, x, 20)).toBe(255);
    expect(at(m, 50, 26)).toBe(0);
    // capsule area ≈ 2r·len + πr²
    expect(maskCoverage(m)).toBeCloseTo(10 * 80 + Math.PI * 25, -1);
    const z = createMask(20, 20);
    strokeBrush(z, { x: 5, y: 5 }, { x: 5, y: 5 }, opts);
    expect(isMaskEmpty(z)).toBe(true);
    // equals stamps along the segment for a hard brush
    const stamps = createMask(100, 40);
    for (let i = 0; i <= 320; i++) stampBrush(stamps, 10 + (80 * i) / 320, 20, opts);
    let diff = 0;
    for (let i = 0; i < m.data.length; i++) diff = Math.max(diff, Math.abs(m.data[i] - stamps.data[i]));
    expect(diff).toBeLessThanOrEqual(2);
  });
});

describe('fillPolygon', () => {
  it('fills an axis-aligned pixel-aligned square exactly', () => {
    const m = createMask(20, 20);
    fillPolygon(m, [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 12 }, { x: 5, y: 12 }], 'add');
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) expect(at(m, x, y)).toBe(x >= 5 && x < 15 && y >= 5 && y < 12 ? 255 : 0);
    }
  });

  it('anti-aliased coverage ≈ polygon area', () => {
    const rnd = mulberry32(5);
    for (let k = 0; k < 10; k++) {
      const n = 3 + Math.floor(rnd() * 6);
      const cx = 100 + rnd() * 20;
      const cy = 100 + rnd() * 20;
      // star-shaped (simple) polygon
      const pts: Pt[] = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
        const r = 30 + rnd() * 60;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      });
      const m = createMask(220, 220);
      fillPolygon(m, pts, 'add');
      const area = polygonArea(pts);
      expect(Math.abs(maskCoverage(m) - area) / area).toBeLessThan(0.005);
      // edge pixels are partial
      expect(m.data.some((v) => v > 0 && v < 255)).toBe(true);
    }
  });

  it('non-antialiased fill is binary with about the same area', () => {
    const m = createMask(100, 100);
    const tri = [{ x: 10.3, y: 10.7 }, { x: 90.2, y: 20.1 }, { x: 40.6, y: 88.8 }];
    fillPolygon(m, tri, 'add', false);
    expect(m.data.every((v) => v === 0 || v === 255)).toBe(true);
    expect(Math.abs(maskCoverage(m) - polygonArea(tri)) / polygonArea(tri)).toBeLessThan(0.02);
  });

  it('uses the even-odd rule and supports erase', () => {
    const m = createMask(60, 60);
    // outer square with an inner square of opposite winding listed as one ring via a bridge-free self-overlap:
    const pentagram: Pt[] = [0, 2, 4, 1, 3].map((i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      return { x: 30 + 25 * Math.cos(a), y: 30 + 25 * Math.sin(a) };
    });
    fillPolygon(m, pentagram, 'add');
    expect(at(m, 30, 30)).toBe(0); // center pentagon is a hole under even-odd
    expect(at(m, 30, 9)).toBe(255); // a star point
    const e = createMask(20, 20);
    fillMask(e);
    fillPolygon(e, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 'erase');
    expect(at(e, 5, 5)).toBe(0);
    expect(at(e, 15, 15)).toBe(255);
  });

  it('clips to the image and ignores degenerate polygons', () => {
    const m = createMask(10, 10);
    fillPolygon(m, [{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }], 'add');
    expect(maskCoverage(m)).toBe(100);
    const d = createMask(10, 10);
    fillPolygon(d, [], 'add');
    fillPolygon(d, [{ x: 1, y: 1 }, { x: 8, y: 8 }], 'add');
    fillPolygon(d, [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 8, y: 8 }], 'add'); // collinear
    fillPolygon(d, [{ x: NaN, y: 1 }, { x: 5, y: NaN }, { x: 8, y: 8 }], 'add');
    fillPolygon(d, [{ x: 1, y: 3 }, { x: 8, y: 3 }, { x: 4, y: 3 }], 'add'); // horizontal only
    expect(isMaskEmpty(d)).toBe(true);
  });
});

describe('feather / grow / shrink', () => {
  it('feather softens edges and roughly preserves coverage; solid areas stay solid', () => {
    const m = createMask(80, 80);
    rect(m, 20, 20, 60, 60);
    featherMask(m, 6);
    expect(Math.abs(maskCoverage(m) - 1600) / 1600).toBeLessThan(0.01);
    expect(at(m, 40, 40)).toBe(255);
    expect(at(m, 20, 40)).toBeGreaterThan(100);
    expect(at(m, 20, 40)).toBeLessThan(160);
    expect(at(m, 17, 40)).toBeGreaterThan(0);
    // full mask touching every border stays full (edges replicate)
    const full = createMask(30, 30);
    fillMask(full);
    featherMask(full, 10);
    expect(full.data.every((v) => v === 255)).toBe(true);
    // large radius path (box blur) behaves too
    const big = createMask(200, 200);
    rect(big, 50, 50, 150, 150);
    featherMask(big, 40);
    expect(Math.abs(maskCoverage(big) - 10000) / 10000).toBeLessThan(0.02);
    expect(at(big, 100, 100)).toBeGreaterThan(245);
    // no-ops
    const e = createMask(10, 10);
    featherMask(e, 5);
    expect(isMaskEmpty(e)).toBe(true);
    const r = createMask(10, 10);
    rect(r, 2, 2, 8, 8);
    const before = cloneMask(r);
    featherMask(r, 0);
    featherMask(r, NaN);
    expect(r.data).toEqual(before.data);
  });

  it('grow and shrink move the edge by the radius', () => {
    const m = createMask(60, 60);
    rect(m, 20, 20, 40, 40);
    growMask(m, 3);
    expect(maskBounds(m)).toEqual({ x: 17, y: 17, w: 26, h: 26 });
    expect(at(m, 17, 30)).toBe(255);
    const s = createMask(60, 60);
    rect(s, 20, 20, 40, 40);
    shrinkMask(s, 3);
    expect(maskBounds(s)).toEqual({ x: 23, y: 23, w: 14, h: 14 });
    // round trip on a convex shape
    const c = createMask(60, 60);
    stampBrush(c, 30, 30, { radius: 12, hardness: 1, mode: 'add' });
    const orig = cloneMask(c);
    growMask(c, 4);
    shrinkMask(c, 4);
    let diff = 0;
    for (let i = 0; i < c.data.length; i++) diff += Math.abs(c.data[i] - orig.data[i]) / 255;
    expect(diff / maskCoverage(orig)).toBeLessThan(0.03);
  });

  it('grow approximates a disc (roughly πr² growth for a point)', () => {
    const m = createMask(61, 61);
    m.data[30 * 61 + 30] = 255;
    growMask(m, 10);
    const ratio = maskCoverage(m) / (Math.PI * 10 * 10);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.16); // lattice count of a radius-10.5 disc is already 1.10
    // roughly round: reaches 10 px along the axes and ~7.5 px along the diagonals
    expect(at(m, 30 + 10, 30)).toBe(255);
    expect(at(m, 30 + 11, 30)).toBe(0);
    expect(at(m, 30 + 7, 30 + 7)).toBe(255);
    expect(at(m, 30 + 8, 30 + 8)).toBe(0);
  });

  it('fractional radii give intermediate edges', () => {
    const m = createMask(30, 10);
    rect(m, 10, 0, 20, 10);
    growMask(m, 1.5);
    expect(at(m, 9, 5)).toBe(255);
    expect(at(m, 8, 5)).toBeGreaterThan(100);
    expect(at(m, 8, 5)).toBeLessThan(160);
    expect(at(m, 7, 5)).toBe(0);
  });

  it('image borders do not erode; empty masks and zero radii are no-ops', () => {
    const full = createMask(20, 20);
    fillMask(full);
    shrinkMask(full, 5);
    expect(full.data.every((v) => v === 255)).toBe(true);
    const e = createMask(20, 20);
    growMask(e, 5);
    shrinkMask(e, 5);
    expect(isMaskEmpty(e)).toBe(true);
    const r = createMask(20, 20);
    rect(r, 5, 5, 15, 15);
    const before = cloneMask(r);
    growMask(r, 0);
    shrinkMask(r, -2);
    growMask(r, NaN);
    expect(r.data).toEqual(before.data);
  });

  it('keeps soft edge profiles when growing (shifted, not hardened)', () => {
    const m = createMask(40, 1);
    for (let x = 0; x < 40; x++) m.data[x] = Math.max(0, Math.min(255, (20 - x) * 40));
    const orig = cloneMask(m);
    growMask(m, 2);
    for (let x = 2; x < 40; x++) expect(m.data[x]).toBe(orig.data[x - 2]);
  });
});

describe('combineMasks', () => {
  it('union / subtract / intersect', () => {
    const a = { width: 4, height: 1, data: new Uint8Array([0, 100, 200, 255]) };
    const b = { width: 4, height: 1, data: new Uint8Array([255, 150, 50, 0]) };
    const u = cloneMask(a);
    combineMasks(u, b, 'union');
    expect([...u.data]).toEqual([255, 150, 200, 255]);
    const s = cloneMask(a);
    combineMasks(s, b, 'subtract');
    expect([...s.data]).toEqual([0, 100, 200, 255]);
    const s2 = { width: 2, height: 1, data: new Uint8Array([255, 255]) };
    combineMasks(s2, { width: 2, height: 1, data: new Uint8Array([255, 55]) }, 'subtract');
    expect([...s2.data]).toEqual([0, 200]);
    const i = cloneMask(a);
    combineMasks(i, b, 'intersect');
    expect([...i.data]).toEqual([0, 100, 50, 0]);
    expect(() => combineMasks(a, createMask(2, 2), 'union')).toThrow();
  });
});

describe('RLE', () => {
  function roundTrip(m: Mask) {
    const enc = encodeMaskRLE(m);
    const dec = decodeMaskRLE(enc, m.width, m.height);
    expect(dec.width).toBe(m.width);
    expect(dec.height).toBe(m.height);
    expect(dec.data.length).toBe(m.data.length);
    // Manual compare: deep equality on megapixel arrays is very slow.
    let firstDiff = -1;
    for (let i = 0; i < m.data.length && firstDiff < 0; i++) if (dec.data[i] !== m.data[i]) firstDiff = i;
    expect(firstDiff).toBe(-1);
    return enc;
  }

  it('round-trips random masks of every flavour', () => {
    const rnd = mulberry32(6);
    for (let k = 0; k < 40; k++) {
      const w = 1 + Math.floor(rnd() * 300);
      const h = 1 + Math.floor(rnd() * 200);
      const m = createMask(w, h);
      const mode = k % 4;
      if (mode === 0) for (let i = 0; i < m.data.length; i++) m.data[i] = Math.floor(rnd() * 256);
      else if (mode === 1) {
        // long runs with random lengths, including > 127 and > 16383
        let i = 0;
        while (i < m.data.length) {
          const len = 1 + Math.floor(rnd() ** 3 * 40000);
          m.data.fill(rnd() < 0.5 ? 0 : rnd() < 0.8 ? 255 : Math.floor(rnd() * 256), i, i + len);
          i += len;
        }
      } else if (mode === 2) stampBrush(m, w / 2, h / 2, { radius: Math.min(w, h) / 3, hardness: 0.5, mode: 'add' });
      else if (rnd() < 0.5) fillMask(m);
      roundTrip(m);
    }
  });

  it('is compact for typical masks and handles tiny / empty sizes', () => {
    const m = createMask(1600, 1200);
    fillPolygon(m, [{ x: 100, y: 100 }, { x: 1500, y: 150 }, { x: 1400, y: 1100 }, { x: 200, y: 1000 }], 'add');
    const enc = roundTrip(m);
    expect(enc.length).toBeLessThan(m.data.length / 50);
    roundTrip(createMask(0, 0));
    roundTrip(createMask(1, 1));
    const one = createMask(1, 1);
    one.data[0] = 200;
    roundTrip(one);
    const big = createMask(1000, 1000);
    fillMask(big);
    expect(roundTrip(big).length).toBeLessThan(8);
  });

  it('rejects corrupt or mismatched data', () => {
    const m = createMask(10, 10);
    rect(m, 2, 2, 8, 8);
    const enc = encodeMaskRLE(m);
    expect(() => decodeMaskRLE(enc, 10, 11)).toThrow();
    expect(() => decodeMaskRLE(enc, 10, 9)).toThrow();
    expect(() => decodeMaskRLE(enc.subarray(0, enc.length - 1), 10, 10)).toThrow();
    expect(() => decodeMaskRLE(new Uint8Array([99, 0, 100]), 10, 10)).toThrow();
    expect(() => decodeMaskRLE(new Uint8Array(), 10, 10)).toThrow();
    expect(() => decodeMaskRLE(new Uint8Array([1, 0, 0]), 1, 1)).toThrow(); // zero-length run
  });
});

describe('resizeMask', () => {
  it('nearest-neighbour up and down', () => {
    const m = { width: 2, height: 2, data: new Uint8Array([1, 2, 3, 4]) };
    const up = resizeMask(m, 4, 4);
    expect([...up.data]).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
    const down = resizeMask(up, 2, 2);
    expect([...down.data]).toEqual([1, 2, 3, 4]);
    const same = resizeMask(m, 2, 2);
    expect(same.data).not.toBe(m.data);
    expect([...same.data]).toEqual([1, 2, 3, 4]);
    expect(resizeMask(m, 0, 5).data.length).toBe(0);
    expect(resizeMask(createMask(0, 0), 3, 3).data.length).toBe(9);
  });
});

describe('display helpers', () => {
  it('maskToOverlay tints by coverage and reuses the output buffer', () => {
    const m = { width: 3, height: 1, data: new Uint8Array([0, 128, 255]) };
    const out = maskToOverlay(m, '#3366ff', 0.5);
    expect([...out.data]).toEqual([0, 0, 0, 0, 0x33, 0x66, 0xff, 64, 0x33, 0x66, 0xff, 128]);
    const reused = maskToOverlay({ width: 3, height: 1, data: new Uint8Array([255, 0, 0]) }, '#ff0000', 1, out);
    expect(reused).toBe(out);
    expect([...out.data]).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    const bad = maskToOverlay(m, 'nope', 2);
    expect(bad.data[7]).toBe(128); // alpha clamped to 1, color falls back to black
    expect(bad.data[4]).toBe(0);
  });

  it('maskOutline marks both sides of the boundary only', () => {
    const m = createMask(12, 12);
    rect(m, 3, 3, 9, 9);
    const o = maskOutline(m, '#00ff00');
    const alpha = (x: number, y: number) => o.data[(y * 12 + x) * 4 + 3];
    expect(alpha(3, 5)).toBe(255); // inside boundary
    expect(alpha(2, 5)).toBe(255); // outside boundary
    expect(alpha(5, 5)).toBe(0); // interior
    expect(alpha(0, 0)).toBe(0); // far outside
    expect(o.data[(5 * 12 + 3) * 4 + 1]).toBe(255);
    const full = createMask(5, 5);
    fillMask(full);
    expect(maskOutline(full, '#fff').data.every((v) => v === 0)).toBe(true); // frame is not a boundary
    expect(maskOutline(createMask(5, 5), '#fff').data.every((v) => v === 0)).toBe(true);
  });
});
