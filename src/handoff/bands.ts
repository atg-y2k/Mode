/**
 * The geometry shared by export and import: the COMPOSITE BAND (the target
 * grown 1–2 % and feathered — the only pixels a returned image may change)
 * and the selection MARKER drawn just outside it. Because the marker sits
 * beyond the band, any ink the model leaves behind lands on pixels the
 * composite restores from the original photo.
 *
 * prepareHandoff and importHandoffResult must be given the same target mask
 * so they derive the same band.
 */
import { createMask, featherMask, maskBounds } from '../engine/mask';
import type { Mask } from '../engine/types';

/** Coverage (of 255) below which a leftover marker pixel is invisible after compositing (≈1 %). */
export const BAND_EDGE_THRESHOLD = 3;
/** Gap (photo px) between the band's outer edge and the marker's dark halo. */
export const MARKER_GAP_PHOTO_PX = 3;
/** Share of the frame above which a target counts as "the whole image" (no marker, no crop). */
export const WHOLE_TARGET_COVERAGE = 0.9;

/** Grow / feather radii (photo px) of the composite band for a target of the given bounds. */
export function compositeRadii(
  width: number,
  height: number,
  bounds: { w: number; h: number } | null,
): { grow: number; feather: number } {
  const long = Math.max(width, height);
  const size = bounds ? Math.max(bounds.w, bounds.h) : long;
  // Grow ~1.5 % of the target's size (the model's overspill scales with what it draws),
  // capped at 2 % of the frame; feather ~0.6 % of the frame for a soft, invisible seam.
  const grow = Math.max(2, Math.min(Math.round(long * 0.02), Math.round(size * 0.015)));
  const feather = Math.max(2, Math.round(long * 0.006));
  return { grow, feather };
}

/** Share (0..1) of the frame the mask covers (soft coverage counts proportionally). */
export function maskCoverageShare(m: Mask): number {
  const d = m.data;
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i];
  return d.length ? sum / (255 * d.length) : 0;
}

/** Whether a coverage share means "the whole image may change" (empty, or ≥ 90 % of the frame). */
export function isWholeCoverage(coverage: number): boolean {
  return coverage === 0 || coverage >= WHOLE_TARGET_COVERAGE;
}

/**
 * True when the target means "the whole image may change": empty (a
 * whole-scope run without zones) or covering ≥ 90 % of the frame.
 */
export function isWholeTarget(target: Mask): boolean {
  return isWholeCoverage(maskCoverageShare(target));
}

/** Target coverage (of 255) from which a pixel seeds the band's growth (soft edges below it only blend). */
const BAND_SEED = 64;

/**
 * Composite band of `target` (photo size): the target grown by `grow` px
 * (exact Euclidean distance from its ≥ 25 % coverage, never less than the
 * target itself) and feathered. For a whole-image target the band is solid
 * 255. `coverage` can be passed when already known.
 */
export function compositeBand(target: Mask, coverage = maskCoverageShare(target)): Mask {
  const { width: W, height: H } = target;
  const band = createMask(W, H);
  if (isWholeCoverage(coverage)) {
    band.data.fill(255);
    return band;
  }
  const bounds = maskBounds(target);
  if (!bounds) return band;
  const { grow, feather } = compositeRadii(W, H, bounds);
  const pad = grow + 2;
  const x0 = Math.max(0, bounds.x - pad);
  const y0 = Math.max(0, bounds.y - pad);
  const x1 = Math.min(W, bounds.x + bounds.w + pad);
  const y1 = Math.min(H, bounds.y + bounds.h + pad);
  const rw = x1 - x0;
  const rh = y1 - y0;
  const t = target.data;
  const d2 = distanceSquared(rw, rh, (i) => t[(y0 + Math.floor(i / rw)) * W + x0 + (i % rw)] >= BAND_SEED);
  const r2 = (grow + 0.5) * (grow + 0.5);
  for (let y = 0; y < rh; y++) {
    const row = (y0 + y) * W + x0;
    for (let x = 0; x < rw; x++) {
      const v = d2[y * rw + x] <= r2 ? 255 : 0;
      band.data[row + x] = v > t[row + x] ? v : t[row + x];
    }
  }
  featherMask(band, feather);
  return band;
}

/** Bounds of the band pixels ≥ BAND_EDGE_THRESHOLD (null when none). */
export function bandBounds(band: Mask): { x: number; y: number; w: number; h: number } | null {
  const { width, height, data } = band;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] >= BAND_EDGE_THRESHOLD) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Marker stroke (export px): ink width and dark halo width, scaled to the export's long edge. */
export function markerStroke(exportLongEdge: number): { width: number; halo: number } {
  // ~0.3 % of the long edge (5 px at 1536, 6 px at 2048): still a clear line after the app downsamples its input.
  return { width: Math.max(4, Math.round(exportLongEdge * 0.003)), halo: 1 };
}

/** Gap (export px) between the band edge and the marker's halo, for an export scale. */
export function markerGapExportPx(exportPxPerPhotoPx: number): number {
  return Math.max(2, MARKER_GAP_PHOTO_PX * exportPxPerPhotoPx);
}

/**
 * Photo-px distance from the band edge to just beyond the marker's outer
 * halo (gap + halo + ink + halo, plus 2 px slack) for an export of the given
 * long edge and scale (export px per photo px): the margin to keep around
 * the band so the marker fits inside the export, and the ring the import
 * ignores when measuring colour drift and outside changes.
 */
export function markerMarginPhotoPx(exportLongEdge: number, exportPxPerPhotoPx: number): number {
  const { width, halo } = markerStroke(exportLongEdge);
  const scale = Math.max(0.05, exportPxPerPhotoPx);
  return Math.ceil((markerGapExportPx(scale) + width + 2 * halo) / scale) + 2;
}

// ---------------------------------------------------------------------------
// Euclidean distance transform (Felzenszwalb & Huttenlocher, exact, O(n))
// ---------------------------------------------------------------------------

const INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Squared Euclidean distance (px²) from every pixel to the nearest pixel
 * where `isSeed` is true (0 on seeds; ≥ 1e20 when there are no seeds).
 */
export function distanceSquared(width: number, height: number, isSeed: (i: number) => boolean): Float64Array {
  const n = width * height;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = isSeed(i) ? 0 : INF;
  const len = Math.max(width, height);
  const f = new Float64Array(len);
  const d = new Float64Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);
  // Columns.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = out[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) out[y * width + x] = d[y];
  }
  // Rows.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = out[row + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) out[row + x] = d[x];
  }
  return out;
}
