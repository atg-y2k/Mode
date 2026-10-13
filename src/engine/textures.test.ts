import { describe, expect, it } from 'vitest';
import { TEXTURE_PATTERNS, type TexturePattern, type TextureSpec } from '../../shared/types';
import {
  MAX_TILE_SIZE,
  clearTextureCache,
  defaultSwatchSpan,
  generateTexture,
  getTexture,
  textureSwatch,
  type TextureTile,
} from './textures';

/** Realistic specs per pattern (unit sizes like the catalog's). */
const SPECS: Record<TexturePattern, TextureSpec> = {
  'wood-planks': { pattern: 'wood-planks', colors: ['#b48a5e', '#a07650'], unitWidthIn: 7.5, unitHeightIn: 72, variation: 0.5, seed: 1 },
  herringbone: { pattern: 'herringbone', colors: ['#b48a5e', '#a07650'], unitWidthIn: 3, unitHeightIn: 15, variation: 0.5, seed: 2 },
  chevron: { pattern: 'chevron', colors: ['#c4a07a'], unitWidthIn: 3.5, unitHeightIn: 18, variation: 0.5, seed: 3 },
  'tile-grid': { pattern: 'tile-grid', colors: ['#d9d4ca'], unitWidthIn: 12, unitHeightIn: 12, joint: { color: '#8a857c', widthIn: 0.125 }, variation: 0.3, seed: 4 },
  subway: { pattern: 'subway', colors: ['#f3f1ea'], unitWidthIn: 6, unitHeightIn: 3, variation: 0.4, seed: 5 },
  'hex-tile': { pattern: 'hex-tile', colors: ['#efede8'], unitWidthIn: 3, unitHeightIn: 3, variation: 0.3, seed: 6 },
  brick: { pattern: 'brick', colors: ['#9c4a32', '#86402c'], unitWidthIn: 7.625, unitHeightIn: 2.25, variation: 0.6, seed: 7 },
  'stone-pavers': { pattern: 'stone-pavers', colors: ['#6f7a80', '#7c858a'], unitWidthIn: 12, unitHeightIn: 12, variation: 0.5, seed: 8 },
  flagstone: { pattern: 'flagstone', colors: ['#8e8576', '#9d917d'], unitWidthIn: 20, unitHeightIn: 20, variation: 0.6, seed: 9 },
  cobblestone: { pattern: 'cobblestone', colors: ['#7f7b74', '#8f8a81'], unitWidthIn: 4, unitHeightIn: 4, variation: 0.5, seed: 10 },
  gravel: { pattern: 'gravel', colors: ['#b9ab94', '#9c9180'], unitWidthIn: 0.375, unitHeightIn: 0.375, variation: 0.6, seed: 11 },
  mulch: { pattern: 'mulch', colors: ['#5b3a24', '#4a2e1c'], unitWidthIn: 1.5, unitHeightIn: 1.5, variation: 0.5, seed: 12 },
  grass: { pattern: 'grass', colors: ['#4f7a2c', '#5f8a34'], unitWidthIn: 2, unitHeightIn: 2, variation: 0.5, seed: 13 },
  concrete: { pattern: 'concrete', colors: ['#a9a59e'], unitWidthIn: 48, unitHeightIn: 48, variation: 0.4, seed: 14 },
  stucco: { pattern: 'stucco', colors: ['#e3dccd'], unitWidthIn: 12, unitHeightIn: 12, variation: 0.5, seed: 15 },
  'lap-siding': { pattern: 'lap-siding', colors: ['#c9cfc9'], unitWidthIn: 144, unitHeightIn: 7, variation: 0.3, seed: 16 },
  'board-batten': { pattern: 'board-batten', colors: ['#f1efe9'], unitWidthIn: 12, unitHeightIn: 96, variation: 0.3, seed: 17 },
  'shingle-siding': { pattern: 'shingle-siding', colors: ['#9a7a5a', '#8a6b4e'], unitWidthIn: 6, unitHeightIn: 7, variation: 0.6, seed: 18 },
  'roof-shingles': { pattern: 'roof-shingles', colors: ['#4a4a4a', '#3a3a3a'], unitWidthIn: 13, unitHeightIn: 5.625, variation: 0.5, seed: 19 },
  'standing-seam': { pattern: 'standing-seam', colors: ['#3d4348'], unitWidthIn: 16, unitHeightIn: 120, variation: 0.3, seed: 20 },
  'deck-boards': { pattern: 'deck-boards', colors: ['#8a6446', '#7a573c'], unitWidthIn: 5.5, unitHeightIn: 144, variation: 0.5, seed: 21 },
  carpet: { pattern: 'carpet', colors: ['#b7ab98', '#a99c88'], unitWidthIn: 0.25, unitHeightIn: 0.25, variation: 0.5, seed: 22 },
  marble: { pattern: 'marble', colors: ['#f1efeb', '#8f8f93'], unitWidthIn: 24, unitHeightIn: 24, variation: 0.5, seed: 23 },
  terrazzo: { pattern: 'terrazzo', colors: ['#ece8e0', '#3f3f3f', '#c9a27c'], unitWidthIn: 0.6, unitHeightIn: 0.6, variation: 0.5, seed: 24 },
  'stone-veneer': { pattern: 'stone-veneer', colors: ['#9b9184', '#857b6f'], unitWidthIn: 12, unitHeightIn: 3, variation: 0.6, seed: 25 },
  shiplap: { pattern: 'shiplap', colors: ['#f2f0ea'], unitWidthIn: 96, unitHeightIn: 7.25, variation: 0.3, seed: 26 },
};

function lum(t: { data: Uint8ClampedArray }, i: number): number {
  return 0.299 * t.data[i] + 0.587 * t.data[i + 1] + 0.114 * t.data[i + 2];
}

/** Mean |Δluma| between columns a and b. */
function colDiff(t: TextureTile, a: number, b: number): number {
  let s = 0;
  for (let y = 0; y < t.height; y++) s += Math.abs(lum(t, (y * t.width + a) * 4) - lum(t, (y * t.width + b) * 4));
  return s / t.height;
}

/** Mean |Δluma| between rows a and b. */
function rowDiff(t: TextureTile, a: number, b: number): number {
  let s = 0;
  for (let x = 0; x < t.width; x++) s += Math.abs(lum(t, (a * t.width + x) * 4) - lum(t, (b * t.width + x) * 4));
  return s / t.width;
}

function meanRgb(t: { width: number; height: number; data: Uint8ClampedArray }): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = t.width * t.height;
  for (let i = 0; i < n * 4; i += 4) {
    r += t.data[i];
    g += t.data[i + 1];
    b += t.data[i + 2];
  }
  return [r / n, g / n, b / n];
}

function lumaStd(t: TextureTile): number {
  const n = t.width * t.height;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const l = lum(t, i);
    s += l;
    s2 += l * l;
  }
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

describe('generateTexture', () => {
  it('has a spec for every pattern', () => {
    expect(Object.keys(SPECS).sort()).toEqual([...TEXTURE_PATTERNS].sort());
  });

  describe.each(TEXTURE_PATTERNS.map((p) => [p]))('%s', (pattern) => {
    const tile = generateTexture(SPECS[pattern], 6);

    it('is a valid, opaque, non-flat tile within the size cap', () => {
      expect(tile.width).toBeGreaterThan(8);
      expect(tile.height).toBeGreaterThan(8);
      expect(tile.width).toBeLessThanOrEqual(MAX_TILE_SIZE);
      expect(tile.height).toBeLessThanOrEqual(MAX_TILE_SIZE);
      expect(tile.data.length).toBe(tile.width * tile.height * 4);
      expect(tile.pxPerInch).toBeCloseTo(6, 6);
      for (let i = 3; i < tile.data.length; i += 4) {
        if (tile.data[i] !== 255) throw new Error(`alpha ${tile.data[i]} at ${i}`);
      }
      // Real materials have visible structure, but stay a coherent material.
      const sd = lumaStd(tile);
      expect(sd).toBeGreaterThan(0.8);
      expect(sd).toBeLessThan(70);
    });

    it('tiles seamlessly (wrap-around neighbours look like interior neighbours)', () => {
      // A seam is a discontinuity stronger than anything inside the tile. The
      // wrap pair may legitimately sit on a structural edge (a course line or
      // a seam rib), so it is compared with the interior's mean *and* its
      // strongest neighbouring pair.
      const check = (n: number, diff: (a: number, b: number) => number) => {
        let mean = 0;
        let max = 0;
        for (let k = 0; k < n - 1; k++) {
          const d = diff(k, k + 1);
          mean += d;
          if (d > max) max = d;
        }
        mean /= n - 1;
        expect(diff(n - 1, 0)).toBeLessThanOrEqual(Math.max(mean * 2.5 + 2, max * 1.15 + 2));
      };
      check(tile.width, (a, b) => colDiff(tile, a, b));
      check(tile.height, (a, b) => rowDiff(tile, a, b));
    });

    it('stays close to the palette on average', () => {
      const [r, g, b] = meanRgb(tile);
      const pal = SPECS[pattern].colors.map((c) => parseInt(c.slice(1), 16));
      const pr = pal.reduce((a, v) => a + ((v >> 16) & 255), 0) / pal.length;
      const pg = pal.reduce((a, v) => a + ((v >> 8) & 255), 0) / pal.length;
      const pb = pal.reduce((a, v) => a + (v & 255), 0) / pal.length;
      const lt = 0.299 * r + 0.587 * g + 0.114 * b;
      const lp = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      // Joints, shadows and gaps darken a little; nothing should be wildly off.
      expect(Math.abs(lt - lp)).toBeLessThan(pattern === 'terrazzo' || pattern === 'grass' || pattern === 'mulch' ? 70 : 45);
    });
  });

  it('is deterministic for a spec and changes with the seed', () => {
    for (const pattern of ['brick', 'gravel', 'grass', 'herringbone', 'marble'] as const) {
      const a = generateTexture(SPECS[pattern], 5);
      const b = generateTexture(SPECS[pattern], 5);
      expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      const c = generateTexture({ ...SPECS[pattern], seed: SPECS[pattern].seed + 1000 }, 5);
      expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
    }
  });

  it('reduces pxPerInch to keep tiles within MAX_TILE_SIZE', () => {
    const t = generateTexture(SPECS['wood-planks'], 80);
    expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(MAX_TILE_SIZE);
    expect(t.pxPerInch).toBeLessThan(80);
    expect(t.pxPerInch).toBeGreaterThan(5);
    // Real-world size is preserved: the tile spans the same inches either way.
    const small = generateTexture(SPECS['wood-planks'], 4);
    expect(t.width / t.pxPerInch).toBeCloseTo(small.width / small.pxPerInch, 0);
  });

  it('scales the tile with the requested resolution', () => {
    const a = generateTexture(SPECS.brick, 4);
    const b = generateTexture(SPECS.brick, 8);
    expect(b.width).toBeGreaterThanOrEqual(a.width * 2 - 1);
    expect(b.width).toBeLessThanOrEqual(a.width * 2 + 1);
  });

  it('handles very coarse resolutions by averaging (no crash, sane color)', () => {
    const t = generateTexture(SPECS.gravel, 0.5);
    expect(t.width).toBeGreaterThanOrEqual(1);
    const [r, g, b] = meanRgb(t);
    expect(r).toBeGreaterThan(60);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(40);
  });

  it('survives malformed specs', () => {
    const bad = {
      pattern: 'nope',
      colors: ['not-a-color'],
      unitWidthIn: NaN,
      unitHeightIn: -3,
      variation: Infinity,
      seed: NaN,
      joint: { color: 'x', widthIn: -1 },
    } as unknown as TextureSpec;
    const t = generateTexture(bad, 4);
    expect(t.width).toBeGreaterThan(0);
    expect(t.data.length).toBe(t.width * t.height * 4);
    const t2 = generateTexture({ ...SPECS.brick, colors: [] }, Number.NaN);
    expect(t2.width).toBeGreaterThan(0);
  });

  it('uses the explicit joint color for grout', () => {
    const black = generateTexture({ ...SPECS['tile-grid'], colors: ['#ffffff'], joint: { color: '#000000', widthIn: 0.5 } }, 8);
    const white = generateTexture({ ...SPECS['tile-grid'], colors: ['#ffffff'], joint: { color: '#ffffff', widthIn: 0.5 } }, 8);
    expect(meanRgb(black)[0]).toBeLessThan(meanRgb(white)[0] - 5);
  });

  it('renders brick red-brown and grass green', () => {
    const [br, bg, bb] = meanRgb(generateTexture(SPECS.brick, 6));
    expect(br).toBeGreaterThan(bg);
    expect(bg).toBeGreaterThanOrEqual(bb - 5);
    const [gr, gg, gb] = meanRgb(generateTexture(SPECS.grass, 6));
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
  });
});

describe('getTexture', () => {
  it('memoizes by spec and resolution', () => {
    clearTextureCache();
    const a = getTexture(SPECS.subway, 6);
    expect(getTexture({ ...SPECS.subway }, 6)).toBe(a);
    // Nearby resolutions reuse the tile (its own pxPerInch keeps mapping exact).
    expect(getTexture(SPECS.subway, 6.1)).toBe(a);
    expect(getTexture(SPECS.subway, 9)).not.toBe(a);
    expect(getTexture({ ...SPECS.subway, seed: 99 }, 6)).not.toBe(a);
  });

  it('evicts old entries (bounded LRU)', () => {
    clearTextureCache();
    const first = getTexture(SPECS.carpet, 2);
    for (let i = 0; i < 40; i++) getTexture({ ...SPECS.carpet, seed: 1000 + i }, 2);
    expect(getTexture(SPECS.carpet, 2)).not.toBe(first);
  });
});

describe('textureSwatch', () => {
  it('returns an opaque square of the requested size', () => {
    const s = textureSwatch(SPECS.flagstone, 64);
    expect(s.width).toBe(64);
    expect(s.height).toBe(64);
    expect(s.data.length).toBe(64 * 64 * 4);
    for (let i = 3; i < s.data.length; i += 4) expect(s.data[i]).toBe(255);
  });

  it('shows the material color and is deterministic', () => {
    const spec: TextureSpec = { ...SPECS.concrete, colors: ['#808080'] };
    const s = textureSwatch(spec, 48);
    const [r, g, b] = meanRgb(s);
    expect(Math.abs(r - 128)).toBeLessThan(25);
    expect(Math.abs(g - 128)).toBeLessThan(25);
    expect(Math.abs(b - 128)).toBeLessThan(25);
    expect(Buffer.from(textureSwatch(spec, 48).data).equals(Buffer.from(s.data))).toBe(true);
  });

  it('shows more elements when spanning more inches', () => {
    // A wider span packs more grout lines into the swatch → more edges.
    const edges = (img: { width: number; height: number; data: Uint8ClampedArray }) => {
      let e = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width - 1; x++) {
          const i = (y * img.width + x) * 4;
          e += Math.abs(lum(img, i) - lum(img, i + 4));
        }
      return e;
    };
    const near = textureSwatch(SPECS['tile-grid'], 96, 18);
    const far = textureSwatch(SPECS['tile-grid'], 96, 72);
    expect(edges(far)).toBeGreaterThan(edges(near));
  });

  it('defaults to ~3 units with sensible bounds', () => {
    expect(defaultSwatchSpan(SPECS.flagstone)).toBe(60);
    expect(defaultSwatchSpan(SPECS.cobblestone)).toBe(18);
    expect(defaultSwatchSpan(SPECS.gravel)).toBe(12);
    expect(defaultSwatchSpan(SPECS['lap-siding'])).toBe(96);
    expect(defaultSwatchSpan(SPECS.marble)).toBe(36);
  });
});
