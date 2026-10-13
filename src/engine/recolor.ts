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
import { hexToRgb, labToSrgb8Into, rgb8ToLabInto, rgbToLab } from './color';
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

/** Overlap of image and mask (they should be the same size; be defensive). */
function overlap(src: ImageDataLike, mask: Mask): { w: number; h: number } {
  return { w: Math.min(src.width, mask.width), h: Math.min(src.height, mask.height) };
}

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

/** Lab statistics of `src` inside `mask`. Empty mask -> count 0 and neutral values. */
export function computeRegionStats(src: ImageDataLike, mask: Mask): RegionStats {
  const empty: RegionStats = { count: 0, meanL: 50, meanA: 0, meanB: 0, p10L: 50, p90L: 50 };
  const { w, h } = overlap(src, mask);
  const bb = boundsWithin(mask, w, h);
  if (!bb) return empty;
  const sd = src.data;
  const md = mask.data;
  const lab = new Float64Array(3);
  const hist = new Float64Array(HIST_BINS);
  let wSum = 0, sL = 0, sA = 0, sB = 0;
  for (let y = bb.y0; y <= bb.y1; y++) {
    const mRow = y * mask.width;
    const sRow = y * src.width;
    for (let x = bb.x0; x <= bb.x1; x++) {
      const cov = md[mRow + x];
      if (cov === 0) continue;
      const p = (sRow + x) * 4;
      rgb8ToLabInto(sd[p], sd[p + 1], sd[p + 2], lab, 0);
      const L = lab[0];
      wSum += cov;
      sL += L * cov;
      sA += lab[1] * cov;
      sB += lab[2] * cov;
      let bin = Math.round(L * 10);
      if (bin < 0) bin = 0;
      else if (bin >= HIST_BINS) bin = HIST_BINS - 1;
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

/**
 * Paints `mask` area. Reads shading from `src` (the ORIGINAL photo) and writes
 * into `dst` (the composite so far, same size), blending by mask coverage × strength.
 * Pixels where mask = 0 are untouched. `stats` may be passed to skip recomputation.
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
  const st = stats ?? computeRegionStats(src, mask);
  if (st.count <= 0) return;

  const tL = target.l, tA = target.a, tB = target.b;
  const meanL = st.meanL, meanA = st.meanA, meanB = st.meanB;
  const kScale = Math.min(K_SCALE_MAX, Math.max(K_SCALE_MIN, (tL + 16) / (Math.max(0, meanL) + 16)));
  const k = SHADING_K * kScale;
  const headUp = Math.max(0, 100 - tL);
  const headDown = Math.max(0, tL);
  const invT16 = 1 / (tL + 16);

  const hiFactor = FINISH_HIGHLIGHT[opts.finish] ?? 0;
  const p90 = st.p90L;
  // The highlight blend ramps in over a band above p90 that scales with the
  // region's lightness spread, so only real highlights get the full effect.
  const hiBand = Math.max(3, (st.p90L - st.p10L) * 0.75);
  const hiEnd = p90 + hiBand;

  const sd = src.data;
  const dd = dst.data;
  const md = mask.data;
  const lab = new Float64Array(3);
  const rgb = new Float64Array(3);
  const covScale = strength / 255;

  for (let y = bb.y0; y <= bb.y1; y++) {
    const mRow = y * mask.width;
    const sRow = y * src.width;
    const dRow = y * dst.width;
    for (let x = bb.x0; x <= bb.x1; x++) {
      const cov = md[mRow + x];
      if (cov === 0) continue;
      const sp = (sRow + x) * 4;
      rgb8ToLabInto(sd[sp], sd[sp + 1], sd[sp + 2], lab, 0);
      const L = lab[0], A = lab[1], B = lab[2];

      // Lightness: scaled shading with soft roll-off toward 0 / 100.
      const d = (L - meanL) * k;
      let Lp = d >= 0 ? tL + softLimit(d, headUp) : tL - softLimit(-d, headDown);

      // Chroma follows lightness like a change of illumination would.
      let ratio = (Lp + 16) * invT16;
      if (ratio > 1.15) ratio = 1.15;
      else if (ratio < 0) ratio = 0;
      let ap = tA * ratio + CHROMA_KEEP * (A - meanA);
      let bp = tB * ratio + CHROMA_KEEP * (B - meanB);

      // Finish: keep (part of) specular highlights.
      if (hiFactor > 0 && L > p90 && L > Lp) {
        const wgt = hiFactor * smoothstep(p90, hiEnd, L);
        if (wgt > 0) {
          Lp += (L - Lp) * wgt;
          ap += (A - ap) * wgt;
          bp += (B - bp) * wgt;
        }
      }

      labToSrgb8Into(Lp, ap, bp, rgb, 0);
      const alpha = cov * covScale;
      const dp = (dRow + x) * 4;
      if (alpha >= 1) {
        dd[dp] = rgb[0];
        dd[dp + 1] = rgb[1];
        dd[dp + 2] = rgb[2];
      } else {
        dd[dp] = dd[dp] + (rgb[0] - dd[dp]) * alpha;
        dd[dp + 1] = dd[dp + 1] + (rgb[1] - dd[dp + 1]) * alpha;
        dd[dp + 2] = dd[dp + 2] + (rgb[2] - dd[dp + 2]) * alpha;
      }
    }
  }
}
