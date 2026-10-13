/**
 * Mask → polygon, pure and DOM-free:
 * - 4-connected component labelling (stack-based flood fill on typed arrays);
 * - marching-squares outline tracing along pixel edges (the outer boundary
 *   of one component, holes ignored);
 * - Douglas–Peucker simplification of the closed ring.
 *
 * Coordinates: pixel (x, y) covers [x, x+1) × [y, y+1), so traced vertices
 * sit on pixel corners (integers) — the same convention as engine/mask.ts.
 * "Clockwise" means clockwise on screen (y down): positive shoelace sum
 * Σ(p.x·q.y − q.x·p.y), matching the Studio's sketched-area polygons.
 */
import type { Pt } from '../../shared/types';

/** Anything with a width, height and one byte (or coverage value) per pixel. */
export interface GridLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface Component {
  /** 1-based label in `labels`. */
  label: number;
  area: number;
  /** Inclusive pixel bounds. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Index of the component's first pixel in raster order (top-most row, then left-most). */
  first: number;
  touchesBorder: boolean;
}

export interface Labelling {
  /** 0 = background, else the component label. Same size as the input. */
  labels: Int32Array;
  /** Components ordered by label (label i at index i-1). */
  components: Component[];
}

/**
 * 4-connected components of the pixels with value ≥ `threshold` (or <
 * `threshold` when `invert`), optionally only inside `region`.
 */
export function labelComponents(
  grid: GridLike,
  threshold = 128,
  opts: { invert?: boolean; region?: { x: number; y: number; w: number; h: number } } = {},
): Labelling {
  const { width: w, height: h, data } = grid;
  const labels = new Int32Array(w * h);
  const components: Component[] = [];
  if (w === 0 || h === 0) return { labels, components };
  const rx0 = Math.max(0, Math.floor(opts.region?.x ?? 0));
  const ry0 = Math.max(0, Math.floor(opts.region?.y ?? 0));
  const rx1 = Math.min(w - 1, Math.ceil((opts.region ? opts.region.x + opts.region.w : w) - 1));
  const ry1 = Math.min(h - 1, Math.ceil((opts.region ? opts.region.y + opts.region.h : h) - 1));
  const invert = !!opts.invert;
  const on = (i: number) => (invert ? data[i] < threshold : data[i] >= threshold);
  const stack = new Int32Array(Math.max(16, (rx1 - rx0 + 1) * (ry1 - ry0 + 1)));
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      const start = y * w + x;
      if (labels[start] !== 0 || !on(start)) continue;
      const label = components.length + 1;
      const c: Component = { label, area: 0, x0: x, y0: y, x1: x, y1: y, first: start, touchesBorder: false };
      let sp = 0;
      stack[sp++] = start;
      labels[start] = label;
      while (sp > 0) {
        const i = stack[--sp];
        const px = i % w;
        const py = (i - px) / w;
        c.area++;
        if (px < c.x0) c.x0 = px;
        if (px > c.x1) c.x1 = px;
        if (py < c.y0) c.y0 = py;
        if (py > c.y1) c.y1 = py;
        if (px === 0 || py === 0 || px === w - 1 || py === h - 1) c.touchesBorder = true;
        if (px > rx0) {
          const j = i - 1;
          if (labels[j] === 0 && on(j)) {
            labels[j] = label;
            stack[sp++] = j;
          }
        }
        if (px < rx1) {
          const j = i + 1;
          if (labels[j] === 0 && on(j)) {
            labels[j] = label;
            stack[sp++] = j;
          }
        }
        if (py > ry0) {
          const j = i - w;
          if (labels[j] === 0 && on(j)) {
            labels[j] = label;
            stack[sp++] = j;
          }
        }
        if (py < ry1) {
          const j = i + w;
          if (labels[j] === 0 && on(j)) {
            labels[j] = label;
            stack[sp++] = j;
          }
        }
      }
      components.push(c);
    }
  }
  return { labels, components };
}

// Steps of the outline walk.
const UP = 0;
const RIGHT = 1;
const DOWN = 2;
const LEFT = 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/**
 * Outer boundary of the component that contains pixel `first` (its top-most,
 * left-most pixel), traced with marching squares on the pixel-corner
 * lattice. Only corners where the direction changes are returned. The ring
 * is counter-clockwise on screen (use toClockwise for the stored order).
 *
 * The saddle rule treats diagonal-only contact as disconnected, which
 * matches 4-connected labelling: the walk never leaves the component.
 */
export function traceOutline(inside: (x: number, y: number) => boolean, startX: number, startY: number, maxSteps = 1e7): Pt[] {
  const at = (x: number, y: number) => (inside(x, y) ? 1 : 0);
  const ring: Pt[] = [];
  let x = startX;
  let y = startY;
  let prev = -1;
  for (let steps = 0; steps < maxSteps; steps++) {
    // Corner (x, y) sits between pixels (x-1, y-1) (x, y-1) (x-1, y) (x, y).
    const state = at(x - 1, y - 1) | (at(x, y - 1) << 1) | (at(x - 1, y) << 2) | (at(x, y) << 3);
    let next: number;
    switch (state) {
      case 1:
      case 5:
      case 13:
        next = UP;
        break;
      case 2:
      case 3:
      case 7:
        next = RIGHT;
        break;
      case 4:
      case 12:
      case 14:
        next = LEFT;
        break;
      case 8:
      case 10:
      case 11:
        next = DOWN;
        break;
      case 6: // upper-right + lower-left (saddle)
        next = prev === UP ? LEFT : RIGHT;
        break;
      case 9: // upper-left + lower-right (saddle)
        next = prev === RIGHT ? UP : DOWN;
        break;
      default:
        // 0 or 15: not on a boundary (bad start) — give up.
        return ring;
    }
    if (next !== prev) ring.push({ x, y });
    x += DX[next];
    y += DY[next];
    prev = next;
    if (x === startX && y === startY) break;
  }
  return ring;
}

/** Twice the signed area; positive = clockwise on screen (y down). */
export function signedArea2(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

export function toClockwise(ring: Pt[]): Pt[] {
  return signedArea2(ring) < 0 ? ring.reverse() : ring;
}

function perpDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx;
  return (cross * cross) / len2;
}

/** Douglas–Peucker on an open polyline (iterative; keeps both ends). */
export function douglasPeucker(points: readonly Pt[], tolerance: number): Pt[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ ...p }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist2(points[i], points[a], points[b]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ ...points[i] });
  return out;
}

/**
 * Douglas–Peucker for a closed ring: split at the vertex farthest from the
 * first one and simplify both halves. Always returns ≥ 3 points when the
 * input has ≥ 3 (lowering the tolerance if needed).
 */
export function simplifyClosed(ring: readonly Pt[], tolerance: number): Pt[] {
  const n = ring.length;
  if (n <= 3) return ring.map((p) => ({ ...p }));
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = (ring[i].x - ring[0].x) ** 2 + (ring[i].y - ring[0].y) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  let tol = Math.max(0, tolerance);
  for (let attempt = 0; attempt < 8; attempt++) {
    const a = douglasPeucker(ring.slice(0, far + 1), tol);
    const b = douglasPeucker([...ring.slice(far), ring[0]], tol);
    const out = [...a, ...b.slice(1, -1)];
    if (out.length >= 3) return out;
    tol /= 2;
  }
  return ring.map((p) => ({ ...p }));
}

export interface ContourOptions {
  /** Douglas–Peucker tolerance in px (default 1.5). */
  tolerancePx?: number;
  /** Coverage threshold (default 128). */
  threshold?: number;
  /** Ignore components smaller than this many px (default 1). */
  minArea?: number;
  /** At most this many rings, largest first (default unlimited). */
  maxRings?: number;
  /** Multiply output coordinates (e.g. to map a low-res grid to photo px). */
  scaleX?: number;
  scaleY?: number;
}

/** Simplified clockwise outer rings of the components, largest first. */
export function maskContours(grid: GridLike, opts: ContourOptions = {}): Pt[][] {
  const threshold = opts.threshold ?? 128;
  const { labels, components } = labelComponents(grid, threshold);
  const minArea = Math.max(1, opts.minArea ?? 1);
  const picked = components.filter((c) => c.area >= minArea).sort((a, b) => b.area - a.area);
  const limit = opts.maxRings ?? picked.length;
  const sx = opts.scaleX ?? 1;
  const sy = opts.scaleY ?? 1;
  const w = grid.width;
  const h = grid.height;
  const rings: Pt[][] = [];
  for (const c of picked.slice(0, limit)) {
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === c.label;
    const fx = c.first % w;
    const fy = (c.first - fx) / w;
    const raw = traceOutline(inside, fx, fy, 4 * (w + 2) * (h + 2));
    if (raw.length < 3) continue;
    const simple = toClockwise(simplifyClosed(raw, opts.tolerancePx ?? 1.5));
    rings.push(sx === 1 && sy === 1 ? simple : simple.map((p) => ({ x: p.x * sx, y: p.y * sy })));
  }
  return rings;
}

/** Outline of the largest component (simplified, clockwise), or [] when the mask is empty. */
export function largestContour(grid: GridLike, opts: ContourOptions = {}): Pt[] {
  return maskContours(grid, { ...opts, maxRings: 1 })[0] ?? [];
}

/**
 * One polygon for a mask with several significant parts (a lawn split by the
 * walk): each part's outer ring, joined to the others by zero-width "keyhole"
 * bridges between their closest vertices. Even-odd filling and point-in-
 * polygon tests are unaffected by the bridges (they are traversed twice), so
 * every part stays inside the zone's outline. Parts smaller than `minShare`
 * of the mask's area are dropped; at most `maxParts` are kept.
 */
export function zonePolygon(grid: GridLike, opts: ContourOptions & { minShare?: number; maxParts?: number } = {}): Pt[] {
  const threshold = opts.threshold ?? 128;
  let total = 0;
  for (let i = 0; i < grid.data.length; i++) if (grid.data[i] >= threshold) total++;
  if (total === 0) return [];
  const minArea = Math.max(opts.minArea ?? 1, total * (opts.minShare ?? 0.08));
  const rings = maskContours(grid, { ...opts, minArea, maxRings: opts.maxParts ?? 6 });
  return joinRings(rings);
}

/** Joins clockwise rings into one keyhole polygon (largest first, then nearest). */
export function joinRings(rings: readonly Pt[][]): Pt[] {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length === 0) return [];
  let shape = usable[0].map((p) => ({ ...p }));
  const rest = usable.slice(1);
  while (rest.length) {
    // The ring closest to the shape so far, and the closest vertex pair.
    let best = { r: 0, i: 0, j: 0, d: Infinity };
    rest.forEach((ring, r) => {
      for (let i = 0; i < shape.length; i++) {
        for (let j = 0; j < ring.length; j++) {
          const d = (shape[i].x - ring[j].x) ** 2 + (shape[i].y - ring[j].y) ** 2;
          if (d < best.d) best = { r, i, j, d };
        }
      }
    });
    const ring = rest.splice(best.r, 1)[0];
    const rotated = [...ring.slice(best.j), ...ring.slice(0, best.j)];
    shape = [...shape.slice(0, best.i + 1), ...rotated, { ...rotated[0] }, { ...shape[best.i] }, ...shape.slice(best.i + 1)];
  }
  return shape;
}
