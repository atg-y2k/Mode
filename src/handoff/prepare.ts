/**
 * Export side of the hand-off: what the user pastes into ChatGPT / Gemini.
 *
 * Crop-and-stitch (A1111 "only masked" / ComfyUI Inpaint-CropAndStitch,
 * re-implemented): small targets are exported as a crop with generous
 * context so the model spends its ~1–2 K output pixels on the edit; large
 * ones as the full frame. The export is snapped to an aspect ratio the app
 * produces by GROWING the crop (never squashing), resized, and re-encoded
 * (which drops EXIF / GPS). The marked copy carries an outline-only marker
 * in the least-present of magenta / cyan / lime, with a 1 px dark halo,
 * drawn just outside the composite band (see bands.ts).
 *
 * Everything except the final encode is pure and unit-tested in node.
 */
import type { HandoffApp } from '../../shared/types';
import type { ImageDataLike, Mask } from '../engine/types';
import {
  BAND_EDGE_THRESHOLD,
  bandBounds,
  compositeBand,
  distanceSquared,
  isWholeCoverage,
  markerGapExportPx,
  markerMarginPhotoPx,
  markerStroke,
  maskCoverageShare,
} from './bands';
import { resampleRGBA, type Rect } from './resample';

// ---------------------------------------------------------------------------
// Aspect ratios
// ---------------------------------------------------------------------------

export interface RatioSpec {
  label: string;
  w: number;
  h: number;
}

const r = (w: number, h: number): RatioSpec => ({ label: `${w}:${h}`, w, h });

/**
 * Default aspect ratios each app returns edited photos in (the export is
 * snapped to one of them). ChatGPT: GPT Image 2 / 2.5 accept custom sizes
 * (edges multiples of 16, aspect 1:3 … 3:1) and the app's Resize presets
 * include 4:3, 3:4, 16:9 and 9:16 besides the API's recommended 1:1 / 3:2 /
 * 2:3. What each app really returns is unmeasured — a user can override the
 * table (Settings → Hand-off → advanced; PrepareOptions.ratios).
 */
export const HANDOFF_RATIOS: Record<HandoffApp, readonly RatioSpec[]> = {
  chatgpt: [r(1, 1), r(3, 2), r(2, 3), r(4, 3), r(3, 4), r(16, 9), r(9, 16)],
  gemini: [r(1, 1), r(3, 2), r(2, 3), r(4, 3), r(3, 4), r(16, 9), r(9, 16), r(4, 5), r(5, 4)],
};

/** Ratios outside 1:3 … 3:1 are refused (no app returns them). */
const MAX_RATIO_ASPECT = 3;

/**
 * Parses a user's ratio list ("1:1, 3:2, 4:3" — also "x", "/" or spaces as
 * separators): valid, de-duplicated ratios within 1:3 … 3:1, in order.
 * Returns [] when nothing usable is in the text.
 */
export function parseRatioList(text: string): RatioSpec[] {
  const out: RatioSpec[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)/gi)) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!(w > 0 && h > 0)) continue;
    const a = w / h;
    if (a > MAX_RATIO_ASPECT + 1e-9 || a < 1 / MAX_RATIO_ASPECT - 1e-9) continue;
    const label = `${m[1]}:${m[2]}`;
    if (out.some((o) => Math.abs(o.w / o.h - a) < 1e-6)) continue;
    out.push({ label, w, h });
  }
  return out;
}

/** The ratio list to snap to: a usable override, else the app's defaults. */
export function ratiosFor(app: HandoffApp, override?: readonly RatioSpec[] | null): readonly RatioSpec[] {
  return override && override.length > 0 ? override : HANDOFF_RATIOS[app];
}

const COMMON_RATIOS: readonly RatioSpec[] = [
  r(1, 1), r(5, 4), r(4, 5), r(4, 3), r(3, 4), r(3, 2), r(2, 3), r(16, 10), r(10, 16), r(16, 9), r(9, 16), r(2, 1), r(1, 2), r(21, 9),
];

/** Human label for an arbitrary aspect: the common ratio within 2 %, else "1.85:1". */
export function ratioLabel(w: number, h: number): string {
  const a = w / h;
  let best: RatioSpec | null = null;
  let bestErr = Infinity;
  for (const c of COMMON_RATIOS) {
    const err = Math.abs(Math.log(a / (c.w / c.h)));
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  if (best && bestErr < 0.02) return best.label;
  return a >= 1 ? `${a.toFixed(2)}:1` : `1:${(1 / a).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Crop planning
// ---------------------------------------------------------------------------

/** Targets covering less than this share of the frame are exported as a crop. */
export const CROP_MAX_COVERAGE = 0.375;
/** A crop must be at least this share of the photo in each dimension (enough context). */
export const CROP_MIN_SIDE = 1 / 3;
/** Context added on each side of the target, as a share of the target's size. */
export const CROP_CONTEXT = 0.4;
/** Crops larger than this share of the frame gain too little — send the full frame instead. */
export const CROP_MAX_AREA = 0.7;
export const FULL_MAX_EDGE = 2048;
export const CROP_MAX_EDGE = 1536;

export interface ExportPlan {
  crop: Rect;
  /** Ratio label of the export ("4:3"). */
  ratio: string;
  mode: 'crop' | 'full';
}

function clampRect(rect: Rect, W: number, H: number): Rect {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(W, rect.x + rect.w);
  const y1 = Math.min(H, rect.y + rect.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Moves (and if needed shrinks) `rect` to lie inside W × H. */
function fitInside(rect: Rect, W: number, H: number): Rect {
  const w = Math.min(rect.w, W);
  const h = Math.min(rect.h, H);
  const x = Math.min(Math.max(0, rect.x + (rect.w - w) / 2), W - w);
  const y = Math.min(Math.max(0, rect.y + (rect.h - h) / 2), H - h);
  return { x, y, w, h };
}

/**
 * Grows `desired` to the best ratio in `ratios` (closest to its own aspect)
 * such that the result lies inside W × H and contains `required`. A ratio
 * that only fits by shrinking the desired context is allowed but scored
 * lower. Returns integer px; null when no ratio can contain `required`.
 */
export function snapToRatio(
  desired: Rect,
  required: Rect,
  W: number,
  H: number,
  ratios: readonly RatioSpec[],
): { rect: Rect; ratio: RatioSpec } | null {
  const aspect = desired.w / desired.h;
  let best: { rect: Rect; ratio: RatioSpec; score: number } | null = null;
  for (const ratio of ratios) {
    const rv = ratio.w / ratio.h;
    let w = desired.w;
    let h = desired.h;
    if (w / h < rv) w = h * rv;
    else h = w / rv;
    const k = Math.min(1, W / w, H / h);
    w *= k;
    h *= k;
    // Integer size with the ratio as exact as rounding allows.
    let wi = Math.min(W, Math.round(w));
    let hi = Math.min(H, Math.round(wi / rv));
    if (hi > H) {
      hi = H;
      wi = Math.min(W, Math.round(hi * rv));
    }
    if (wi < Math.ceil(required.w) || hi < Math.ceil(required.h)) continue;
    const cx = desired.x + desired.w / 2;
    const cy = desired.y + desired.h / 2;
    let x = Math.round(Math.min(Math.max(0, cx - wi / 2), W - wi));
    let y = Math.round(Math.min(Math.max(0, cy - hi / 2), H - hi));
    // Keep the required rect inside.
    if (x > required.x) x = Math.floor(required.x);
    if (x + wi < required.x + required.w) x = Math.ceil(required.x + required.w) - wi;
    if (y > required.y) y = Math.floor(required.y);
    if (y + hi < required.y + required.h) y = Math.ceil(required.y + required.h) - hi;
    x = Math.min(Math.max(0, x), W - wi);
    y = Math.min(Math.max(0, y), H - hi);
    const score = Math.abs(Math.log(rv / aspect)) + (k < 1 ? (1 - k) * 0.5 : 0);
    if (!best || score < best.score - 1e-9) best = { rect: { x, y, w: wi, h: hi }, ratio, score };
  }
  return best ? { rect: best.rect, ratio: best.ratio } : null;
}

/**
 * Chooses the exported region of a W × H photo for a target whose composite
 * band has `band` bounds (null = whole image) and covers `coverage` of the
 * frame:
 * - whole image → the full frame at its own aspect (cropping would leave an
 *   unedited strip at the edges);
 * - coverage < 37.5 % → band + 40 % context per side, at least ⅓ of the
 *   photo per side, snapped to the app's ratios by growing; used when it is
 *   at most 70 % of the frame;
 * - otherwise → the full frame, trimmed to the closest app ratio when the
 *   band (+ marker margin) still fits, else unsnapped.
 * `margin` (photo px) keeps the marker inside the export.
 */
export function planExport(
  W: number,
  H: number,
  band: Rect | null,
  coverage: number,
  app: HandoffApp,
  opts: { fullFrame?: boolean; margin?: number; ratios?: readonly RatioSpec[] } = {},
): ExportPlan {
  const full: Rect = { x: 0, y: 0, w: W, h: H };
  if (!band) return { crop: full, ratio: ratioLabel(W, H), mode: 'full' };
  const ratios = ratiosFor(app, opts.ratios);
  const margin = opts.margin ?? Math.max(12, Math.round(Math.max(W, H) * 0.012));
  const required = clampRect({ x: band.x - margin, y: band.y - margin, w: band.w + 2 * margin, h: band.h + 2 * margin }, W, H);

  if (!opts.fullFrame && coverage < CROP_MAX_COVERAGE) {
    let ctx: Rect = {
      x: required.x - required.w * CROP_CONTEXT,
      y: required.y - required.h * CROP_CONTEXT,
      w: required.w * (1 + 2 * CROP_CONTEXT),
      h: required.h * (1 + 2 * CROP_CONTEXT),
    };
    const minW = W * CROP_MIN_SIDE;
    const minH = H * CROP_MIN_SIDE;
    if (ctx.w < minW) ctx = { ...ctx, x: ctx.x - (minW - ctx.w) / 2, w: minW };
    if (ctx.h < minH) ctx = { ...ctx, y: ctx.y - (minH - ctx.h) / 2, h: minH };
    ctx = fitInside(ctx, W, H);
    const snapped = snapToRatio(ctx, required, W, H, ratios);
    if (snapped && snapped.rect.w * snapped.rect.h <= CROP_MAX_AREA * W * H) {
      return { crop: snapped.rect, ratio: snapped.ratio.label, mode: 'crop' };
    }
  }
  const snapped = snapToRatio(full, required, W, H, ratios);
  if (snapped) return { crop: snapped.rect, ratio: snapped.ratio.label, mode: 'full' };
  return { crop: full, ratio: ratioLabel(W, H), mode: 'full' };
}

/** Export pixel size: long edge = maxEdge, aspect of the crop. */
export function exportSize(crop: Rect, maxEdge: number): { outW: number; outH: number } {
  const a = crop.w / crop.h;
  if (a >= 1) return { outW: maxEdge, outH: Math.max(1, Math.round(maxEdge / a)) };
  return { outW: Math.max(1, Math.round(maxEdge * a)), outH: maxEdge };
}

// ---------------------------------------------------------------------------
// Marker
// ---------------------------------------------------------------------------

export interface MarkerColor {
  hex: string;
  /** Name used in the prompt ("magenta"). */
  name: string;
  /** Hue in degrees (HSV). */
  hue: number;
}

/** Candidate marker colours, in order of preference on ties. */
export const MARKER_COLORS: readonly MarkerColor[] = [
  { hex: '#ff00ff', name: 'magenta', hue: 300 },
  { hex: '#00e5ff', name: 'cyan', hue: 186 },
  { hex: '#7cff00', name: 'lime green', hue: 91 },
];

/** Prompt name of a marker hex ("magenta"); '' for no marker, "colored" for an unknown hex. */
export function markerColorName(hex: string): string {
  const h = hex.trim().toLowerCase();
  if (!h) return '';
  return MARKER_COLORS.find((c) => c.hex === h)?.name ?? 'colored';
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * How many pixels of `rect` (sampled) are close to each marker colour:
 * saturated (S ≥ 0.3), not dark (V ≥ 0.25) and within 35° of its hue.
 */
export function markerHuePresence(img: ImageDataLike, rect?: Rect): number[] {
  const R = rect ?? { x: 0, y: 0, w: img.width, h: img.height };
  const x0 = Math.max(0, Math.floor(R.x));
  const y0 = Math.max(0, Math.floor(R.y));
  const x1 = Math.min(img.width, Math.ceil(R.x + R.w));
  const y1 = Math.min(img.height, Math.ceil(R.y + R.h));
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 250_000)));
  const counts = MARKER_COLORS.map(() => 0);
  const d = img.data;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const p = (y * img.width + x) * 4;
      const rr = d[p] / 255;
      const gg = d[p + 1] / 255;
      const bb = d[p + 2] / 255;
      const max = Math.max(rr, gg, bb);
      const min = Math.min(rr, gg, bb);
      const delta = max - min;
      if (max < 0.25 || delta / max < 0.3) continue;
      let hue: number;
      if (max === rr) hue = 60 * (((gg - bb) / delta) % 6);
      else if (max === gg) hue = 60 * ((bb - rr) / delta + 2);
      else hue = 60 * ((rr - gg) / delta + 4);
      if (hue < 0) hue += 360;
      for (let i = 0; i < MARKER_COLORS.length; i++) if (hueDistance(hue, MARKER_COLORS[i].hue) <= 35) counts[i]++;
    }
  }
  return counts;
}

/** The marker colour least present in `rect` of the image (ties → magenta, then cyan). */
export function chooseMarkerColor(img: ImageDataLike, rect?: Rect): MarkerColor {
  const counts = markerHuePresence(img, rect);
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] < counts[best]) best = i;
  return MARKER_COLORS[best];
}

/**
 * Draws the outline-only marker (in place) on an export image covering
 * `crop` of the photo: a distance field to the band's edge (band ≥
 * BAND_EDGE_THRESHOLD) is computed at photo resolution around the band,
 * sampled bilinearly at export resolution, and an anti-aliased ring of ink
 * with a 1 px dark halo on both sides is blended in `gap` beyond the edge.
 */
export function drawMarker(exportImg: ImageDataLike, band: Mask, crop: Rect, color: MarkerColor): void {
  const { width: W, height: H, data } = exportImg;
  const bounds = bandBounds(band);
  if (!bounds) return;
  const sx = crop.w / W; // photo px per export px
  const sy = crop.h / H;
  const scale = W / crop.w; // export px per photo px
  const { width: ink, halo } = markerStroke(Math.max(W, H));
  const gap = markerGapExportPx(scale);
  const inkStart = gap + halo; // inner edge of the ink (export px from the band edge)
  const inkEnd = inkStart + ink;
  const outer = inkEnd + halo;
  // Distance field (photo px) on the band bounds + ring reach.
  const pad = Math.ceil((outer + 2) / Math.min(scale, H / crop.h)) + 2;
  const bx0 = Math.max(0, bounds.x - pad);
  const by0 = Math.max(0, bounds.y - pad);
  const bx1 = Math.min(band.width, bounds.x + bounds.w + pad);
  const by1 = Math.min(band.height, bounds.y + bounds.h + pad);
  const fw = bx1 - bx0;
  const fh = by1 - by0;
  const bd = band.data;
  const bw = band.width;
  const d2 = distanceSquared(fw, fh, (i) => bd[(by0 + Math.floor(i / fw)) * bw + bx0 + (i % fw)] >= BAND_EDGE_THRESHOLD);
  const field = new Float32Array(fw * fh);
  for (let i = 0; i < field.length; i++) field[i] = Math.sqrt(d2[i]);
  // Export pixels covering the field.
  const u0 = Math.max(0, Math.floor((bx0 - crop.x) / sx));
  const v0 = Math.max(0, Math.floor((by0 - crop.y) / sy));
  const u1 = Math.min(W, Math.ceil((bx1 - crop.x) / sx));
  const v1 = Math.min(H, Math.ceil((by1 - crop.y) / sy));
  const lo = gap - 1;
  const hi = outer + 1;
  // Quick reject in photo px (a pixel's distance changes by ≤ 1.5 px within the bilinear cell).
  const rejectLo = lo / scale - 2;
  const rejectHi = hi / scale + 2;
  const cr = parseInt(color.hex.slice(1, 3), 16);
  const cg = parseInt(color.hex.slice(3, 5), 16);
  const cb = parseInt(color.hex.slice(5, 7), 16);
  const cover = (d: number, a: number, b: number) => Math.max(0, Math.min(1, d - a + 0.5, b - d + 0.5));
  for (let v = v0; v < v1; v++) {
    const fy = crop.y + (v + 0.5) * sy - 0.5 - by0;
    if (fy < 0 || fy > fh - 1) continue;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const y1 = Math.min(fh - 1, y0 + 1);
    for (let u = u0; u < u1; u++) {
      const fx = crop.x + (u + 0.5) * sx - 0.5 - bx0;
      if (fx < 0 || fx > fw - 1) continue;
      const x0 = Math.floor(fx);
      const near = field[y0 * fw + x0];
      if (near < rejectLo || near > rejectHi) continue;
      const tx = fx - x0;
      const x1 = Math.min(fw - 1, x0 + 1);
      const top = near + (field[y0 * fw + x1] - near) * tx;
      const bottom = field[y1 * fw + x0] + (field[y1 * fw + x1] - field[y1 * fw + x0]) * tx;
      // Distance to the band edge in export px (pixel-centre distances overshoot the edge by ~½ px).
      const d = (top + (bottom - top) * ty - 0.5) * scale;
      if (d < lo || d > hi) continue;
      const haloA = Math.max(cover(d, gap, inkStart), cover(d, inkEnd, outer)) * 0.75;
      const inkA = cover(d, inkStart, inkEnd);
      if (haloA <= 0 && inkA <= 0) continue;
      const p = (v * W + u) * 4;
      if (haloA > 0) {
        data[p] = data[p] * (1 - haloA);
        data[p + 1] = data[p + 1] * (1 - haloA);
        data[p + 2] = data[p + 2] * (1 - haloA);
      }
      if (inkA > 0) {
        data[p] = data[p] + (cr - data[p]) * inkA;
        data[p + 1] = data[p + 1] + (cg - data[p + 1]) * inkA;
        data[p + 2] = data[p + 2] + (cb - data[p + 2]) * inkA;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Whole pipeline (pure)
// ---------------------------------------------------------------------------

export interface RenderedHandoff {
  clean: ImageDataLike;
  marked: ImageDataLike;
  crop: Rect;
  outW: number;
  outH: number;
  /** '' when no marker is drawn (whole-image target). */
  markerColor: string;
  markerColorName: string;
  ratio: string;
  mode: 'crop' | 'full';
  /** Share of the photo the target covers (0..1). */
  coverage: number;
}

/** Crops `rect` of an image and resizes it to w × h (pure resampler by default; the browser passes a canvas one). */
export type Resizer = (img: ImageDataLike, rect: Rect, w: number, h: number) => ImageDataLike;

export interface RenderOptions {
  app: HandoffApp;
  maxEdge?: number;
  fullFrame?: boolean;
  /** Ratios to snap to instead of HANDOFF_RATIOS[app] (a user override; empty = defaults). */
  ratios?: readonly RatioSpec[];
  resize?: Resizer;
}

/**
 * Pixels of a hand-off export (see prepareHandoff): plan the crop, resample,
 * pick the marker colour and draw the marker on a copy.
 */
export function renderHandoff(image: ImageDataLike, target: Mask, opts: RenderOptions): RenderedHandoff {
  const W = image.width;
  const H = image.height;
  if (target.width !== W || target.height !== H) {
    throw new Error(`prepareHandoff: mask ${target.width}×${target.height} does not match the photo ${W}×${H}`);
  }
  const share = maskCoverageShare(target);
  const whole = isWholeCoverage(share);
  const coverage = whole ? 1 : share;
  const band = whole ? null : compositeBand(target, share);
  const bounds = band ? bandBounds(band) : null;
  // Marker margin at the smallest export scale this photo can get (a full
  // frame at the crop edge): crops only enlarge more, so the marker always fits.
  const marginEdge = opts.maxEdge ?? CROP_MAX_EDGE;
  const margin = markerMarginPhotoPx(marginEdge, marginEdge / Math.max(W, H));
  const plan = planExport(W, H, bounds, coverage, opts.app, { fullFrame: opts.fullFrame, margin, ratios: opts.ratios });
  const maxEdge = opts.maxEdge ?? (plan.mode === 'crop' ? CROP_MAX_EDGE : FULL_MAX_EDGE);
  const { outW, outH } = exportSize(plan.crop, maxEdge);
  const clean = (opts.resize ?? resampleRGBA)(image, plan.crop, outW, outH);
  const marked: ImageDataLike = { width: outW, height: outH, data: new Uint8ClampedArray(clean.data) };
  let markerColor = '';
  let colorName = '';
  if (band && bounds) {
    const color = chooseMarkerColor(image, plan.crop);
    drawMarker(marked, band, plan.crop, color);
    markerColor = color.hex;
    colorName = color.name;
  }
  return { clean, marked, crop: plan.crop, outW, outH, markerColor, markerColorName: colorName, ratio: plan.ratio, mode: plan.mode, coverage };
}
