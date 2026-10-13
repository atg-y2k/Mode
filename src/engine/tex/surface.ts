/**
 * The working buffers of a texture generator and the shared "finish" pass.
 *
 * Generators paint a linear-light albedo (already including any explicit,
 * pattern-specific shading such as the shadow line under a siding lap) and a
 * relief map in inches. finishSurface() then lights the relief (bump shading
 * from a soft top-left light plus cavity occlusion) and encodes sRGB RGBA.
 */
import { linearToSrgb, SRGB8_TO_LINEAR, normalizeHex } from '../color';
import { blurWrap } from './noise';

export interface Surface {
  readonly w: number;
  readonly h: number;
  /** Pixels per inch along x / y (exact, so the tile holds whole periods). */
  readonly sx: number;
  readonly sy: number;
  /** Linear-light albedo, interleaved RGB. */
  readonly rgb: Float32Array;
  /** Relief in inches (0 = face of the material, negative = recessed joints). */
  readonly height: Float32Array;
  /**
   * Optional analytic relief slopes (∂height/∂x, ∂height/∂y in inches per
   * inch). When set, bump lighting uses them instead of differencing the
   * height map — for overlapping elements whose silhouettes are steps.
   */
  gradX?: Float32Array;
  gradY?: Float32Array;
}

export function createSurface(w: number, h: number, sx: number, sy: number): Surface {
  return { w, h, sx, sy, rgb: new Float32Array(w * h * 3), height: new Float32Array(w * h) };
}

export type Vec3 = [number, number, number];

/** '#rrggbb' → linear RGB (0..1). Invalid → null. */
export function hexToLinear(hex: string): Vec3 | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  const v = parseInt(n.slice(1), 16);
  return [SRGB8_TO_LINEAR[(v >> 16) & 255], SRGB8_TO_LINEAR[(v >> 8) & 255], SRGB8_TO_LINEAR[v & 255]];
}

export function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale3(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  if (x <= e0) return 0;
  if (x >= e1) return 1;
  const t = (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}

const TAU = Math.PI * 2;
const SIN_N = 2048;
const SIN_LUT: Float32Array = (() => {
  const t = new Float32Array(SIN_N + 1);
  for (let i = 0; i <= SIN_N; i++) t[i] = Math.sin((i / SIN_N) * TAU);
  return t;
})();

/** Table sine (error < 2e-6), several times cheaper than Math.sin in per-pixel loops. */
export function fastSin(x: number): number {
  const t = x * (SIN_N / TAU);
  const f = Math.floor(t);
  const i = f & (SIN_N - 1);
  return SIN_LUT[i] + (SIN_LUT[i + 1] - SIN_LUT[i]) * (t - f);
}

/** Wraps an integer coordinate into [0, n). */
export function wrap(i: number, n: number): number {
  const r = i % n;
  return r < 0 ? r + n : r;
}

/** Positive modulo for floats. */
export function fmod(x: number, n: number): number {
  return x - Math.floor(x / n) * n;
}

export interface FinishOptions {
  /**
   * Bump strength (multiplies relief slopes). 0 disables relief lighting.
   * Default 1.
   */
  bump?: number;
  /** Cavity occlusion strength: darkening per inch below the local mean height. Default 0. */
  ao?: number;
  /** Neighbourhood radius for the cavity term, inches. Default 0.5. */
  aoRadiusIn?: number;
  /** Diffuse share of the light (rest is ambient). Default 0.55. */
  diffuse?: number;
  /**
   * Caps relief slopes (rise / run) so silhouette steps between stacked
   * elements shade like a rounded edge rather than a cliff. Default 4.
   */
  maxSlope?: number;
}

/** Light from the upper left, slightly raking (unit vector, y down). */
const LX = -0.42;
const LY = -0.5;
const LZ = Math.sqrt(1 - LX * LX - LY * LY);

const ENC_SIZE = 16384;
/** linear 0..1 → rounded sRGB code value, finely sampled (≤ 0.2 code error). */
const ENCODE_LUT: Uint8Array = (() => {
  const t = new Uint8Array(ENC_SIZE + 1);
  for (let i = 0; i <= ENC_SIZE; i++) t[i] = Math.round(255 * linearToSrgb(i / ENC_SIZE));
  return t;
})();

/** Linear 0..1 (clamped) → sRGB byte. */
export function encodeLinear(v: number): number {
  return ENCODE_LUT[v >= 1 ? ENC_SIZE : v > 0 ? (v * ENC_SIZE + 0.5) | 0 : 0];
}

/**
 * Lights the relief and encodes the albedo to sRGB RGBA (alpha 255).
 * Flat areas keep exactly their albedo; slopes facing the light brighten,
 * slopes facing away darken, and recesses get cavity occlusion.
 */
export function finishSurface(s: Surface, opts: FinishOptions = {}): Uint8ClampedArray {
  const { w, h, sx, sy, rgb, height } = s;
  const gradX = s.gradX && s.gradY ? s.gradX : null;
  const gradY = s.gradX && s.gradY ? s.gradY : null;
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const bump = opts.bump ?? 1;
  const ao = opts.ao ?? 0;
  const dif = clamp(opts.diffuse ?? 0.55, 0, 1);
  const amb = 1 - dif;
  const flat = amb + dif * LZ;
  const shade = new Float32Array(n).fill(1);

  if (bump > 0 && w > 2 && h > 2) {
    const kx = (bump * sx) / 2;
    const ky = (bump * sy) / 2;
    const dl = (dif / flat) * -LX;
    const du = (dif / flat) * -LY;
    const dz = (dif / flat) * LZ;
    const a0 = amb / flat;
    const ms = opts.maxSlope ?? 4;
    const ms2 = ms * ms;
    for (let y = 0; y < h; y++) {
      const up = (y === 0 ? h - 1 : y - 1) * w;
      const dn = (y === h - 1 ? 0 : y + 1) * w;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const l = x === 0 ? w - 1 : x - 1;
        const r = x === w - 1 ? 0 : x + 1;
        let gx = gradX ? gradX[row + x] * bump : (height[row + r] - height[row + l]) * kx;
        let gy = gradY ? gradY[row + x] * bump : (height[dn + x] - height[up + x]) * ky;
        const g2 = gx * gx + gy * gy;
        if (g2 > ms2) {
          const f = ms / Math.sqrt(g2);
          gx *= f;
          gy *= f;
        }
        // n = (-gx, -gy, 1) / |…|; shade = (amb + dif·max(0, n·L)) / flat
        const d = (gx * dl + gy * du + dz) / Math.sqrt(gx * gx + gy * gy + 1);
        shade[row + x] = d > 0 ? a0 + d : a0;
      }
    }
  }

  if (ao > 0) {
    const rpx = (opts.aoRadiusIn ?? 0.5) * (sx + sy) * 0.5;
    if (rpx >= 0.75) {
      const r = Math.max(1, Math.round(rpx / 1.7));
      const mean = blurWrap(height, w, h, r, r, 2);
      for (let i = 0; i < n; i++) {
        const c = height[i] - mean[i];
        if (c < 0) shade[i] *= Math.exp(c * ao);
      }
    }
  }

  const lut = ENCODE_LUT;
  const S = ENC_SIZE;
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 3, q += 4) {
    const k = shade[i] * S;
    const r = rgb[p] * k;
    const g = rgb[p + 1] * k;
    const b = rgb[p + 2] * k;
    out[q] = lut[r >= S ? S : r > 0 ? (r + 0.5) | 0 : 0];
    out[q + 1] = lut[g >= S ? S : g > 0 ? (g + 0.5) | 0 : 0];
    out[q + 2] = lut[b >= S ? S : b > 0 ? (b + 0.5) | 0 : 0];
    out[q + 3] = 255;
  }
  return out;
}

/**
 * Box-downsamples an sRGB RGBA tile by an integer factor (averaging in linear
 * light). Used when a pattern was generated supersampled.
 */
export function downsampleRgba(data: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray {
  const ow = Math.floor(w / k);
  const oh = Math.floor(h / k);
  const out = new Uint8ClampedArray(ow * oh * 4);
  const lin = SRGB8_TO_LINEAR;
  const inv = 1 / (k * k);
  const acc = new Float64Array(ow * 3);
  for (let oy = 0; oy < oh; oy++) {
    acc.fill(0);
    for (let dy = 0; dy < k; dy++) {
      const row = (oy * k + dy) * w;
      for (let ox = 0; ox < ow; ox++) {
        let p = (row + ox * k) * 4;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dx = 0; dx < k; dx++, p += 4) {
          r += lin[data[p]];
          g += lin[data[p + 1]];
          b += lin[data[p + 2]];
        }
        acc[ox * 3] += r;
        acc[ox * 3 + 1] += g;
        acc[ox * 3 + 2] += b;
      }
    }
    for (let ox = 0, q = oy * ow * 4; ox < ow; ox++, q += 4) {
      out[q] = encodeLinear(acc[ox * 3] * inv);
      out[q + 1] = encodeLinear(acc[ox * 3 + 1] * inv);
      out[q + 2] = encodeLinear(acc[ox * 3 + 2] * inv);
      out[q + 3] = 255;
    }
  }
  return out;
}
