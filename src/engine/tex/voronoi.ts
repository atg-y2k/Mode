/**
 * Periodic (toroidal) power-diagram Voronoi maps: one jittered site per grid
 * cell, optional per-site weights for size variety. Edges are straight
 * bisectors, so cells read as stones, flags or pebbles; an optional warp
 * field bends them a little.
 */
import type { Rng } from './rng';
import type { Surface } from './surface';

export interface VoronoiSites {
  gx: number;
  gy: number;
  /** Site offset within its cell, 0..1 (x, y interleaved). */
  off: Float32Array;
  /** Power weight (inches²): larger → bigger cell. */
  wt: Float32Array;
  /** Cell size in inches. */
  cw: number;
  ch: number;
}

/**
 * Sites on a gx×gy grid of cw×ch-inch cells. `jitter` (0..1) is how far a
 * site may wander from its cell centre; `stagger` offsets odd rows by half a
 * cell (cobble / gravel packing); `weight` is the max power weight as a
 * fraction of the cell size squared.
 */
export function makeSites(
  rng: Rng,
  gx: number,
  gy: number,
  cw: number,
  ch: number,
  jitter: number,
  weight: number,
  stagger = false,
): VoronoiSites {
  const off = new Float32Array(gx * gy * 2);
  const wt = new Float32Array(gx * gy);
  const c2 = Math.min(cw, ch) ** 2;
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const k = j * gx + i;
      const base = stagger && j % 2 === 1 ? 1 : 0.5;
      off[k * 2] = (base + (rng.next() - 0.5) * jitter) % 1;
      off[k * 2 + 1] = 0.5 + (rng.next() - 0.5) * jitter;
      wt[k] = rng.next() * weight * c2;
    }
  }
  return { gx, gy, off, wt, cw, ch };
}

export interface VoronoiMap {
  /** Site id per pixel. */
  id: Int32Array;
  /** Distance to the cell boundary, inches (≥ 0). */
  edge: Float32Array;
  /** Offset of the pixel from its site, inches. */
  dx: Float32Array;
  dy: Float32Array;
}

/**
 * Computes the map for every pixel of `s`. `warpX/warpY` (inches, per pixel)
 * displace the lookup point to make edges irregular. Neighbourhood search is
 * 3×3 cells around the (warped) point — exact for jitter ≤ ~0.9 and modest
 * weights.
 */
export function voronoiMap(
  s: Surface,
  sites: VoronoiSites,
  warpX?: Float32Array,
  warpY?: Float32Array,
): VoronoiMap {
  const { w, h, sx, sy } = s;
  const { gx, gy, off, wt, cw, ch } = sites;
  const n = w * h;
  const id = new Int32Array(n);
  const edge = new Float32Array(n);
  const dxo = new Float32Array(n);
  const dyo = new Float32Array(n);
  // The 3×3 candidate sites around the current cell, refreshed only when the
  // lookup point moves to another cell (consecutive pixels mostly share one).
  const cxs = new Float64Array(9);
  const cys = new Float64Array(9);
  const cws = new Float64Array(9);
  const ids = new Int32Array(9);
  const pds = new Float64Array(9);
  let lastI = 0x7fffffff;
  let lastJ = 0x7fffffff;
  // Upper bound of the distance between two candidate sites.
  const maxLen = 3.2 * Math.max(cw, ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const px = (x + 0.5) / sx + (warpX ? warpX[i] : 0);
      const py = (y + 0.5) / sy + (warpY ? warpY[i] : 0);
      const ci = Math.floor(px / cw);
      const cj = Math.floor(py / ch);
      if (ci !== lastI || cj !== lastJ) {
        lastI = ci;
        lastJ = cj;
        let m = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = cj + dj;
          const rowK = (((jj % gy) + gy) % gy) * gx;
          for (let di = -1; di <= 1; di++) {
            const ii = ci + di;
            const k = rowK + (((ii % gx) + gx) % gx);
            cxs[m] = (ii + off[k * 2]) * cw;
            cys[m] = (jj + off[k * 2 + 1]) * ch;
            cws[m] = wt[k];
            ids[m] = k;
            m++;
          }
        }
      }
      let best = 0;
      let bestPd = Infinity;
      for (let m = 0; m < 9; m++) {
        const ex = px - cxs[m];
        const ey = py - cys[m];
        const pd = ex * ex + ey * ey - cws[m];
        pds[m] = pd;
        if (pd < bestPd) {
          bestPd = pd;
          best = m;
        }
      }
      const bx = cxs[best];
      const by = cys[best];
      let e = Infinity;
      for (let q = 0; q < 9; q++) {
        if (q === best) continue;
        const diff = pds[q] - bestPd;
        // The bisector distance diff / (2·len) is ≥ diff / (2·maxLen): skip hopeless candidates.
        if (diff > 2 * maxLen * e) continue;
        const ddx = cxs[q] - bx;
        const ddy = cys[q] - by;
        const len2 = ddx * ddx + ddy * ddy;
        if (len2 < 1e-12) continue;
        const d = diff / (2 * Math.sqrt(len2));
        if (d < e) e = d;
      }
      id[i] = ids[best];
      edge[i] = e;
      dxo[i] = px - bx;
      dyo[i] = py - by;
    }
  }
  return { id, edge, dx: dxo, dy: dyo };
}

export interface PebbleShapes {
  /** Inverse semi-axes (1/inches) and orientation (cos, sin) per site. */
  ia: Float32Array;
  ib: Float32Array;
  cos: Float32Array;
  sin: Float32Array;
  /** Dome height scale and base elevation per site, inches. */
  dome: Float32Array;
  z: Float32Array;
}

export interface PebbleMap {
  /** Visible pebble per pixel (-1 = gap, nothing covers it). */
  id: Int32Array;
  /** Surface elevation, inches. */
  height: Float32Array;
  /** Normalized radius 0 (centre) .. 1 (rim) on the visible pebble. */
  rr: Float32Array;
}

/**
 * A bed of overlapping ellipsoidal pebbles, one per site: each pixel shows
 * the highest pebble covering it (a height-field union), so stones overlap
 * with rounded silhouettes instead of meeting along straight Voronoi edges.
 */
export function pebbleMap(s: Surface, sites: VoronoiSites, sh: PebbleShapes): PebbleMap {
  const { w, h, sx, sy } = s;
  const { gx, gy, off, cw, ch } = sites;
  const n = w * h;
  const id = new Int32Array(n);
  const height = new Float32Array(n);
  const rrOut = new Float32Array(n);
  // Candidate pebbles of the 3×3 block around the current cell (cached per cell).
  const cxs = new Float64Array(9);
  const cys = new Float64Array(9);
  const ks = new Int32Array(9);
  let lastI = 0x7fffffff;
  let lastJ = 0x7fffffff;
  const { ia, ib, cos, sin, dome, z } = sh;
  for (let y = 0; y < h; y++) {
    const py = (y + 0.5) / sy;
    const cj = Math.floor(py / ch);
    for (let x = 0; x < w; x++) {
      const px = (x + 0.5) / sx;
      const ci = Math.floor(px / cw);
      if (ci !== lastI || cj !== lastJ) {
        lastI = ci;
        lastJ = cj;
        let m = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = cj + dj;
          const rowK = (((jj % gy) + gy) % gy) * gx;
          for (let di = -1; di <= 1; di++) {
            const ii = ci + di;
            const k = rowK + (((ii % gx) + gx) % gx);
            cxs[m] = (ii + off[k * 2]) * cw;
            cys[m] = (jj + off[k * 2 + 1]) * ch;
            ks[m] = k;
            m++;
          }
        }
      }
      let best = -1;
      let bestH = -Infinity;
      let bestR2 = 1;
      for (let m = 0; m < 9; m++) {
        const k = ks[m];
        const dx = px - cxs[m];
        const dy = py - cys[m];
        const pa = (dx * cos[k] + dy * sin[k]) * ia[k];
        const pb = (dy * cos[k] - dx * sin[k]) * ib[k];
        const r2 = pa * pa + pb * pb;
        if (r2 >= 1) continue;
        const hh = z[k] + dome[k] * Math.sqrt(1 - r2);
        if (hh > bestH) {
          bestH = hh;
          best = k;
          bestR2 = r2;
        }
      }
      const i = y * w + x;
      id[i] = best;
      height[i] = best >= 0 ? bestH : 0;
      rrOut[i] = Math.sqrt(bestR2);
    }
  }
  return { id, height, rr: rrOut };
}
