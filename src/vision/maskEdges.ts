/**
 * The visible edge of a zone mask, for drawing on the photo: outer
 * boundaries of its significant parts plus the holes inside them (a lawn
 * around a tree bed), as simplified rings in photo px. Pure and DOM-free.
 *
 * Large masks (12 MP phone photos) are box-averaged down to `maxEdge` px on
 * the long side first, then thresholded at half coverage, so the traced
 * boundary is area-correct and the work stays ~O(pixels) once per mask
 * version (the overlay caches the result).
 *
 * Rings: outer ones clockwise on screen, holes counter-clockwise — drawn as
 * one SVG path with fill-rule="evenodd" either way.
 */
import type { Pt } from '../../shared/types';
import { labelComponents, simplifyClosed, signedArea2, traceOutline, type Component, type GridLike } from './contours';

export interface MaskEdges {
  /** Outer boundaries of the mask's parts, largest first (clockwise). */
  outer: Pt[][];
  /** Boundaries of holes inside those parts (counter-clockwise). */
  holes: Pt[][];
  /**
   * A point well inside the mask (the pixel farthest from its edge, holes
   * included) for labels and badges; null for an empty mask.
   */
  labelPoint: Pt | null;
}

export interface MaskEdgeOptions {
  /** Long edge of the analysis grid (default 1024). */
  maxEdge?: number;
  /** Douglas–Peucker tolerance in analysis-grid px (default 0.75). */
  tolerancePx?: number;
  /** Parts and holes smaller than this share of the grid are ignored (default 0.0004). */
  minShare?: number;
  /** At most this many outer rings and holes (default 16 and 32). */
  maxOuter?: number;
  maxHoles?: number;
  /** Coverage threshold, 0..255 (default 128). */
  threshold?: number;
}

/**
 * Box-averaged copy of `mask` whose long edge is ≤ maxEdge (the mask itself
 * when it is already small). `factor` = source px per grid px.
 */
export function downsampleMask(mask: GridLike, maxEdge: number): { grid: { width: number; height: number; data: Uint8Array | ArrayLike<number> }; factor: number } {
  const { width: w, height: h, data } = mask;
  const f = Math.max(1, Math.ceil(Math.max(w, h) / Math.max(1, maxEdge)));
  if (f === 1) return { grid: mask, factor: 1 };
  const gw = Math.ceil(w / f);
  const gh = Math.ceil(h / f);
  const sums = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / f) * gw;
    const src = y * w;
    for (let gx = 0, x0 = 0; x0 < w; gx++, x0 += f) {
      const x1 = Math.min(w, x0 + f);
      let s = 0;
      for (let x = src + x0, end = src + x1; x < end; x++) s += data[x];
      sums[row + gx] += s;
    }
  }
  const out = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const bh = Math.min(f, h - gy * f);
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx;
      out[i] = Math.round(sums[i] / (bh * Math.min(f, w - gx * f)));
    }
  }
  return { grid: { width: gw, height: gh, data: out }, factor: f };
}

function ringOf(labels: Int32Array, w: number, h: number, c: Component, tolerance: number): Pt[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === c.label;
  const fx = c.first % w;
  const fy = (c.first - fx) / w;
  const raw = traceOutline(inside, fx, fy, 4 * (w + 2) * (h + 2));
  return raw.length >= 3 ? simplifyClosed(raw, tolerance) : [];
}

function oriented(ring: Pt[], clockwise: boolean): Pt[] {
  return signedArea2(ring) > 0 === clockwise ? ring : ring.reverse();
}

/**
 * The foreground pixel farthest from the background (two-pass 3-4 chamfer
 * distance; the grid border counts as background), as the centre of that
 * pixel. Null when nothing reaches `threshold`.
 */
export function deepestPoint(grid: GridLike, threshold = 128): Pt | null {
  const { width: w, height: h, data } = grid;
  if (w <= 0 || h <= 0) return null;
  const INF = 1 << 29;
  const d = new Int32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = data[i] >= threshold ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  let bestD = 0;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
      if (d[i] > bestD) bestD = d[i];
      sx += x;
      sy += y;
      n++;
    }
  }
  if (n === 0) return null;
  // Of the deepest pixels (a ridge in elongated shapes), the one nearest the centroid.
  const cx = sx / n;
  const cy = sy / n;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < d.length; i++) {
    if (d[i] !== bestD) continue;
    const x = i % w;
    const y = (i - x) / w;
    const dist = (x - cx) ** 2 + (y - cy) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  const x = best % w;
  return { x: x + 0.5, y: (best - x) / w + 0.5 };
}

/** Outer and hole boundaries of a mask in its own px (empty rings when the mask is empty). */
export function maskEdges(mask: GridLike, opts: MaskEdgeOptions = {}): MaskEdges {
  if (mask.width <= 0 || mask.height <= 0) return { outer: [], holes: [], labelPoint: null };
  const { grid, factor } = downsampleMask(mask, opts.maxEdge ?? 1024);
  const { width: w, height: h } = grid;
  const threshold = opts.threshold ?? 128;
  const tolerance = opts.tolerancePx ?? 0.75;
  const minArea = Math.max(2, Math.round(w * h * (opts.minShare ?? 0.0004)));

  const fg = labelComponents(grid, threshold);
  const parts = fg.components.filter((c) => c.area >= minArea).sort((a, b) => b.area - a.area).slice(0, opts.maxOuter ?? 16);
  if (parts.length === 0) return { outer: [], holes: [], labelPoint: null };
  const kept = new Set(parts.map((c) => c.label));

  // Holes: background components that don't reach the border and sit inside a kept part.
  const bg = labelComponents(grid, threshold, { invert: true });
  const holes = bg.components
    .filter((c) => !c.touchesBorder && c.area >= minArea)
    .filter((c) => {
      // The pixel just above a hole's top-left pixel belongs to the part around it.
      const above = c.first - w;
      return above >= 0 && kept.has(fg.labels[above]);
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, opts.maxHoles ?? 32);

  const scale = (ring: Pt[]): Pt[] =>
    factor === 1 ? ring : ring.map((p) => ({ x: Math.min(mask.width, p.x * factor), y: Math.min(mask.height, p.y * factor) }));
  const deep = deepestPoint(grid, threshold);
  return {
    labelPoint: deep ? { x: Math.min(mask.width, deep.x * factor), y: Math.min(mask.height, deep.y * factor) } : null,
    outer: parts
      .map((c) => ringOf(fg.labels, w, h, c, tolerance))
      .filter((r) => r.length >= 3)
      .map((r) => scale(oriented(r, true))),
    holes: holes
      .map((c) => ringOf(bg.labels, w, h, c, tolerance))
      .filter((r) => r.length >= 3)
      .map((r) => scale(oriented(r, false))),
  };
}

/** True when the edges have something to draw. */
export function hasEdges(edges: MaskEdges | null | undefined): edges is MaskEdges {
  return !!edges && edges.outer.length > 0;
}
