/**
 * Coverage masks (0..255 per pixel) and the drawing operations used by the
 * editor's brush / eraser / polygon / lasso tools, plus compact RLE storage.
 *
 * Coordinate convention: pixel (i, j) covers [i, i+1) × [j, j+1); its center
 * is at (i + 0.5, j + 0.5). Brushes and polygons sample at pixel centers.
 */
import type { Pt } from '../../shared/types';
import { normalizeHex } from './color';
import type { ImageDataLike, Mask } from './types';

export type MaskMode = 'add' | 'erase';

export interface BrushOptions {
  /** Radius in pixels. */
  radius: number;
  /** 0..1 — 1 = hard edge, 0 = soft falloff from center. */
  hardness: number;
  mode: MaskMode;
  /** 0..1, default 1. Max coverage a single stamp adds/removes. */
  opacity?: number;
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

function dim(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function createMask(width: number, height: number): Mask {
  const w = dim(width);
  const h = dim(height);
  return { width: w, height: h, data: new Uint8Array(w * h) };
}

export function cloneMask(m: Mask): Mask {
  return { width: m.width, height: m.height, data: new Uint8Array(m.data) };
}

function assertSameSize(a: Mask, b: Mask, what: string): void {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    throw new Error(`${what}: mask sizes differ (${a.width}×${a.height} vs ${b.width}×${b.height})`);
  }
}

/** Copy src bytes into dst (same size). Throws when sizes differ. */
export function copyMaskInto(dst: Mask, src: Mask): void {
  assertSameSize(dst, src, 'copyMaskInto');
  dst.data.set(src.data);
}

/** Covered area in pixels: sum(data) / 255. */
export function maskCoverage(m: Mask): number {
  const d = m.data;
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  return s / 255;
}

export function isMaskEmpty(m: Mask): boolean {
  const d = m.data;
  const n = d.length;
  let i = 0;
  // Check 4 bytes at a time when the buffer is aligned.
  if ((d.byteOffset & 3) === 0) {
    const n32 = n >> 2;
    const d32 = new Uint32Array(d.buffer, d.byteOffset, n32);
    for (let k = 0; k < n32; k++) if (d32[k] !== 0) return false;
    i = n32 << 2;
  }
  for (; i < n; i++) if (d[i] !== 0) return false;
  return true;
}

/** Bounding box of pixels > 0, or null when empty. */
export function maskBounds(m: Mask): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h, data: d } = m;
  if (w === 0 || h === 0) return null;
  let y0 = -1;
  for (let y = 0; y < h && y0 < 0; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (d[row + x] !== 0) {
        y0 = y;
        break;
      }
    }
  }
  if (y0 < 0) return null;
  let y1 = y0;
  for (let y = h - 1; y > y0; y--) {
    const row = y * w;
    let hit = false;
    for (let x = 0; x < w; x++) {
      if (d[row + x] !== 0) {
        hit = true;
        break;
      }
    }
    if (hit) {
      y1 = y;
      break;
    }
  }
  let x0 = w;
  let x1 = -1;
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = 0; x < x0; x++) {
      if (d[row + x] !== 0) {
        x0 = x;
        break;
      }
    }
    for (let x = w - 1; x > x1; x--) {
      if (d[row + x] !== 0) {
        x1 = x;
        break;
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------------------------------------------------------------------------
// Brushes
// ---------------------------------------------------------------------------

/** Radial falloff of a brush: coverage 1 up to `inner`, smoothly 0 at `outer`. */
export interface BrushProfile {
  inner: number;
  outer: number;
}

/**
 * Falloff for a brush of `radius` and `hardness`. A hard brush still gets a
 * ~1 px anti-aliased rim; hardness 0 falls off smoothly from the center.
 */
export function brushProfile(radius: number, hardness: number): BrushProfile {
  const r = Number.isFinite(radius) ? Math.max(0.5, radius) : 0.5;
  const h = Number.isFinite(hardness) ? Math.min(1, Math.max(0, hardness)) : 1;
  const inner = Math.max(0, r * h - 0.5);
  const outer = Math.max(inner + 1, r + 0.5);
  return { inner, outer };
}

/** Coverage 0..1 at distance `d` from the brush center (smoothstep falloff). */
export function brushFalloff(d: number, p: BrushProfile): number {
  if (d <= p.inner) return 1;
  if (d >= p.outer) return 0;
  const t = (d - p.inner) / (p.outer - p.inner);
  return 1 - t * t * (3 - 2 * t);
}

function opacityOf(o: number | undefined): number {
  if (o === undefined) return 1;
  return Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 1;
}

/**
 * Applies a capsule-shaped brush (all points within the profile of segment
 * a→b; a == b gives a round stamp) to the mask: max-combine for 'add',
 * min-combine for 'erase', so a single stroke never exceeds `opacity`.
 * Only the capsule's bounding box is visited.
 */
function applyCapsule(m: Mask, ax: number, ay: number, bx: number, by: number, opts: BrushOptions): void {
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return;
  const { width: w, height: h, data } = m;
  const prof = brushProfile(opts.radius, opts.hardness);
  const opacity = opacityOf(opts.opacity);
  if (opacity <= 0 || w === 0 || h === 0) return;
  const R = prof.outer;
  const xMin = Math.max(0, Math.floor(Math.min(ax, bx) - R));
  const xMax = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + R));
  const yMin = Math.max(0, Math.floor(Math.min(ay, by) - R));
  const yMax = Math.min(h - 1, Math.ceil(Math.max(ay, by) + R));
  if (xMin > xMax || yMin > yMax) return;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const inv = len2 > 1e-12 ? 1 / len2 : 0;
  const inner2 = prof.inner * prof.inner;
  const outer2 = R * R;
  const scale = 255 * opacity;
  const erase = opts.mode === 'erase';

  for (let y = yMin; y <= yMax; y++) {
    const py = y + 0.5;
    const row = y * w;
    for (let x = xMin; x <= xMax; x++) {
      const px = x + 0.5;
      let t = ((px - ax) * dx + (py - ay) * dy) * inv;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const ex = px - (ax + t * dx);
      const ey = py - (ay + t * dy);
      const d2 = ex * ex + ey * ey;
      if (d2 >= outer2) continue;
      const cov = d2 <= inner2 ? 1 : brushFalloff(Math.sqrt(d2), prof);
      const v = Math.round(cov * scale);
      if (v === 0) continue;
      const i = row + x;
      if (erase) {
        const lim = 255 - v;
        if (data[i] > lim) data[i] = lim;
      } else if (data[i] < v) data[i] = v;
    }
  }
}

export function stampBrush(m: Mask, x: number, y: number, opts: BrushOptions): void {
  applyCapsule(m, x, y, x, y, opts);
}

/**
 * Stamps along the segment with spacing ≈ radius/4 (excluding the `from` point).
 *
 * Implemented as the continuous limit of that stamping — every pixel gets the
 * coverage of its closest point on the segment — which is identical for hard
 * brushes and free of scalloping for soft ones. Because stamps max-/min-
 * combine, re-covering `from` (already stamped by the previous segment) has
 * no effect. A zero-length segment does nothing.
 */
export function strokeBrush(m: Mask, from: Pt, to: Pt, opts: BrushOptions): void {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-9) return;
  applyCapsule(m, from.x, from.y, to.x, to.y, opts);
}

// ---------------------------------------------------------------------------
// Polygon fill
// ---------------------------------------------------------------------------

interface Edge {
  x0: number;
  y0: number;
  /** dx/dy */
  slope: number;
  yTop: number;
  yBot: number;
}

const SUBSAMPLES = 4;

/**
 * Fills a closed polygon (even-odd). Anti-aliased edges when `antialias`
 * (default true): 4 sub-scanlines per pixel row and exact horizontal span
 * coverage. 'add' max-combines, 'erase' min-combines.
 */
export function fillPolygon(m: Mask, points: Pt[], mode: MaskMode, antialias = true): void {
  const { width: w, height: h, data } = m;
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3 || w === 0 || h === 0) return;

  const edges: Edge[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x);
    if (a.y === b.y) continue; // horizontal edges never cross a scanline
    const top = a.y < b.y ? a : b;
    const bot = a.y < b.y ? b : a;
    edges.push({ x0: top.x, y0: top.y, slope: (bot.x - top.x) / (bot.y - top.y), yTop: top.y, yBot: bot.y });
    minY = Math.min(minY, top.y);
    maxY = Math.max(maxY, bot.y);
  }
  if (edges.length < 2) return;
  edges.sort((p, q) => p.yTop - q.yTop);

  const rowY0 = Math.max(0, Math.floor(minY));
  const rowY1 = Math.min(h - 1, Math.ceil(maxY));
  const bx0 = Math.max(0, Math.floor(minX));
  const bx1 = Math.min(w - 1, Math.ceil(maxX));
  if (rowY0 > rowY1 || bx0 > bx1) return;
  const bw = bx1 - bx0 + 1;

  const cov = new Float32Array(bw + 1);
  const diff = new Float32Array(bw + 2);
  const xs: number[] = [];
  const active: Edge[] = [];
  let nextEdge = 0;
  const samples = antialias ? SUBSAMPLES : 1;
  const weight = 1 / samples;
  const erase = mode === 'erase';

  for (let y = rowY0; y <= rowY1; y++) {
    cov.fill(0);
    diff.fill(0);
    let any = false;
    for (let s = 0; s < samples; s++) {
      const sy = y + (s + 0.5) / samples;
      // Maintain the active edge table: edges with yTop <= sy < yBot.
      while (nextEdge < edges.length && edges[nextEdge].yTop <= sy) active.push(edges[nextEdge++]);
      let k = 0;
      xs.length = 0;
      for (let e = 0; e < active.length; e++) {
        const ed = active[e];
        if (ed.yBot <= sy) continue;
        active[k++] = ed;
        if (ed.yTop <= sy) xs.push(ed.x0 + (sy - ed.y0) * ed.slope);
      }
      active.length = k;
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        let xa = xs[i] - bx0;
        let xb = xs[i + 1] - bx0;
        if (xb <= 0 || xa >= bw) continue;
        if (xa < 0) xa = 0;
        if (xb > bw) xb = bw;
        if (antialias) {
          // Exact horizontal coverage of [xa, xb) in pixel units.
          const ia = Math.floor(xa);
          const ib = Math.floor(xb);
          if (ia === ib) {
            cov[ia] += (xb - xa) * weight;
          } else {
            cov[ia] += (ia + 1 - xa) * weight;
            diff[ia + 1] += weight;
            diff[ib] -= weight;
            if (ib < bw) cov[ib] += (xb - ib) * weight;
          }
        } else {
          // Pixels whose centers lie inside [xa, xb).
          const ia = Math.max(0, Math.ceil(xa - 0.5));
          const ib = Math.min(bw, Math.ceil(xb - 0.5));
          if (ib > ia) {
            diff[ia] += 1;
            diff[ib] -= 1;
          }
        }
        any = true;
      }
    }
    if (!any) continue;
    const row = y * w + bx0;
    let run = 0;
    for (let x = 0; x < bw; x++) {
      run += diff[x];
      let c = cov[x] + run;
      if (c <= 0.001) continue;
      if (c > 1) c = 1;
      const v = Math.round(c * 255);
      const i = row + x;
      if (erase) {
        const lim = 255 - v;
        if (data[i] > lim) data[i] = lim;
      } else if (data[i] < v) data[i] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// Whole-mask operations
// ---------------------------------------------------------------------------

export function invertMask(m: Mask): void {
  const d = m.data;
  for (let i = 0; i < d.length; i++) d[i] = 255 - d[i];
}

export function clearMask(m: Mask): void {
  m.data.fill(0);
}

export function fillMask(m: Mask): void {
  m.data.fill(255);
}

/** Region of interest: the mask bounds grown by `pad`, clipped to the image. */
function paddedBounds(m: Mask, pad: number): { x: number; y: number; w: number; h: number } | null {
  const b = maskBounds(m);
  if (!b) return null;
  const x0 = Math.max(0, b.x - pad);
  const y0 = Math.max(0, b.y - pad);
  const x1 = Math.min(m.width, b.x + b.w + pad);
  const y1 = Math.min(m.height, b.y + b.h + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Normalized 1D gaussian kernel with radius ceil(3σ). */
function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Horizontal convolution of every row with edge replication (via a padded row copy). */
function convolveRows(src: Float32Array, dst: Float32Array, w: number, h: number, k: Float32Array): void {
  const r = (k.length - 1) >> 1;
  const taps = k.length;
  const pad = new Float32Array(w + 2 * r);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row];
    const last = src[row + w - 1];
    for (let i = 0; i < r; i++) {
      pad[i] = first;
      pad[r + w + i] = last;
    }
    pad.set(src.subarray(row, row + w), r);
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < taps; j++) s += pad[x + j] * k[j];
      dst[row + x] = s;
    }
  }
}

/** Vertical convolution with edge replication, accumulated row by row (cache friendly). */
function convolveCols(src: Float32Array, dst: Float32Array, w: number, h: number, k: Float32Array): void {
  const r = (k.length - 1) >> 1;
  for (let y = 0; y < h; y++) {
    const out = y * w;
    dst.fill(0, out, out + w);
    for (let j = -r; j <= r; j++) {
      const sy = y + j < 0 ? 0 : y + j >= h ? h - 1 : y + j;
      const inRow = sy * w;
      const kv = k[j + r];
      for (let x = 0; x < w; x++) dst[out + x] += src[inRow + x] * kv;
    }
  }
}

/** Box blur of radius `r` along rows (running sum, edge replication). */
function boxBlurRows(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (2 * r + 1);
  const last = w - 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let j = -r; j <= r; j++) s += src[row + (j < 0 ? 0 : j > last ? last : j)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = s * norm;
      const add = x + r + 1;
      const sub = x - r;
      s += src[row + (add > last ? last : add)] - src[row + (sub < 0 ? 0 : sub)];
    }
  }
}

/** Box blur of radius `r` along columns, using per-column running sums (cache friendly). */
function boxBlurCols(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (2 * r + 1);
  const last = h - 1;
  const acc = new Float64Array(w);
  for (let j = -r; j <= r; j++) {
    const row = (j < 0 ? 0 : j > last ? last : j) * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const out = y * w;
    const add = (y + r + 1 > last ? last : y + r + 1) * w;
    const sub = (y - r < 0 ? 0 : y - r) * w;
    for (let x = 0; x < w; x++) {
      dst[out + x] = acc[x] * norm;
      acc[x] += src[add + x] - src[sub + x];
    }
  }
}

/** Box radii for 3 passes approximating a gaussian of `sigma` (Kutskir / Wells). */
function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const mm = Math.round(mIdeal);
  const radii: number[] = [];
  for (let i = 0; i < n; i++) radii.push(((i < mm ? wl : wu) - 1) / 2);
  return radii;
}

/**
 * Softens edges with a blur of `radius` px (in place): a separable gaussian
 * with σ = radius / 2 (exact kernel for small radii, 3 box passes — constant
 * cost per pixel — for larger ones). Only the mask bounds plus the blur reach
 * are processed; image borders replicate, so a mask touching the frame stays
 * solid there.
 */
export function featherMask(m: Mask, radius: number): void {
  if (!Number.isFinite(radius) || radius <= 0) return;
  const sigma = radius / 2;
  if (sigma < 0.25) return;
  const useGauss = sigma <= 2;
  const kernel = useGauss ? gaussianKernel(sigma) : null;
  const boxes = useGauss ? [] : boxesForGauss(sigma);
  const reach = kernel ? (kernel.length - 1) >> 1 : boxes.reduce((a, b) => a + b, 0);
  const roi = paddedBounds(m, reach + 1);
  if (!roi) return;
  const { x: rx, y: ry, w: rw, h: rh } = roi;
  let a = new Float32Array(rw * rh);
  let b = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    const srcRow = (ry + y) * m.width + rx;
    for (let x = 0; x < rw; x++) a[y * rw + x] = m.data[srcRow + x];
  }
  if (kernel) {
    convolveRows(a, b, rw, rh, kernel);
    convolveCols(b, a, rw, rh, kernel);
  } else {
    for (const r of boxes) {
      boxBlurRows(a, b, rw, rh, r);
      [a, b] = [b, a];
    }
    for (const r of boxes) {
      boxBlurCols(a, b, rw, rh, r);
      [a, b] = [b, a];
    }
  }
  for (let y = 0; y < rh; y++) {
    const dstRow = (ry + y) * m.width + rx;
    const srcRow = y * rw;
    for (let x = 0; x < rw; x++) {
      const v = a[srcRow + x];
      m.data[dstRow + x] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
    }
  }
}

/** dst[i] = max of src over the 3-pixel horizontal window (clipped at row ends). */
function rowMax3(src: Uint8Array, dst: Uint8Array, w: number, h: number): void {
  if (w === 1) {
    dst.set(src);
    return;
  }
  for (let row = 0, end = w * h; row < end; row += w) {
    let prev = src[row];
    let cur = prev;
    let next = src[row + 1];
    dst[row] = cur > next ? cur : next;
    for (let x = 1; x < w - 1; x++) {
      prev = cur;
      cur = next;
      next = src[row + x + 1];
      const v = prev > cur ? prev : cur;
      dst[row + x] = v > next ? v : next;
    }
    dst[row + w - 1] = cur > next ? cur : next;
  }
}

/** dst[i] = max(center[i], vert[i - w], vert[i + w]) (rows outside the buffer are ignored). */
function colMax(center: Uint8Array, vert: Uint8Array, dst: Uint8Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const end = row + w;
    const up = y > 0;
    const down = y < h - 1;
    if (up && down) {
      for (let i = row; i < end; i++) {
        let v = center[i];
        const a = vert[i - w];
        const b = vert[i + w];
        if (a > v) v = a;
        if (b > v) v = b;
        dst[i] = v;
      }
    } else if (up || down) {
      const off = up ? -w : w;
      for (let i = row; i < end; i++) {
        const v = center[i];
        const a = vert[i + off];
        dst[i] = a > v ? a : v;
      }
    } else {
      for (let i = row; i < end; i++) dst[i] = center[i];
    }
  }
}

/**
 * One dilation step on a w×h buffer: 'cross' = 4-neighbourhood, 'square' =
 * 8-neighbourhood. Neighbours outside the buffer are ignored, so image
 * borders neither grow nor erode the mask.
 */
function dilateStep(src: Uint8Array, dst: Uint8Array, tmp: Uint8Array, w: number, h: number, shape: 'cross' | 'square'): void {
  rowMax3(src, tmp, w, h);
  if (shape === 'cross') colMax(tmp, src, dst, w, h);
  else colMax(tmp, tmp, dst, w, h);
}

function invertBuffer(a: Uint8Array): void {
  for (let i = 0; i < a.length; i++) a[i] = 255 - a[i];
}

/**
 * Shape of morphology step `i`: 8-neighbourhood ("square") steps make up
 * ~40% of the steps, spread evenly, the rest are 4-neighbourhood ("cross").
 * n steps then form an octagon with vertices near (n, 0.4n) — close to a
 * regular octagon around a disc of radius n (plain alternation overshoots
 * the disc area by ~20%).
 */
function stepShape(i: number): 'cross' | 'square' {
  return Math.floor((i + 1) * SQUARE_STEP_RATIO) > Math.floor(i * SQUARE_STEP_RATIO) ? 'square' : 'cross';
}
const SQUARE_STEP_RATIO = 0.4;

/**
 * Grayscale dilation (max) or erosion (min) by an octagonal approximation of
 * a disc of `radius` px (see stepShape; erosion = dilation of the inverse).
 * Soft edges keep their profile, shifted. A fractional radius blends in the
 * last step. Work is limited to the mask bounds plus the reach.
 */
function morph(m: Mask, radius: number, isMax: boolean): void {
  if (!Number.isFinite(radius) || radius <= 0) return;
  const steps = Math.floor(radius);
  const frac = radius - steps;
  const total = steps + (frac > 1e-6 ? 1 : 0);
  if (total === 0) return;
  // Erosion only needs one pixel of context outside the bounds (zeros there propagate inward).
  const roi = paddedBounds(m, isMax ? total + 1 : 1);
  if (!roi) return;
  const { x: rx, y: ry, w: rw, h: rh } = roi;
  let a = new Uint8Array(rw * rh);
  let b = new Uint8Array(rw * rh);
  const tmp = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) a.set(m.data.subarray((ry + y) * m.width + rx, (ry + y) * m.width + rx + rw), y * rw);
  if (!isMax) invertBuffer(a);
  for (let s = 0; s < steps; s++) {
    dilateStep(a, b, tmp, rw, rh, stepShape(s));
    [a, b] = [b, a];
  }
  if (frac > 1e-6) {
    dilateStep(a, b, tmp, rw, rh, stepShape(steps));
    for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i] + (b[i] - a[i]) * frac);
  }
  if (!isMax) invertBuffer(a);
  for (let y = 0; y < rh; y++) m.data.set(a.subarray(y * rw, y * rw + rw), (ry + y) * m.width + rx);
}

/** Grows (dilate) the covered area by `radius` px (in place). */
export function growMask(m: Mask, radius: number): void {
  morph(m, radius, true);
}

/** Shrinks (erode) the covered area by `radius` px (in place). Image borders do not erode. */
export function shrinkMask(m: Mask, radius: number): void {
  morph(m, radius, false);
}

/** target = target ∪/−/∩ other (same size). Throws when sizes differ. */
export function combineMasks(target: Mask, other: Mask, op: 'union' | 'subtract' | 'intersect'): void {
  assertSameSize(target, other, 'combineMasks');
  const t = target.data;
  const o = other.data;
  const n = t.length;
  if (op === 'union') {
    for (let i = 0; i < n; i++) if (o[i] > t[i]) t[i] = o[i];
  } else if (op === 'intersect') {
    for (let i = 0; i < n; i++) if (o[i] < t[i]) t[i] = o[i];
  } else {
    for (let i = 0; i < n; i++) {
      const lim = 255 - o[i];
      if (t[i] > lim) t[i] = lim;
    }
  }
}

// ---------------------------------------------------------------------------
// RLE
// ---------------------------------------------------------------------------

const RLE_VERSION = 1;

function varintSize(v: number): number {
  let n = 1;
  while (v >= 0x80) {
    v = Math.floor(v / 128);
    n++;
  }
  return n;
}

/**
 * Compact run-length encoding (lossless).
 * Format: 1 version byte (1), then for each run of identical bytes:
 * the byte value followed by the run length as an unsigned LEB128 varint.
 */
export function encodeMaskRLE(m: Mask): Uint8Array {
  const d = m.data;
  const n = d.length;
  // Pass 1: exact output size.
  let size = 1;
  for (let i = 0; i < n; ) {
    const v = d[i];
    let j = i + 1;
    while (j < n && d[j] === v) j++;
    size += 1 + varintSize(j - i);
    i = j;
  }
  const out = new Uint8Array(size);
  out[0] = RLE_VERSION;
  let o = 1;
  for (let i = 0; i < n; ) {
    const v = d[i];
    let j = i + 1;
    while (j < n && d[j] === v) j++;
    out[o++] = v;
    let len = j - i;
    while (len >= 0x80) {
      out[o++] = (len & 0x7f) | 0x80;
      len = Math.floor(len / 128);
    }
    out[o++] = len;
    i = j;
  }
  return out;
}

/** Inverse of encodeMaskRLE. Throws on malformed or mismatched data. */
export function decodeMaskRLE(bytes: Uint8Array, width: number, height: number): Mask {
  const m = createMask(width, height);
  const d = m.data;
  const n = d.length;
  if (bytes.length === 0 || bytes[0] !== RLE_VERSION) throw new Error('decodeMaskRLE: unknown mask format');
  let o = 0;
  let i = 1;
  while (i < bytes.length) {
    const v = bytes[i++];
    let len = 0;
    let mul = 1;
    for (;;) {
      if (i >= bytes.length) throw new Error('decodeMaskRLE: truncated data');
      const b = bytes[i++];
      len += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) break;
      mul *= 128;
      if (mul > 2 ** 35) throw new Error('decodeMaskRLE: corrupt run length');
    }
    if (len === 0 || o + len > n) throw new Error('decodeMaskRLE: runs exceed mask size');
    if (v !== 0) d.fill(v, o, o + len);
    o += len;
  }
  if (o !== n) throw new Error('decodeMaskRLE: runs do not cover the mask');
  return m;
}

/** Nearest-neighbour resize (used when photos are re-imported at a different size). */
export function resizeMask(m: Mask, width: number, height: number): Mask {
  const out = createMask(width, height);
  const { width: sw, height: sh, data: s } = m;
  const { width: dw, height: dh, data: d } = out;
  if (sw === 0 || sh === 0 || dw === 0 || dh === 0) return out;
  if (sw === dw && sh === dh) {
    d.set(s);
    return out;
  }
  const xs = new Int32Array(dw);
  for (let x = 0; x < dw; x++) xs[x] = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    const sRow = sy * sw;
    const dRow = y * dw;
    for (let x = 0; x < dw; x++) d[dRow + x] = s[sRow + xs[x]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function packRGBA(r: number, g: number, b: number, a: number): number {
  return LITTLE_ENDIAN ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function hexChannels(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? '#000000';
  const v = parseInt(n.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Writes `lut[mask value]` for every pixel (32-bit stores when the buffer allows). */
function writeLut(m: Mask, out: ImageDataLike, lut: Uint32Array): void {
  const md = m.data;
  const n = Math.min(md.length, out.width * out.height);
  const od = out.data;
  if ((od.byteOffset & 3) === 0) {
    const o32 = new Uint32Array(od.buffer, od.byteOffset, n);
    for (let i = 0; i < n; i++) o32[i] = lut[md[i]];
    return;
  }
  for (let i = 0; i < n; i++) {
    const v = lut[md[i]];
    const p = i * 4;
    if (LITTLE_ENDIAN) {
      od[p] = v & 255;
      od[p + 1] = (v >>> 8) & 255;
      od[p + 2] = (v >>> 16) & 255;
      od[p + 3] = v >>> 24;
    } else {
      od[p] = v >>> 24;
      od[p + 1] = (v >>> 16) & 255;
      od[p + 2] = (v >>> 8) & 255;
      od[p + 3] = v & 255;
    }
  }
}

/**
 * RGBA overlay for display: `hex` at `alpha` × coverage inside, transparent outside.
 * Writes into `out` when given (must be same size) to avoid allocations.
 */
export function maskToOverlay(m: Mask, hex: string, alpha: number, out?: ImageDataLike): ImageDataLike {
  const target =
    out && out.width === m.width && out.height === m.height
      ? out
      : { width: m.width, height: m.height, data: new Uint8ClampedArray(m.width * m.height * 4) };
  const [r, g, b] = hexChannels(hex);
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  const lut = new Uint32Array(256);
  for (let v = 1; v < 256; v++) {
    const av = Math.round((a * v * 255) / 255);
    lut[v] = av === 0 ? 0 : packRGBA(r, g, b, av);
  }
  writeLut(m, target, lut);
  return target;
}

/**
 * RGBA image with opaque `hex` pixels on the mask boundary (1-2 px), transparent elsewhere.
 * The boundary is drawn on both sides of the 50% coverage contour (inside pixels
 * with an outside 4-neighbour and vice versa); the image frame is not a boundary.
 */
export function maskOutline(m: Mask, hex: string): ImageDataLike {
  const { width: w, height: h, data: d } = m;
  const out: ImageDataLike = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const roi = paddedBounds(m, 1);
  if (!roi) return out;
  const [r, g, b] = hexChannels(hex);
  const od = out.data;
  const x1 = roi.x + roi.w;
  const y1 = roi.y + roi.h;
  for (let y = roi.y; y < y1; y++) {
    const row = y * w;
    for (let x = roi.x; x < x1; x++) {
      const i = row + x;
      const inside = d[i] >= 128;
      let edge = false;
      if (x > 0 && d[i - 1] >= 128 !== inside) edge = true;
      else if (x < w - 1 && d[i + 1] >= 128 !== inside) edge = true;
      else if (y > 0 && d[i - w] >= 128 !== inside) edge = true;
      else if (y < h - 1 && d[i + w] >= 128 !== inside) edge = true;
      if (edge) {
        const p = i * 4;
        od[p] = r;
        od[p + 1] = g;
        od[p + 2] = b;
        od[p + 3] = 255;
      }
    }
  }
  return out;
}
