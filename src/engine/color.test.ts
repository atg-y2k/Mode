import { describe, expect, it } from 'vitest';
import {
  averageColor,
  colorFamilyOf,
  deltaE,
  deltaE76,
  hexToLab,
  hexToRgb,
  hslToRgb,
  isValidHex,
  kelvinToRgb,
  labArrayToSrgb8,
  labToRgb,
  labToSrgb8Into,
  linearToSrgb,
  linearToSrgb8,
  lrv,
  mixHex,
  normalizeHex,
  relativeLuminance,
  rgb8ToLabInto,
  rgbaToLabArray,
  rgbToHex,
  rgbToHsl,
  rgbToLab,
  srgbToLinear,
  textColorOn,
} from './color';
import { createImageDataLike, type Lab } from './types';

/** Deterministic PRNG for reproducible random tests. */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('hex parsing', () => {
  it('normalizes valid forms', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex('#AaBbCc')).toBe('#aabbcc');
    expect(normalizeHex('AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('  #123456 ')).toBe('#123456');
  });

  it('rejects everything else', () => {
    for (const bad of ['', '#', '#12', '#1234', '#12345', '#1234567', 'ggg', '#ggghhh', 'rgb(1,2,3)', '##abc']) {
      expect(normalizeHex(bad)).toBeNull();
      expect(isValidHex(bad)).toBe(false);
    }
    expect(normalizeHex(undefined as unknown as string)).toBeNull();
  });

  it('hexToRgb parses and throws on invalid input', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb('0f0')).toEqual({ r: 0, g: 255, b: 0 });
    expect(() => hexToRgb('nope')).toThrow();
  });

  it('rgbToHex rounds and clamps', () => {
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000');
    expect(rgbToHex({ r: 127.6, g: -5, b: 300 })).toBe('#8000ff');
    expect(rgbToHex({ r: NaN, g: Infinity, b: 0.4 })).toBe('#00ff00');
  });
});

describe('transfer functions', () => {
  it('has the right endpoints and mid value', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    expect(linearToSrgb(0.214041)).toBeCloseTo(0.5, 5);
  });

  it('round-trips', () => {
    for (let i = 0; i <= 1000; i++) {
      const v = i / 1000;
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 10);
    }
  });

  it('fast linear -> sRGB table agrees with the exact curve', () => {
    for (let i = 0; i <= 2000; i++) {
      const v = i / 2000;
      expect(Math.abs(linearToSrgb8(v) - 255 * linearToSrgb(v))).toBeLessThan(0.02);
    }
    expect(linearToSrgb8(-1)).toBe(0);
    expect(linearToSrgb8(NaN)).toBe(0);
    expect(linearToSrgb8(2)).toBe(255);
  });
});

describe('Lab', () => {
  it('maps sRGB white to L=100, a=b=0 and black to 0', () => {
    const w = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(w.l).toBeCloseTo(100, 6);
    expect(w.a).toBeCloseTo(0, 6);
    expect(w.b).toBeCloseTo(0, 6);
    expect(rgbToLab({ r: 0, g: 0, b: 0 })).toEqual({ l: 0, a: 0, b: 0 });
  });

  it('matches known D65 values', () => {
    const cases: [string, Lab][] = [
      ['#ff0000', { l: 53.2408, a: 80.0925, b: 67.2032 }],
      ['#00ff00', { l: 87.7347, a: -86.1827, b: 83.1793 }],
      ['#0000ff', { l: 32.297, a: 79.1875, b: -107.8602 }],
      ['#808080', { l: 53.5850, a: 0, b: 0 }],
    ];
    for (const [hex, ref] of cases) {
      const lab = hexToLab(hex);
      expect(lab.l).toBeCloseTo(ref.l, 2);
      expect(lab.a).toBeCloseTo(ref.a, 2);
      expect(lab.b).toBeCloseTo(ref.b, 2);
    }
  });

  it('round-trips every sampled 8-bit color exactly', () => {
    const rnd = mulberry32(1);
    for (let i = 0; i < 5000; i++) {
      const c = { r: Math.floor(rnd() * 256), g: Math.floor(rnd() * 256), b: Math.floor(rnd() * 256) };
      expect(labToRgb(rgbToLab(c))).toEqual(c);
    }
  });

  it('clamps out-of-gamut and garbage input without NaN', () => {
    const c = labToRgb({ l: 50, a: 200, b: -200 });
    for (const v of [c.r, c.g, c.b]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    expect(labToRgb({ l: NaN, a: NaN, b: NaN })).toEqual({ r: 0, g: 0, b: 0 });
    expect(labToRgb({ l: 150, a: 0, b: 0 })).toEqual({ r: 255, g: 255, b: 255 });
    expect(labToRgb({ l: -20, a: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('fast per-pixel paths agree with the exact conversions', () => {
    const rnd = mulberry32(2);
    const out = new Float64Array(3);
    const rgb = new Float64Array(3);
    for (let i = 0; i < 3000; i++) {
      const c = { r: Math.floor(rnd() * 256), g: Math.floor(rnd() * 256), b: Math.floor(rnd() * 256) };
      const ref = rgbToLab(c);
      rgb8ToLabInto(c.r, c.g, c.b, out, 0);
      expect(Math.abs(out[0] - ref.l)).toBeLessThan(0.01);
      expect(Math.abs(out[1] - ref.a)).toBeLessThan(0.01);
      expect(Math.abs(out[2] - ref.b)).toBeLessThan(0.01);
      labToSrgb8Into(ref.l, ref.a, ref.b, rgb, 0);
      expect(Math.abs(rgb[0] - c.r)).toBeLessThan(0.05);
      expect(Math.abs(rgb[1] - c.g)).toBeLessThan(0.05);
      expect(Math.abs(rgb[2] - c.b)).toBeLessThan(0.05);
    }
  });

  it('batch conversions round-trip an image', () => {
    const rnd = mulberry32(3);
    const n = 4096;
    const src = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < src.length; i++) src[i] = Math.floor(rnd() * 256);
    const lab = new Float32Array(n * 3);
    rgbaToLabArray(src, lab, n);
    const ref = rgbToLab({ r: src[0], g: src[1], b: src[2] });
    expect(lab[0]).toBeCloseTo(ref.l, 2);
    labArrayToSrgb8(lab, lab, n); // in place
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) expect(Math.abs(lab[i * 3 + c] - src[i * 4 + c])).toBeLessThan(0.05);
    }
  });
});

describe('deltaE (CIEDE2000)', () => {
  // Sharma, Wu & Dalal (2005) test data: L1 a1 b1 L2 a2 b2 ΔE00.
  const sharma: number[][] = [
    [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
    [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
    [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
    [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0],
    [50, -1.1848, -84.8006, 50, 0, -82.7485, 1.0],
    [50, -0.9009, -85.5211, 50, 0, -82.7485, 1.0],
    [50, 0, 0, 50, -1, 2, 2.3669],
    [50, -1, 2, 50, 0, 0, 2.3669],
    [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
    [50, 2.49, -0.001, 50, -2.49, 0.001, 7.1792],
    [50, 2.49, -0.001, 50, -2.49, 0.0011, 7.2195],
    [50, 2.49, -0.001, 50, -2.49, 0.0012, 7.2195],
    [50, -0.001, 2.49, 50, 0.0009, -2.49, 4.8045],
    [50, -0.001, 2.49, 50, 0.001, -2.49, 4.8045],
    [50, -0.001, 2.49, 50, 0.0011, -2.49, 4.7461],
    [50, 2.5, 0, 50, 0, -2.5, 4.3065],
    [50, 2.5, 0, 73, 25, -18, 27.1492],
    [50, 2.5, 0, 61, -5, 29, 22.8977],
    [50, 2.5, 0, 56, -27, -3, 31.903],
    [50, 2.5, 0, 58, 24, 15, 19.4535],
    [50, 2.5, 0, 50, 3.1736, 0.5854, 1.0],
    [50, 2.5, 0, 50, 3.2972, 0, 1.0],
    [50, 2.5, 0, 50, 1.8634, 0.5757, 1.0],
    [50, 2.5, 0, 50, 3.2592, 0.335, 1.0],
    [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
    [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
    [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
    [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
    [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
    [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
    [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
    [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
    [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
    [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
  ];

  it.each(sharma.map((r, i) => [i + 1, r] as const))('matches Sharma pair %i', (_i, r) => {
    const a = { l: r[0], a: r[1], b: r[2] };
    const b = { l: r[3], a: r[4], b: r[5] };
    expect(deltaE(a, b)).toBeCloseTo(r[6], 4);
    expect(deltaE(b, a)).toBeCloseTo(r[6], 4); // symmetric
  });

  it('is zero for identical colors and finite for edge inputs', () => {
    expect(deltaE({ l: 40, a: 10, b: -5 }, { l: 40, a: 10, b: -5 })).toBe(0);
    expect(deltaE({ l: 0, a: 0, b: 0 }, { l: 100, a: 0, b: 0 })).toBeGreaterThan(50);
    expect(Number.isFinite(deltaE({ l: 0, a: 0, b: 0 }, { l: 0, a: 0, b: 0 }))).toBe(true);
  });

  it('deltaE76 is euclidean', () => {
    expect(deltaE76({ l: 0, a: 0, b: 0 }, { l: 3, a: 4, b: 0 })).toBe(5);
    expect(deltaE76({ l: 10, a: -2, b: 1 }, { l: 10, a: -2, b: 1 })).toBe(0);
  });
});

describe('luminance', () => {
  it('relative luminance and LRV', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(lrv('#ffffff')).toBe(100);
    expect(lrv('#000000')).toBe(0);
    expect(lrv('#808080')).toBeCloseTo(21.6, 1);
    expect(lrv('not a color')).toBe(0);
    // LRV grows with lightness
    expect(lrv('#f4f1ea')).toBeGreaterThan(lrv('#b8b4ad'));
  });

  it('textColorOn picks the more legible text color', () => {
    expect(textColorOn('#ffffff')).toBe('#000000');
    expect(textColorOn('#000000')).toBe('#ffffff');
    expect(textColorOn('#1f3a5f')).toBe('#ffffff');
    expect(textColorOn('#f4d35e')).toBe('#000000');
    expect(textColorOn('bogus')).toBe('#ffffff');
  });
});

describe('kelvinToRgb', () => {
  it('always has a 255 max channel and finite values', () => {
    for (let k = 1000; k <= 40000; k += 37) {
      const c = kelvinToRgb(k);
      expect(Math.max(c.r, c.g, c.b)).toBeCloseTo(255, 6);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
    for (const k of [NaN, 0, -100, 1e9, Infinity]) {
      const c = kelvinToRgb(k);
      expect([c.r, c.g, c.b].every(Number.isFinite)).toBe(true);
    }
  });

  it('is warm at low and cool at high temperatures, near white around 6500 K', () => {
    const warm = kelvinToRgb(2700);
    expect(warm.r).toBe(255);
    expect(warm.g).toBeGreaterThan(warm.b);
    expect(warm.b).toBeLessThan(120);
    const cool = kelvinToRgb(10000);
    expect(cool.b).toBe(255);
    expect(cool.r).toBeLessThan(cool.g);
    const d65 = kelvinToRgb(6500);
    expect(Math.min(d65.r, d65.g, d65.b)).toBeGreaterThan(245);
  });

  it('is smooth (no jumps between neighbouring temperatures) and monotonic in blue/red', () => {
    let prev = kelvinToRgb(1000);
    let prevRatio = prev.b / prev.r;
    for (let k = 1010; k <= 20000; k += 10) {
      const c = kelvinToRgb(k);
      // Tanner Helland's original fit jumps by 3.3 levels at 6600 K.
      expect(Math.abs(c.r - prev.r)).toBeLessThan(2);
      expect(Math.abs(c.g - prev.g)).toBeLessThan(2);
      expect(Math.abs(c.b - prev.b)).toBeLessThan(2);
      const ratio = c.b / c.r;
      expect(ratio).toBeGreaterThanOrEqual(prevRatio - 1e-9);
      prev = c;
      prevRatio = ratio;
    }
  });
});

describe('misc helpers', () => {
  it('mixHex blends linearly in sRGB', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0.25)).toBe('#bf0040');
    expect(mixHex('#ff0000', '#0000ff', 7)).toBe('#0000ff');
    expect(mixHex('#ff0000', '#0000ff', NaN)).toBe('#ff0000');
  });

  it('HSL round-trips', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(rgbToHsl({ r: 128, g: 128, b: 128 }).s).toBe(0);
    expect(hslToRgb(120, 1, 0.5)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslToRgb(-120, 1, 0.5)).toEqual(hslToRgb(240, 1, 0.5));
    const rnd = mulberry32(4);
    for (let i = 0; i < 2000; i++) {
      const c = { r: Math.floor(rnd() * 256), g: Math.floor(rnd() * 256), b: Math.floor(rnd() * 256) };
      const { h, s, l } = rgbToHsl(c);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      const back = hslToRgb(h, s, l);
      expect(Math.abs(back.r - c.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - c.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - c.b)).toBeLessThanOrEqual(1);
    }
  });

  it('colorFamilyOf groups representative colors', () => {
    const cases: Record<string, string[]> = {
      white: ['#ffffff', '#f5efe0', '#eef2f3', '#f0ead6', '#f2f0eb'],
      neutral: ['#d6cfc4', '#c8bfb2', '#a39a8c', '#8c847a'],
      gray: ['#808080', '#d9d9d9', '#6e7f80', '#5a5f63', '#c0c4c7', '#3a3d40'],
      black: ['#000000', '#1c1c1c', '#2b2b2b', '#1b1d22'],
      beige: ['#d2b48c', '#e8d8be', '#d9c7a7', '#f3e5c0', '#f5f5dc'],
      brown: ['#8b5a2b', '#6b4423', '#5c4033', '#4a3728', '#a0522d'],
      red: ['#ff0000', '#dc143c', '#8b0000', '#b22222', '#7c1f2b'],
      orange: ['#ffa500', '#ff7f50', '#cc5500', '#c46e4b'],
      yellow: ['#ffff00', '#ffd700', '#f4d35e', '#daa520'],
      green: ['#008000', '#9caf88', '#6b8e23', '#2e5e4e', '#556b2f', '#808000'],
      blue: ['#0000ff', '#000080', '#4169e1', '#87ceeb', '#1f3a5f', '#434b56', '#008080', '#708090'],
      purple: ['#800080', '#9370db', '#b57edc', '#4b0082', '#6a5acd', '#5d3954'],
      pink: ['#ffc0cb', '#ff69b4', '#e8a0b4', '#fa8072', '#ff00ff', '#c71585'],
    };
    for (const [family, hexes] of Object.entries(cases)) {
      for (const hex of hexes) expect([hex, colorFamilyOf(hex)]).toEqual([hex, family]);
    }
    expect(colorFamilyOf('garbage')).toBe('black');
  });

  it('averageColor averages the whole image or the masked part', () => {
    const img = createImageDataLike(4, 2, { r: 10, g: 20, b: 30 });
    for (let i = 0; i < 4; i++) {
      const p = (4 + i) * 4; // second row
      img.data[p] = 110;
      img.data[p + 1] = 120;
      img.data[p + 2] = 130;
    }
    expect(averageColor(img)).toEqual({ r: 60, g: 70, b: 80 });
    const mask = { width: 4, height: 2, data: new Uint8Array([0, 0, 0, 0, 255, 200, 128, 127]) };
    expect(averageColor(img, mask)).toEqual({ r: 110, g: 120, b: 130 });
    expect(averageColor(img, { width: 4, height: 2, data: new Uint8Array(8) })).toEqual({ r: 0, g: 0, b: 0 });
    expect(averageColor(createImageDataLike(0, 0))).toEqual({ r: 0, g: 0, b: 0 });
  });
});
