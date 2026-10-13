/**
 * Small, dependency-free helpers for the procedural art: seeded PRNG, hashing,
 * number formatting for SVG output and color math (hex ↔ RGB ↔ HSL, mixing,
 * natural light/shadow tone derivation).
 */

export type RGB = [number, number, number];
export interface Pt {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/** Seeded uniform PRNG with a few convenience helpers. */
export interface Rng {
  (): number;
  /** Uniform in [a, b). */
  range(a: number, b: number): number;
  /** Integer in [a, b] (inclusive). */
  int(a: number, b: number): number;
  pick<T>(items: readonly T[]): T;
  /** v scaled by a random factor in [1 - amt, 1 + amt]. */
  jitter(v: number, amt: number): number;
  /** Approximately normal (mean 0, sd ~1), clamped to ±3. */
  gauss(): number;
  /** true with probability p. */
  chance(p: number): boolean;
}

/** mulberry32: tiny, fast, good-enough 32-bit generator. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(normalizeSeed(seed));
  const rng = (() => next()) as Rng;
  rng.range = (a, b) => a + (b - a) * next();
  rng.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  rng.pick = (items) => items[Math.min(items.length - 1, Math.floor(next() * items.length))];
  rng.jitter = (v, amt) => v * (1 + (next() * 2 - 1) * amt);
  rng.gauss = () => {
    const g = (next() + next() + next() + next() - 2) * 1.732;
    return Math.max(-3, Math.min(3, g));
  };
  rng.chance = (p) => next() < p;
  return rng;
}

/** Any number (including NaN / fractions / negatives) → stable uint32 seed. */
export function normalizeSeed(seed: number | undefined): number {
  if (seed === undefined || !Number.isFinite(seed)) return 0;
  return (Math.trunc(seed) ^ Math.trunc(seed / 4294967296)) >>> 0;
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Format a coordinate for SVG output: one decimal, no "-0". */
export function f(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? '0' : String(r);
}

/** Format a coordinate rounded to an integer (dense foliage paths, keeps output small). */
export function fi(n: number): string {
  const r = Math.round(n);
  return r === 0 ? '0' : String(r);
}

/** Two-decimal format for small values (opacities, offsets). */
export function f2(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? '0' : String(r);
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHex(s: unknown): s is string {
  return typeof s === 'string' && HEX_RE.test(s.trim());
}

/** Normalize to lowercase '#rrggbb'; invalid input yields `fallback`. */
export function normHex(s: string | undefined | null, fallback: string): string {
  if (!isHex(s)) return fallback;
  let h = s.trim().replace('#', '').toLowerCase();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h;
}

export function hexToRgb(hex: string): RGB {
  const h = normHex(hex, '#808080');
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex(rgb: RGB): string {
  let s = '#';
  for (let i = 0; i < 3; i++) s += Math.round(clamp(rgb[i], 0, 255)).toString(16).padStart(2, '0');
  return s;
}

/** Linear mix of two colors in sRGB (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}

export const lighten = (hex: string, t: number): string => mix(hex, '#ffffff', t);
export const darken = (hex: string, t: number): string => mix(hex, '#000000', t);

/** HSL with h in degrees [0,360), s and l in [0,1]. */
export type HSL = [number, number, number];

export function rgbToHsl([r8, g8, b8]: RGB): HSL {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: HSL): RGB {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [ch(hh + 1 / 3) * 255, ch(hh) * 255, ch(hh - 1 / 3) * 255];
}

export const hexToHsl = (hex: string): HSL => rgbToHsl(hexToRgb(hex));
export const hslToHex = (hsl: HSL): string => rgbToHex(hslToRgb(hsl));

/** Rotate hue `h` toward `target` by at most `maxDeg` degrees (shortest way round). */
export function hueToward(h: number, target: number, maxDeg: number): number {
  let d = ((target - h + 540) % 360) - 180;
  if (Math.abs(d) > maxDeg) d = Math.sign(d) * maxDeg;
  return (h + d + 360) % 360;
}

/**
 * Natural tone shift: amount < 0 darkens toward a cooler, slightly more
 * saturated shadow; amount > 0 lightens toward a warmer highlight. Lightness
 * changes are proportional so very dark / very light colors keep detail.
 */
export function tone(hex: string, amount: number): string {
  const [h, s, l] = hexToHsl(hex);
  const a = clamp(amount, -1, 1);
  if (a < 0) {
    const k = -a;
    const hue = s > 0.06 ? hueToward(h, 235, 22 * k) : h;
    return hslToHex([hue, clamp(s * (1 + 0.35 * k) + 0.03 * k, 0, 1), l * (1 - 0.75 * k)]);
  }
  const hue = s > 0.06 ? hueToward(h, 55, 20 * a) : h;
  return hslToHex([hue, clamp(s * (1 + 0.1 * a), 0, 1), l + (1 - l) * 0.8 * a]);
}

/** Relative luminance (sRGB, 0..1). */
export function luminance(hex: string): number {
  const c = hexToRgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Apply the HSL transform that maps `from` → `to` onto `other` (used by tintArt
 * so secondary colors keep their relationship to the primary one).
 */
export function transferTint(other: string, from: string, to: string): string {
  const [h0, s0, l0] = hexToHsl(from);
  const [h1, s1, l1] = hexToHsl(to);
  const [h, s, l] = hexToHsl(other);
  const dh = h1 - h0;
  const sRatio = s0 > 0.02 ? s1 / s0 : 1;
  const ns = s0 > 0.02 ? clamp(s * sRatio, 0, 1) : clamp(s + s1, 0, 1);
  const nl = l0 > 0 && l0 < 1 ? (l <= l0 ? (l / l0) * l1 : l1 + ((l - l0) / (1 - l0)) * (1 - l1)) : l1;
  return hslToHex([h + (s0 > 0.02 ? dh : h1 - h), ns, clamp(nl, 0, 1)]);
}
