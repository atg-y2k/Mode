/**
 * Photo-realistic repainting of a masked surface.
 *
 * The original photo supplies shading (light falloff, shadows, texture); the
 * paint supplies hue/chroma and base lightness. A uniform region painted with
 * a color must come out as (very nearly) that color; darker pixels stay darker,
 * highlights stay highlights. Finish controls how much specular highlight is
 * kept (flat ≈ none, gloss ≈ most).
 */
import type { PaintFinish } from '../../shared/types';
import { hexToRgb, labArrayToSrgb8, rgbaToLabArray, rgbToLab } from './color';
import type { ImageDataLike, Mask } from './types';

export interface RegionStats {
  /** Number of pixels with mask > 0, weighted by coverage (sum(mask)/255). */
  count: number;
  meanL: number;
  meanA: number;
  meanB: number;
  /** 10th / 90th percentile of L inside the region. */
  p10L: number;
  p90L: number;
}

export interface PaintOptions {
  hex: string;
  finish: PaintFinish;
  /** 0..1 */
  strength: number;
}

/** How much of the original highlight lightness each finish keeps (above p90L). */
export const FINISH_HIGHLIGHT: Record<PaintFinish, number> = {
  flat: 0,
  matte: 0.1,
  eggshell: 0.25,
  satin: 0.4,
  'semi-gloss': 0.6,
  gloss: 0.75,
};

/** Base fraction of the photo's lightness variation carried into the paint. */
const SHADING_K = 0.9;
/** Fraction of the original chroma deviation (colored light, stains) kept. */
const CHROMA_KEEP = 0.08;
/** Clamp for the headroom scaling of k (see applyPaint). */
const K_SCALE_MIN = 0.3;
const K_SCALE_MAX = 1.8;
/** Shading stays linear up to this fraction of the headroom, then rolls off smoothly. */
const KNEE = 0.6;

const HIST_BINS = 1001; // L quantized to 0.1

/** Bounding box of mask > 0 within the first w×h pixels, or null. */
function boundsWithin(mask: Mask, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const md = mask.data;
  const mw = mask.width;
  let x0 = w, y0 = -1, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * mw;
    let first = -1;
    for (let x = 0; x < w; x++) {
      if (md[row + x] !== 0) {
        first = x;
        break;
      }
    }
    if (first < 0) continue;
    if (y0 < 0) y0 = y;
    y1 = y;
    if (first < x0) x0 = first;
    for (let x = w - 1; x > x1; x--) {
      if (md[row + x] !== 0) {
        x1 = x;
        break;
      }
    }
  }
  if (y0 < 0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Covered span [start, end] of mask row `row` (offset of the row's first
 * pixel) between x0 and x1, or null when that part of the row is empty.
 */
function rowSpan(md: Uint8Array, row: number, x0: number, x1: number): [number, number] | null {
  let s = x0;
  while (s <= x1 && md[row + s] === 0) s++;
  if (s > x1) return null;
  let e = x1;
  while (md[row + e] === 0) e--;
  return [s, e];
}

/** Lab statistics of `src` inside `mask`. Empty mask -> count 0 and neutral values. */
export function computeRegionStats(src: ImageDataLike, mask: Mask): RegionStats {
  const empty: RegionStats = { count: 0, meanL: 50, meanA: 0, meanB: 0, p10L: 50, p90L: 50 };
  const w = Math.min(src.width, mask.width);
  const h = Math.min(src.height, mask.height);
  const bb = boundsWithin(mask, w, h);
  if (!bb) return empty;
  const sd = src.data;
  const md = mask.data;
  const rowLab = new Float32Array((bb.x1 - bb.x0 + 1) * 3);
  const hist = new Float64Array(HIST_BINS);
  let wSum = 0, sL = 0, sA = 0, sB = 0;
  for (let y = bb.y0; y <= bb.y1; y++) {
    const mRow = y * mask.width;
    const span = rowSpan(md, mRow, bb.x0, bb.x1);
    if (!span) continue;
    const [xs, xe] = span;
    const sRow = y * src.width;
    rgbaToLabArray(sd.subarray((sRow + xs) * 4, (sRow + xe + 1) * 4), rowLab, xe - xs + 1);
    for (let x = xs, o = 0; x <= xe; x++, o += 3) {
      const cov = md[mRow + x];
      if (cov === 0) continue;
      const L = rowLab[o];
      wSum += cov;
      sL += L * cov;
      sA += rowLab[o + 1] * cov;
      sB += rowLab[o + 2] * cov;
      const bin = Math.min(HIST_BINS - 1, Math.max(0, Math.round(L * 10)));
      hist[bin] += cov;
    }
  }
  if (wSum === 0) return empty;
  const percentile = (q: number) => {
    const target = q * wSum;
    let acc = 0;
    for (let i = 0; i < HIST_BINS; i++) {
      acc += hist[i];
      if (acc >= target) return i / 10;
    }
    return (HIST_BINS - 1) / 10;
  };
  return {
    count: wSum / 255,
    meanL: sL / wSum,
    meanA: sA / wSum,
    meanB: sB / wSum,
    p10L: percentile(0.1),
    p90L: percentile(0.9),
  };
}

/** 32-bit FNV-1a style checksum of the mask bytes (≈1 ms per megapixel). */
function maskSignature(m: Mask): number {
  const d = m.data;
  let h = 0x811c9dc5 ^ m.width ^ (m.height << 16);
  let i = 0;
  if ((d.byteOffset & 3) === 0) {
    const n32 = d.length >> 2;
    const d32 = new Uint32Array(d.buffer, d.byteOffset, n32);
    for (let k = 0; k < n32; k++) h = Math.imul(h ^ d32[k], 0x01000193);
    i = n32 << 2;
  }
  for (; i < d.length; i++) h = Math.imul(h ^ d[i], 0x01000193);
  return h >>> 0;
}

const statsMemo = new WeakMap<Mask, { src: ImageDataLike; sig: number; stats: RegionStats }>();

/**
 * computeRegionStats with a per-mask memo: reused while the same `src` is
 * passed and the mask bytes are unchanged (checked with a checksum, so
 * in-place mask edits invalidate it). applyPaint uses it when no `stats`
 * are given, so repainting a region a different color skips the stats pass.
 */
export function regionStatsMemo(src: ImageDataLike, mask: Mask): RegionStats {
  const sig = maskSignature(mask);
  const hit = statsMemo.get(mask);
  if (hit && hit.src === src && hit.sig === sig) return hit.stats;
  const stats = computeRegionStats(src, mask);
  statsMemo.set(mask, { src, sig, stats });
  return stats;
}

/**
 * Linear for |d| ≤ KNEE·head, then a tanh shoulder that approaches `head`
 * asymptotically: monotonic, slope-continuous, never exceeds the headroom.
 */
function softLimit(d: number, head: number): number {
  const knee = KNEE * head;
  if (d <= knee) return d;
  const span = head - knee;
  if (span <= 1e-9) return knee;
  return knee + span * Math.tanh((d - knee) / span);
}

function smoothstep(e0: number, e1: number, x: number): number {
  if (x <= e0) return 0;
  if (x >= e1) return 1;
  const t = (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}

/** Resolution of the lightness transfer tables (entries per L unit). */
const TABLE_RES = 20;
const TABLE_SIZE = 100 * TABLE_RES + 2;

/**
 * Everything in applyPaint that depends only on the original lightness L,
 * tabulated once per call: painted lightness before the finish (lp), the
 * chroma scale (ratio) and the highlight blend weight (hw).
 */
interface PaintTables {
  lp: Float32Array;
  ratio: Float32Array;
  hw: Float32Array;
}

function buildPaintTables(targetL: number, st: RegionStats, finish: PaintFinish): PaintTables {
  const lp = new Float32Array(TABLE_SIZE);
  const ratio = new Float32Array(TABLE_SIZE);
  const hw = new Float32Array(TABLE_SIZE);
  const meanL = st.meanL;
  const kScale = Math.min(K_SCALE_MAX, Math.max(K_SCALE_MIN, (targetL + 16) / (Math.max(0, meanL) + 16)));
  const k = SHADING_K * kScale;
  const headUp = Math.max(0, 100 - targetL);
  const headDown = Math.max(0, targetL);
  const hiFactor = FINISH_HIGHLIGHT[finish] ?? 0;
  const p90 = st.p90L;
  // The highlight blend ramps in over a band above p90 that scales with the
  // region's lightness spread, so only real highlights get the full effect.
  const hiEnd = p90 + Math.max(3, (st.p90L - st.p10L) * 0.75);
  for (let i = 0; i < TABLE_SIZE; i++) {
    const L = i / TABLE_RES;
    const d = (L - meanL) * k;
    const v = d >= 0 ? targetL + softLimit(d, headUp) : targetL - softLimit(-d, headDown);
    lp[i] = v;
    ratio[i] = Math.min(1.15, Math.max(0, (v + 16) / (targetL + 16)));
    hw[i] = hiFactor > 0 && L > p90 && L > v ? hiFactor * smoothstep(p90, hiEnd, L) : 0;
  }
  return { lp, ratio, hw };
}

/**
 * Paints `mask` area. Reads shading from `src` (the ORIGINAL photo) and writes
 * into `dst` (the composite so far, same size), blending by mask coverage × strength.
 * Pixels where mask = 0 are untouched. `stats` may be passed to skip recomputation
 * (otherwise they come from regionStatsMemo).
 *
 * Per pixel (Lab):
 * - Lightness: L' = targetL + (L − meanL)·k. k = 0.9 scaled by the headroom
 *   ratio (targetL + 16) / (meanL + 16), clamped to [0.3, 1.8] — this is
 *   exactly how a multiplicative change of reflectance moves L, so a light
 *   wall repainted navy keeps proportionally softer shadows and a dark wall
 *   repainted white gets stronger ones. The deviation then rolls off smoothly
 *   before 0 / 100 so very dark or light colors never clip or posterize.
 * - Chroma: the target a/b, scaled with the pixel's lightness ratio (shadows
 *   of a saturated paint get darker, not neon), plus 8% of the original
 *   chroma deviation (colored light, subtle variation).
 * - Finish: pixels brighter than p90L blend back toward their original
 *   lightness and color (never darker) by the finish's highlight factor,
 *   ramping in smoothly above p90L.
 * - Out-of-gamut results are clipped per channel in linear light.
 * Invalid hex or strength ≤ 0 leaves `dst` untouched.
 */
export function applyPaint(
  src: ImageDataLike,
  dst: ImageDataLike,
  mask: Mask,
  opts: PaintOptions,
  stats?: RegionStats,
): void {
  const strength = Number.isFinite(opts.strength) ? Math.min(1, Math.max(0, opts.strength)) : 0;
  if (strength <= 0) return;
  let target;
  try {
    target = rgbToLab(hexToRgb(opts.hex));
  } catch {
    return;
  }
  const w = Math.min(src.width, dst.width, mask.width);
  const h = Math.min(src.height, dst.height, mask.height);
  const bb = boundsWithin(mask, w, h);
  if (!bb) return;
  const st = stats ?? regionStatsMemo(src, mask);
  if (!(st.count > 0)) return;

  const { lp: lpT, ratio: ratioT, hw: hwT } = buildPaintTables(target.l, st, opts.finish);
  const tA = target.a, tB = target.b;
  const offA = CHROMA_KEEP * st.meanA;
  const offB = CHROMA_KEEP * st.meanB;
  const maxIdx = TABLE_SIZE - 2;

  const sd = src.data;
  const dd = dst.data;
  const md = mask.data;
  const row = new Float32Array((bb.x1 - bb.x0 + 1) * 3);
  const covScale = strength / 255;

  for (let y = bb.y0; y <= bb.y1; y++) {
    const mRow = y * mask.width;
    const span = rowSpan(md, mRow, bb.x0, bb.x1);
    if (!span) continue;
    const [xs, xe] = span;
    const n = xe - xs + 1;
    const sRow = y * src.width;
    rgbaToLabArray(sd.subarray((sRow + xs) * 4, (sRow + xe + 1) * 4), row, n);

    // Lab -> painted Lab, in place.
    for (let o = 0, end = n * 3; o < end; o += 3) {
      const L = row[o], A = row[o + 1], B = row[o + 2];
      const t = Math.min(maxIdx, Math.max(0, L * TABLE_RES));
      const k = t | 0;
      const f = t - k;
      let Lp = lpT[k] + (lpT[k + 1] - lpT[k]) * f;
      const ratio = ratioT[k] + (ratioT[k + 1] - ratioT[k]) * f;
      let ap = tA * ratio + CHROMA_KEEP * A - offA;
      let bp = tB * ratio + CHROMA_KEEP * B - offB;
      const hw = hwT[k] + (hwT[k + 1] - hwT[k]) * f;
      if (hw > 0) {
        Lp += (L - Lp) * hw;
        ap += (A - ap) * hw;
        bp += (B - bp) * hw;
      }
      row[o] = Lp;
      row[o + 1] = ap;
      row[o + 2] = bp;
    }
    labArrayToSrgb8(row, row, n);

    // Blend into dst by coverage × strength.
    const dRow = y * dst.width;
    for (let x = xs, o = 0; x <= xe; x++, o += 3) {
      const cov = md[mRow + x];
      if (cov === 0) continue;
      const alpha = cov * covScale;
      const dp = (dRow + x) * 4;
      if (alpha >= 1) {
        dd[dp] = row[o];
        dd[dp + 1] = row[o + 1];
        dd[dp + 2] = row[o + 2];
      } else {
        dd[dp] = dd[dp] + (row[o] - dd[dp]) * alpha;
        dd[dp + 1] = dd[dp + 1] + (row[o + 1] - dd[dp + 1]) * alpha;
        dd[dp + 2] = dd[dp + 2] + (row[o + 2] - dd[dp + 2]) * alpha;
      }
    }
  }
}
