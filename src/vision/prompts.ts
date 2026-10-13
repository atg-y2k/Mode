/**
 * Prompt construction for EdgeTAM / SAM-style decoders, pure:
 * - a box around the zone's (approximate) polygon;
 * - 1–5 positive points spread inside the polygon shrunk away from its
 *   edges (so a rough AI outline still lands the clicks on the right thing);
 * - up to 3 negative points in neighbouring zones (outside this one), or in
 *   zones nested inside it that should be carved out (windows in a facade,
 *   a bed inside the lawn).
 *
 * Interior points are found on a coarse grid with a chamfer distance
 * transform: the clearance of a cell is its distance to the nearest
 * outside cell, so "shrunk polygon" = cells whose clearance is at least a
 * fraction of the largest clearance.
 */
import type { Pt, SceneZone, ZoneKind } from '../../shared/types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function boundsOf(points: readonly Pt[]): Box {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersectBoxes(a: Box, b: Box): Box | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Bounding box of `poly` grown by `padFrac` of its size (≥ 2 px) on each side, clamped to the image. */
export function polygonBox(poly: readonly Pt[], padFrac: number, width: number, height: number): Box {
  const b = boundsOf(poly);
  const px = Math.max(2, b.w * padFrac);
  const py = Math.max(2, b.h * padFrac);
  const x0 = Math.max(0, b.x - px);
  const y0 = Math.max(0, b.y - py);
  const x1 = Math.min(width, b.x + b.w + px);
  const y1 = Math.min(height, b.y + b.h + py);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Length / width of the polygon's bounding box, ≥ 1 (a cheap elongation measure). */
export function elongation(poly: readonly Pt[]): number {
  const b = boundsOf(poly);
  const lo = Math.min(b.w, b.h);
  const hi = Math.max(b.w, b.h);
  if (lo <= 0) return hi > 0 ? 100 : 1;
  // Thin diagonal shapes have a square box: compare the box to the filled area too.
  const fill = polygonArea(poly) / Math.max(1, b.w * b.h);
  return Math.max(hi / lo, fill > 0 ? 1 / Math.max(0.01, fill) : 1);
}

/** How many positive clicks a zone gets: 1 for tiny parts, up to 5 for large or long ones. */
export function promptPointCount(poly: readonly Pt[], imageWidth: number, imageHeight: number): number {
  const frac = polygonArea(poly) / Math.max(1, imageWidth * imageHeight);
  let n = frac < 0.004 ? 1 : frac < 0.03 ? 2 : frac < 0.1 ? 3 : frac < 0.25 ? 4 : 5;
  if (elongation(poly) > 3 && n < 5) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Interior points on a grid
// ---------------------------------------------------------------------------

interface ClearanceGrid {
  gw: number;
  gh: number;
  /** Photo px per cell. */
  cell: number;
  ox: number;
  oy: number;
  /** Clearance in cells (0 = outside). */
  dist: Float32Array;
  max: number;
}

/**
 * Chamfer distance (cells) from each cell inside `include` (and outside every
 * `exclude` polygon) to the nearest cell that is not; cells beyond the grid
 * count as outside.
 */
function clearanceGrid(include: readonly Pt[], exclude: readonly (readonly Pt[])[], within: Box | null, resolution: number): ClearanceGrid | null {
  let area = boundsOf(include);
  if (within) {
    const clipped = intersectBoxes(area, within);
    if (!clipped) return null;
    area = clipped;
  }
  if (area.w <= 0 || area.h <= 0) return null;
  const cell = Math.max(area.w, area.h) / Math.max(4, resolution);
  const gw = Math.max(1, Math.ceil(area.w / cell));
  const gh = Math.max(1, Math.ceil(area.h / cell));
  const dist = new Float32Array(gw * gh);
  const excludeBoxes = exclude.map(boundsOf);
  const BIG = 1e9;
  let any = false;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const p = { x: area.x + (i + 0.5) * cell, y: area.y + (j + 0.5) * cell };
      let ok = pointInPolygon(p, include);
      if (ok) {
        for (let k = 0; k < exclude.length; k++) {
          const b = excludeBoxes[k];
          if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h && pointInPolygon(p, exclude[k])) {
            ok = false;
            break;
          }
        }
      }
      if (ok) any = true;
      dist[j * gw + i] = ok ? BIG : 0;
    }
  }
  if (!any) return null;
  const D = Math.SQRT2;
  const get = (i: number, j: number) => (i < 0 || j < 0 || i >= gw || j >= gh ? 0 : dist[j * gw + i]);
  // Forward pass.
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      if (dist[k] === 0) continue;
      dist[k] = Math.min(dist[k], get(i - 1, j) + 1, get(i, j - 1) + 1, get(i - 1, j - 1) + D, get(i + 1, j - 1) + D);
    }
  }
  // Backward pass.
  let max = 0;
  for (let j = gh - 1; j >= 0; j--) {
    for (let i = gw - 1; i >= 0; i--) {
      const k = j * gw + i;
      if (dist[k] === 0) continue;
      dist[k] = Math.min(dist[k], get(i + 1, j) + 1, get(i, j + 1) + 1, get(i + 1, j + 1) + D, get(i - 1, j + 1) + D);
      if (dist[k] > max) max = dist[k];
    }
  }
  return { gw, gh, cell, ox: area.x, oy: area.y, dist, max };
}

/**
 * The deepest cell; among near-ties (≥ 95% of the max clearance, e.g. the
 * whole center line of a long rectangle) the one closest to the middle of
 * that ridge, so the point sits in the middle of the shape, not at one end.
 */
function deepestCell(g: ClearanceGrid): number {
  const ridge: number[] = [];
  for (let k = 0; k < g.dist.length; k++) if (g.dist[k] >= g.max * 0.95) ridge.push(k);
  let cx = 0;
  let cy = 0;
  for (const k of ridge) {
    cx += k % g.gw;
    cy += Math.floor(k / g.gw);
  }
  cx /= ridge.length;
  cy /= ridge.length;
  let best = ridge[0];
  let bestD = Infinity;
  for (const k of ridge) {
    const d = (k % g.gw - cx) ** 2 + (Math.floor(k / g.gw) - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function cellCenter(g: ClearanceGrid, k: number): Pt {
  const i = k % g.gw;
  const j = (k - i) / g.gw;
  return { x: g.ox + (i + 0.5) * g.cell, y: g.oy + (j + 0.5) * g.cell };
}

/**
 * Up to `count` points inside `poly`, at least `shrink` × (the polygon's
 * largest clearance) away from its edges, spread out by farthest-point
 * sampling. The first point is the pole of inaccessibility (deepest point).
 */
export function sampleInteriorPoints(
  poly: readonly Pt[],
  count: number,
  opts: { shrink?: number; resolution?: number; exclude?: readonly (readonly Pt[])[] } = {},
): Pt[] {
  if (poly.length < 3 || count <= 0) return [];
  const g = clearanceGrid(poly, opts.exclude ?? [], null, opts.resolution ?? 64);
  if (!g) return [];
  const minClear = Math.max(0.5, (opts.shrink ?? 0.35) * g.max);
  const eligible: number[] = [];
  for (let k = 0; k < g.dist.length; k++) if (g.dist[k] >= minClear) eligible.push(k);
  const chosen: Pt[] = [cellCenter(g, deepestCell(g))];
  const minSep = new Float64Array(eligible.length).fill(Infinity);
  while (chosen.length < count) {
    const last = chosen[chosen.length - 1];
    let pick = -1;
    let pickScore = -1;
    for (let e = 0; e < eligible.length; e++) {
      const p = cellCenter(g, eligible[e]);
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < minSep[e]) minSep[e] = d;
      // Prefer far from the chosen points; break ties toward deeper cells.
      const score = minSep[e] + g.dist[eligible[e]] * g.cell * 0.25;
      if (score > pickScore) {
        pickScore = score;
        pick = e;
      }
    }
    // Stop when the remaining candidates crowd the chosen ones (small zones).
    if (pick < 0 || minSep[pick] < Math.max(g.cell * 2, 0.6 * g.max * g.cell)) break;
    chosen.push(cellCenter(g, eligible[pick]));
  }
  return chosen;
}

/** The deepest point of `include` minus `exclude` (optionally only inside `within`), with its clearance in px. */
export function deepestPoint(
  include: readonly Pt[],
  exclude: readonly (readonly Pt[])[] = [],
  within: Box | null = null,
  resolution = 48,
): { pt: Pt; clearance: number } | null {
  if (include.length < 3) return null;
  const g = clearanceGrid(include, exclude, within, resolution);
  if (!g || g.max <= 0) return null;
  const best = deepestCell(g);
  return { pt: cellCenter(g, best), clearance: g.dist[best] * g.cell };
}

// ---------------------------------------------------------------------------
// Negatives from neighbours
// ---------------------------------------------------------------------------

/**
 * Zone kinds that belong to a container zone and must NOT be carved out of it
 * (a planting bed includes its shrubs; a porch includes its steps and columns).
 * Any other zone nested inside a zone is treated as a hole.
 */
const PARTS_OF: Partial<Record<ZoneKind, readonly ZoneKind[]>> = {
  'planting-bed': ['shrubs', 'tree', 'yard-border'],
  'yard-border': ['shrubs', 'tree', 'planting-bed'],
  shrubs: ['planting-bed', 'tree'],
  porch: ['steps', 'columns', 'front-door', 'door', 'windows', 'trim'],
  cabinetry: ['countertop', 'backsplash'],
  'built-ins': ['cabinetry', 'decor'],
  fireplace: ['decor'],
  deck: ['steps'],
  patio: ['furniture'],
  other: [],
};

function overlapShare(inner: readonly Pt[], outer: readonly Pt[]): number {
  // Share of `inner`'s vertices + centroid-ish samples inside `outer` (cheap containment estimate).
  if (inner.length === 0) return 0;
  const b = boundsOf(inner);
  const samples: Pt[] = [...inner];
  for (let j = 1; j < 4; j++) for (let i = 1; i < 4; i++) samples.push({ x: b.x + (b.w * i) / 4, y: b.y + (b.h * j) / 4 });
  const ins = samples.filter((p) => pointInPolygon(p, inner));
  const pts = ins.length ? [...inner, ...ins] : [...inner];
  let n = 0;
  for (const p of pts) if (pointInPolygon(p, outer)) n++;
  return n / pts.length;
}

export type NeighbourRole = 'hole' | 'outside' | 'ignore';

/**
 * How another zone relates to `zone` when refining it: a 'hole' is nested in
 * it and must be carved out (windows in a facade, a bed in the lawn), an
 * 'outside' neighbour is claimed by the other zone where it doesn't overlap
 * this one, and same-kind zones or parts of this zone (PARTS_OF) are ignored.
 */
export function neighbourRole(zone: Pick<SceneZone, 'id' | 'kind' | 'polygon'>, other: Pick<SceneZone, 'id' | 'kind' | 'polygon'>): NeighbourRole {
  if (other.id === zone.id || other.kind === zone.kind || other.polygon.length < 3 || zone.polygon.length < 3) return 'ignore';
  const nested = polygonArea(other.polygon) < polygonArea(zone.polygon) * 0.6 && overlapShare(other.polygon, zone.polygon) > 0.8;
  if (nested) return (PARTS_OF[zone.kind] ?? []).includes(other.kind) ? 'ignore' : 'hole';
  return 'outside';
}

export interface NegativeOptions {
  /** At most this many negatives (default 5). */
  max?: number;
  /** Grid resolution for the clearance search (default 40). */
  resolution?: number;
}

/**
 * Negative clicks for `zone` taken from the other zones: one per neighbour,
 * at the deepest spot of (neighbour − zone), preferring neighbours that reach
 * into the prompt box. Neighbours nested inside the zone (and much smaller)
 * are holes — their own deepest point is used — unless they are parts of it
 * (PARTS_OF). Zones with the same kind are never used.
 */
/** Distance from `p` to the nearest edge of `poly`. */
export function distanceToPolygonEdge(p: Pt, poly: readonly Pt[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    d = Math.min(d, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return d;
}

/**
 * Negative clicks for `zone` taken from the other zones: one per neighbour.
 * Nested holes (windows in a facade, a bed in the lawn) come first (up to 2,
 * at their deepest point); then outside neighbours at the deepest spot of
 * (neighbour − zone) near the prompt box, closest to the zone first — the
 * adjacent roof matters more for a facade than the sky far above it. Parts
 * of the zone (PARTS_OF) and same-kind zones are never used.
 */
export function negativePoints(zone: Pick<SceneZone, 'id' | 'kind' | 'polygon'>, others: readonly Pick<SceneZone, 'id' | 'kind' | 'polygon'>[], box: Box, opts: NegativeOptions = {}): Pt[] {
  const max = opts.max ?? 5;
  const res = opts.resolution ?? 40;
  if (max <= 0 || zone.polygon.length < 3) return [];
  const zoneBox = boundsOf(zone.polygon);
  const reach: Box = { x: box.x - box.w * 0.25, y: box.y - box.h * 0.25, w: box.w * 1.5, h: box.h * 1.5 };
  const holes: { pt: Pt; clearance: number }[] = [];
  const outside: { pt: Pt; inBox: boolean; dist: number }[] = [];
  for (const other of others) {
    const role = neighbourRole(zone, other);
    if (role === 'ignore') continue;
    const ob = boundsOf(other.polygon);
    if (!intersectBoxes(ob, reach)) continue;
    if (role === 'hole') {
      const hit = deepestPoint(other.polygon, [], null, res);
      if (hit && hit.clearance >= 1) holes.push(hit);
      continue;
    }
    // Outside this zone, near it: (other − zone) clipped to the reach box.
    let hit = deepestPoint(other.polygon, [zone.polygon], reach, res);
    // A zone that contains this one (facade around a window) but not near the box.
    if (!hit && intersectBoxes(ob, zoneBox)) hit = deepestPoint(other.polygon, [zone.polygon], null, res);
    if (!hit || hit.clearance < 1) continue;
    const inBox = hit.pt.x >= box.x && hit.pt.x <= box.x + box.w && hit.pt.y >= box.y && hit.pt.y <= box.y + box.h;
    outside.push({ pt: hit.pt, inBox, dist: distanceToPolygonEdge(hit.pt, zone.polygon) });
  }
  holes.sort((a, b) => b.clearance - a.clearance);
  outside.sort((a, b) => Number(b.inBox) - Number(a.inBox) || a.dist - b.dist);
  const picked: Pt[] = holes.slice(0, Math.min(2, max)).map((h) => h.pt);
  for (const o of outside) if (picked.length < max) picked.push(o.pt);
  for (const h of holes.slice(2)) if (picked.length < max) picked.push(h.pt);
  return picked;
}

export interface ZonePrompt {
  box: Box;
  positive: Pt[];
  negative: Pt[];
}

/** Box + positives + negatives for refining one zone of a photo of `width`×`height`. */
export function zonePrompt(
  zone: Pick<SceneZone, 'id' | 'kind' | 'polygon'>,
  allZones: readonly Pick<SceneZone, 'id' | 'kind' | 'polygon'>[],
  width: number,
  height: number,
): ZonePrompt {
  const box = polygonBox(zone.polygon, 0.04, width, height);
  // Carve-outs (nested holes) must not receive positive clicks either.
  const holes = allZones.filter((o) => neighbourRole(zone, o) === 'hole').map((o) => o.polygon);
  const n = promptPointCount(zone.polygon, width, height);
  let positive = sampleInteriorPoints(zone.polygon, n, { exclude: holes });
  if (positive.length === 0) positive = sampleInteriorPoints(zone.polygon, n);
  const negative = negativePoints(zone, allZones, box);
  const clampPt = (p: Pt) => ({ x: Math.min(width - 0.5, Math.max(0.5, p.x)), y: Math.min(height - 0.5, Math.max(0.5, p.y)) });
  return { box, positive: positive.map(clampPt), negative: negative.map(clampPt) };
}
