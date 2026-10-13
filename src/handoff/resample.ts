/**
 * Pure pixel resampling for the hand-off engine (no DOM, runs in node,
 * workers and the main thread alike):
 * - separable bicubic resampling with Pillow-style antialiasing (the kernel
 *   widens when shrinking), for RGBA and single-channel images;
 * - grayscale conversion;
 * - bilinear affine warp with a validity mask.
 *
 * Coordinate convention used across src/handoff: continuous coordinates
 * where pixel (i, j) covers [i, i+1) × [j, j+1) and its centre is
 * (i + 0.5, j + 0.5). A rect {x, y, w, h} therefore spans exactly w × h
 * pixels and resampling it to W × H maps continuous coords linearly.
 */
import type { ImageDataLike, Mask } from '../engine/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Single-channel 8-bit image (grayscale, masks). */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 2×3 affine [a, b, c, d, e, f]: x' = a·x + b·y + c, y' = d·x + e·y + f (continuous coords). */
export type Affine = [number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Separable resampling
// ---------------------------------------------------------------------------

/** Bicubic (Keys, a = −0.5 — Catmull-Rom) kernel; support 2. */
function bicubic(x: number): number {
  const a = -0.5;
  const t = Math.abs(x);
  if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1;
  if (t < 2) return (((t - 5) * t + 8) * t - 4) * a;
  return 0;
}

interface Taps {
  /** First source index per output sample. */
  start: Int32Array;
  /** Number of taps per output sample. */
  count: Int32Array;
  /** Weights, `maxTaps` per output sample. */
  weights: Float32Array;
  maxTaps: number;
}

/**
 * Filter taps mapping the source span [srcStart, srcStart + srcLen) onto
 * `outLen` samples (source index range clamped to [0, srcSize)).
 */
function computeTaps(srcSize: number, srcStart: number, srcLen: number, outLen: number): Taps {
  const scale = outLen / srcLen; // output px per source px
  const filterScale = Math.max(1, 1 / scale);
  const support = 2 * filterScale;
  const maxTaps = Math.ceil(support) * 2 + 2;
  const start = new Int32Array(outLen);
  const count = new Int32Array(outLen);
  const weights = new Float32Array(outLen * maxTaps);
  for (let i = 0; i < outLen; i++) {
    const centre = srcStart + (i + 0.5) / scale; // continuous source coordinate
    let lo = Math.floor(centre - support);
    let hi = Math.ceil(centre + support);
    if (lo < 0) lo = 0;
    if (hi > srcSize) hi = srcSize;
    let n = hi - lo;
    if (n > maxTaps) n = maxTaps;
    if (n <= 0) {
      // Span entirely outside the source: replicate the nearest edge pixel.
      start[i] = Math.min(srcSize - 1, Math.max(0, Math.floor(centre)));
      count[i] = 1;
      weights[i * maxTaps] = 1;
      continue;
    }
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const w = bicubic((lo + k + 0.5 - centre) / filterScale);
      weights[i * maxTaps + k] = w;
      sum += w;
    }
    if (Math.abs(sum) < 1e-8) {
      weights[i * maxTaps] = 1;
      n = 1;
      sum = 1;
    }
    for (let k = 0; k < n; k++) weights[i * maxTaps + k] /= sum;
    start[i] = lo;
    count[i] = n;
  }
  return { start, count, weights, maxTaps };
}

/** Source rows [lo, hi) the vertical taps touch. */
function rowSpan(ty: Taps, outH: number): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = 0;
  for (let i = 0; i < outH; i++) {
    lo = Math.min(lo, ty.start[i]);
    hi = Math.max(hi, ty.start[i] + ty.count[i]);
  }
  return { lo: lo === Infinity ? 0 : lo, hi };
}

/**
 * Resamples `rect` (continuous source coords; taps past the edges are
 * dropped and the rest renormalized) of an RGBA image to outW × outH.
 * Shrinking is antialiased; enlarging is Catmull-Rom bicubic. Alpha is
 * forced opaque. Two separable passes with all four channels per tap.
 */
export function resampleRGBA(img: ImageDataLike, rect: Rect, outW: number, outH: number): ImageDataLike {
  const src = img.data;
  const srcW = img.width;
  const tx = computeTaps(srcW, rect.x, rect.w, outW);
  const ty = computeTaps(img.height, rect.y, rect.h, outH);
  const { lo, hi } = rowSpan(ty, outH);
  const rows = Math.max(0, hi - lo);
  const rowLen = outW * 4;
  // Horizontal pass → rows × outW × RGB (alpha dropped).
  const mid = new Float32Array(rows * rowLen);
  const txw = tx.weights;
  const txs = tx.start;
  const txc = tx.count;
  const txm = tx.maxTaps;
  for (let r = 0; r < rows; r++) {
    const srcRow = (lo + r) * srcW * 4;
    let o = r * rowLen;
    for (let i = 0; i < outW; i++, o += 4) {
      const n = txc[i];
      const wo = i * txm;
      let p = srcRow + txs[i] * 4;
      let ar = 0;
      let ag = 0;
      let ab = 0;
      for (let k = 0; k < n; k++, p += 4) {
        const w = txw[wo + k];
        ar += src[p] * w;
        ag += src[p + 1] * w;
        ab += src[p + 2] * w;
      }
      mid[o] = ar;
      mid[o + 1] = ag;
      mid[o + 2] = ab;
    }
  }
  // Vertical pass, one output row at a time into a float accumulator.
  const data = new Uint8ClampedArray(outW * outH * 4);
  const acc = new Float32Array(rowLen);
  for (let j = 0; j < outH; j++) {
    acc.fill(0);
    const n = ty.count[j];
    const wo = j * ty.maxTaps;
    const s0 = ty.start[j] - lo;
    for (let k = 0; k < n; k++) {
      const w = ty.weights[wo + k];
      const m = (s0 + k) * rowLen;
      for (let x = 0; x < rowLen; x++) acc[x] += mid[m + x] * w;
    }
    const o = j * rowLen;
    for (let x = 0; x < rowLen; x += 4) {
      data[o + x] = acc[x]; // Uint8ClampedArray clamps & rounds
      data[o + x + 1] = acc[x + 1];
      data[o + x + 2] = acc[x + 2];
      data[o + x + 3] = 255;
    }
  }
  return { width: outW, height: outH, data };
}

/** Resamples `rect` of a single-channel image to outW × outH. */
export function resampleGray(img: GrayImage, rect: Rect, outW: number, outH: number): GrayImage {
  const src = img.data;
  const srcW = img.width;
  const tx = computeTaps(srcW, rect.x, rect.w, outW);
  const ty = computeTaps(img.height, rect.y, rect.h, outH);
  const { lo, hi } = rowSpan(ty, outH);
  const rows = Math.max(0, hi - lo);
  const mid = new Float32Array(rows * outW);
  for (let r = 0; r < rows; r++) {
    const srcRow = (lo + r) * srcW;
    const o = r * outW;
    for (let i = 0; i < outW; i++) {
      const n = tx.count[i];
      const wo = i * tx.maxTaps;
      const p = srcRow + tx.start[i];
      let a = 0;
      for (let k = 0; k < n; k++) a += src[p + k] * tx.weights[wo + k];
      mid[o + i] = a;
    }
  }
  const data = new Uint8Array(outW * outH);
  const acc = new Float32Array(outW);
  for (let j = 0; j < outH; j++) {
    acc.fill(0);
    const n = ty.count[j];
    const wo = j * ty.maxTaps;
    const s0 = ty.start[j] - lo;
    for (let k = 0; k < n; k++) {
      const w = ty.weights[wo + k];
      const m = (s0 + k) * outW;
      for (let x = 0; x < outW; x++) acc[x] += mid[m + x] * w;
    }
    const o = j * outW;
    for (let x = 0; x < outW; x++) {
      const v = acc[x];
      data[o + x] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
    }
  }
  return { width: outW, height: outH, data };
}

/** Rec. 601 luma of an RGBA image (integer math). */
export function toGray(img: ImageDataLike): GrayImage {
  const n = img.width * img.height;
  const data = new Uint8Array(n);
  const s = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) data[i] = (s[p] * 77 + s[p + 1] * 150 + s[p + 2] * 29 + 128) >> 8;
  return { width: img.width, height: img.height, data };
}

/** View of a Mask as a GrayImage (shares the buffer). */
export function maskAsGray(m: Mask): GrayImage {
  return { width: m.width, height: m.height, data: m.data };
}

// ---------------------------------------------------------------------------
// Affine helpers
// ---------------------------------------------------------------------------

export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

/** (outer ∘ inner)(p) = outer(inner(p)). */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [a * A + b * D, a * B + b * E, a * C + b * F + c, d * A + e * D, d * B + e * E, d * C + e * F + f];
}

export function invertAffine(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const ia = e / det;
  const ib = -b / det;
  const id = -d / det;
  const ie = a / det;
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)];
}

export function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] };
}

/** Mean linear scale √|det| of the affine's linear part. */
export function affineScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[4] - m[1] * m[3]));
}

/** Affine mapping rect `from` onto rect `to` (axis-aligned scale + translate). */
export function rectToRect(from: Rect, to: Rect): Affine {
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  return [sx, 0, to.x - from.x * sx, 0, sy, to.y - from.y * sy];
}

// ---------------------------------------------------------------------------
// Warp
// ---------------------------------------------------------------------------

export interface WarpResult {
  image: ImageDataLike;
  /** 255 where the output pixel came from inside the source, 0 elsewhere. */
  valid: Uint8Array;
}

/**
 * Output pixel (u, v) of an outW × outH image samples `src` at
 * M(u + 0.5 + outX, v + 0.5 + outY) (continuous), bilinear, where M maps
 * output-frame coords to source coords. `outX/outY` offset the output grid
 * inside the frame M is expressed in (e.g. the crop origin in photo px).
 * Source should be at roughly the output's scale (pre-shrink it with
 * resampleRGBA when M shrinks a lot, so bilinear doesn't alias).
 */
export function warpAffineRGBA(src: ImageDataLike, m: Affine, outW: number, outH: number, outX = 0, outY = 0): WarpResult {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const valid = new Uint8Array(outW * outH);
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  const [a, b, c, d, e, f] = m;
  for (let v = 0; v < outH; v++) {
    const py = v + 0.5 + outY;
    for (let u = 0; u < outW; u++) {
      const px = u + 0.5 + outX;
      // Source continuous coords → array coords of the pixel centres.
      const sx = a * px + b * py + c - 0.5;
      const sy = d * px + e * py + f - 0.5;
      const o = (v * outW + u) * 4;
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue;
      let x0 = Math.floor(sx);
      let y0 = Math.floor(sy);
      let fx = sx - x0;
      let fy = sy - y0;
      if (x0 < 0) {
        x0 = 0;
        fx = 0;
      } else if (x0 >= sw - 1) {
        x0 = sw - 1;
        fx = 0;
      }
      if (y0 < 0) {
        y0 = 0;
        fy = 0;
      } else if (y0 >= sh - 1) {
        y0 = sh - 1;
        fy = 0;
      }
      const x1 = fx > 0 ? x0 + 1 : x0;
      const y1 = fy > 0 ? y0 + 1 : y0;
      const p00 = (y0 * sw + x0) * 4;
      const p10 = (y0 * sw + x1) * 4;
      const p01 = (y1 * sw + x0) * 4;
      const p11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      out[o] = s[p00] * w00 + s[p10] * w10 + s[p01] * w01 + s[p11] * w11;
      out[o + 1] = s[p00 + 1] * w00 + s[p10 + 1] * w10 + s[p01 + 1] * w01 + s[p11 + 1] * w11;
      out[o + 2] = s[p00 + 2] * w00 + s[p10 + 2] * w10 + s[p01 + 2] * w01 + s[p11 + 2] * w11;
      out[o + 3] = 255;
      valid[v * outW + u] = 255;
    }
  }
  return { image: { width: outW, height: outH, data: out }, valid };
}
