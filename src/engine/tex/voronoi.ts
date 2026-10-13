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
  const cxs = new Float64Array(9);
  const cys = new Float64Array(9);
  const pds = new Float64Array(9);
  const ids = new Int32Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const px = (x + 0.5) / sx + (warpX ? warpX[i] : 0);
      const py = (y + 0.5) / sy + (warpY ? warpY[i] : 0);
      const ci = Math.floor(px / cw);
      const cj = Math.floor(py / ch);
      let best = 0;
      let bestPd = Infinity;
      let m = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        const wj = ((jj % gy) + gy) % gy;
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          const wi = ((ii % gx) + gx) % gx;
          const k = wj * gx + wi;
          const sxp = (ii + off[k * 2]) * cw;
          const syp = (jj + off[k * 2 + 1]) * ch;
          const ex = px - sxp;
          const ey = py - syp;
          const pd = ex * ex + ey * ey - wt[k];
          cxs[m] = sxp;
          cys[m] = syp;
          pds[m] = pd;
          ids[m] = k;
          if (pd < bestPd) {
            bestPd = pd;
            best = m;
          }
          m++;
        }
      }
      const bx = cxs[best];
      const by = cys[best];
      let e = Infinity;
      for (let q = 0; q < 9; q++) {
        if (q === best) continue;
        const ddx = cxs[q] - bx;
        const ddy = cys[q] - by;
        const len = Math.sqrt(ddx * ddx + ddy * ddy);
        if (len < 1e-9) continue;
        const d = (pds[q] - bestPd) / (2 * len);
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
