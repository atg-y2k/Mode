/**
 * Pure geometry for the Studio viewer: the view transform (photo px ↔ screen
 * px), point-in-polygon / polyline hit-testing of scene zones and paths, and
 * placement of hover labels so they sit beside a zone instead of on top of it.
 */
import type { Pt, ScenePath, SceneZone } from '../../../shared/types';

// ---------------------------------------------------------------------------
// View transform: screen = photo · scale + (tx, ty)
// ---------------------------------------------------------------------------

export interface View {
  /** CSS px per photo px. */
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Contain-fit `image` in `pane` with `padding` px on every side, centered. */
export function fitView(image: Size, pane: Size, padding: number): View {
  const availW = Math.max(1, pane.width - padding * 2);
  const availH = Math.max(1, pane.height - padding * 2);
  const scale = Math.max(1e-4, Math.min(availW / Math.max(1, image.width), availH / Math.max(1, image.height)));
  return { scale, tx: (pane.width - image.width * scale) / 2, ty: (pane.height - image.height * scale) / 2 };
}

/** Zoom keeping the photo point under (sx, sy) fixed. */
export function zoomAt(view: View, scale: number, sx: number, sy: number): View {
  const k = scale / view.scale;
  return { scale, tx: sx - (sx - view.tx) * k, ty: sy - (sy - view.ty) * k };
}

export function toPhoto(view: View, sx: number, sy: number): Pt {
  return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale };
}

export function toScreen(view: View, px: number, py: number): Pt {
  return { x: px * view.scale + view.tx, y: py * view.scale + view.ty };
}

/** Keeps at least `margin` px of the image inside the pane so it can't be panned out of sight. */
export function clampPan(view: View, image: Size, pane: Size, margin: number): View {
  const w = image.width * view.scale;
  const h = image.height * view.scale;
  const mx = Math.min(margin, w);
  const my = Math.min(margin, h);
  return { scale: view.scale, tx: clamp(view.tx, mx - w, pane.width - mx), ty: clamp(view.ty, my - h, pane.height - my) };
}

// ---------------------------------------------------------------------------
// Polygons & polylines
// ---------------------------------------------------------------------------

/** Even-odd ray casting; points exactly on an edge may go either way. */
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

export function boundsOf(points: readonly Pt[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Area centroid (falls back to the vertex mean for degenerate polygons). */
export function polygonCentroid(poly: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = Math.max(1, poly.length);
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/**
 * A point inside the polygon to anchor a badge: the centroid when it lies
 * inside, else the middle of the widest horizontal span through the
 * vertical center (handles L- and C-shaped zones).
 */
export function interiorPoint(poly: readonly Pt[]): Pt {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const b = boundsOf(poly);
  let best: Pt = c;
  let bestWidth = -1;
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const y = b.y + b.height * f;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const d = poly[j];
      if (a.y > y !== d.y > y) xs.push(((d.x - a.x) * (y - a.y)) / (d.y - a.y) + a.x);
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      if (w > bestWidth) {
        bestWidth = w;
        best = { x: (xs[k] + xs[k + 1]) / 2, y };
      }
    }
    if (bestWidth > 0 && f === 0.5) break;
  }
  return best;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Pt, pts: readonly Pt[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i - 1], pts[i]));
  return d;
}

export function polylineLength(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Point at fraction `t` (0..1) of the polyline's length, with the local direction in radians. */
export function pointAlong(pts: readonly Pt[], t: number): { p: Pt; angle: number } {
  if (pts.length === 0) return { p: { x: 0, y: 0 }, angle: 0 };
  if (pts.length === 1) return { p: { ...pts[0] }, angle: 0 };
  const target = polylineLength(pts) * clamp(t, 0, 1);
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (run + seg >= target || i === pts.length - 1) {
      const k = seg > 0 ? clamp((target - run) / seg, 0, 1) : 0;
      return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    run += seg;
  }
  return { p: { ...pts[pts.length - 1] }, angle: 0 };
}

// ---------------------------------------------------------------------------
// Scene hit-testing
// ---------------------------------------------------------------------------

export type SceneHit = { kind: 'zone'; id: string } | { kind: 'path'; id: string };

export interface HitTestOptions {
  /** Extra reach around a path's centerline, in photo px (e.g. 8 screen px / scale). */
  pathSlop: number;
  /** Coverage (0..255) of a refined zone mask at a photo pixel; undefined when the mask isn't loaded. */
  maskAt?: (zone: SceneZone, x: number, y: number) => number | undefined;
}

/**
 * What is under photo point `p`: a path when the point is within its
 * half-width (+ slop) of the centerline — paths are thin and drawn on top —
 * otherwise the smallest zone containing the point (the most specific one:
 * a door wins over the facade around it).
 */
export function hitTestScene(p: Pt, zones: readonly SceneZone[], paths: readonly ScenePath[], opts: HitTestOptions): SceneHit | null {
  let bestPath: { id: string; d: number } | null = null;
  for (const path of paths) {
    const d = distToPolyline(p, path.points);
    const reach = Math.max(path.widthPx / 2, 0) * 0.6 + opts.pathSlop;
    if (d <= reach && (!bestPath || d < bestPath.d)) bestPath = { id: path.id, d };
  }
  if (bestPath) return { kind: 'path', id: bestPath.id };

  let best: { id: string; area: number } | null = null;
  for (const zone of zones) {
    const covered = zone.maskId && opts.maskAt ? opts.maskAt(zone, p.x, p.y) : undefined;
    const inside = covered !== undefined ? covered >= 128 : zone.polygon.length >= 3 && pointInPolygon(p, zone.polygon);
    if (!inside) continue;
    const area = polygonArea(zone.polygon);
    if (!best || area < best.area) best = { id: zone.id, area };
  }
  return best ? { kind: 'zone', id: best.id } : null;
}

// ---------------------------------------------------------------------------
// Label placement
// ---------------------------------------------------------------------------

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Top-left position for a label of `label` size describing `target` (screen
 * rect of the hovered zone) inside `stage`. Tries above, below, right and
 * left of the target (aligned with `focus` — usually the pointer — when
 * given), keeping `gap` px away; picks the first spot that fits the stage
 * without covering the target, else the spot that covers it least.
 */
export function placeLabel(target: Rect, label: Size, stage: Size, opts: { gap?: number; margin?: number; focus?: Pt } = {}): Pt {
  const gap = opts.gap ?? 10;
  const margin = opts.margin ?? 8;
  const fx = opts.focus ? clamp(opts.focus.x, target.x, target.x + target.width) : target.x + target.width / 2;
  const fy = opts.focus ? clamp(opts.focus.y, target.y, target.y + target.height) : target.y + target.height / 2;
  const maxX = Math.max(margin, stage.width - label.width - margin);
  const maxY = Math.max(margin, stage.height - label.height - margin);
  const fitX = (x: number) => clamp(x, margin, maxX);
  const fitY = (y: number) => clamp(y, margin, maxY);

  const cover = (p: Pt) => overlapArea({ x: p.x, y: p.y, width: label.width, height: label.height }, target);
  const sides: Pt[] = [
    { x: fx - label.width / 2, y: target.y - gap - label.height }, // above
    { x: fx - label.width / 2, y: target.y + target.height + gap }, // below
    { x: target.x + target.width + gap, y: fy - label.height / 2 }, // right
    { x: target.x - gap - label.width, y: fy - label.height / 2 }, // left
  ];
  // Best case: a side that fits the stage as is and leaves the target clear.
  for (const c of sides) {
    const p = { x: fitX(c.x), y: fitY(c.y) };
    const fits = Math.abs(p.x - c.x) < 0.5 && Math.abs(p.y - c.y) < 0.5;
    if (fits && cover(p) === 0) return p;
  }
  // Otherwise the least coverage of the target. Ties: a clear spot beside
  // the target (clamped into the stage) before a corner; when every spot
  // covers the target, the one farthest from the pointer.
  const corners: Pt[] = [
    { x: margin, y: margin },
    { x: maxX, y: margin },
    { x: margin, y: maxY },
    { x: maxX, y: maxY },
  ];
  const scored = [...sides.map((c) => ({ p: { x: fitX(c.x), y: fitY(c.y) }, corner: 0 })), ...corners.map((p) => ({ p, corner: 1 }))].map((s) => ({
    ...s,
    cover: cover(s.p),
    far: Math.hypot(s.p.x + label.width / 2 - fx, s.p.y + label.height / 2 - fy),
  }));
  scored.sort((a, b) => a.cover - b.cover || (a.cover === 0 ? a.corner - b.corner : 0) || b.far - a.far);
  return scored[0].p;
}

// ---------------------------------------------------------------------------
// Compare grid layout
// ---------------------------------------------------------------------------

/**
 * Number of columns that shows `n` images of `aspect` (w/h) largest in a
 * `width`×`height` area with `gap` px between cells (and room for a caption
 * of `captionH` px under each image).
 */
export function bestGridColumns(n: number, width: number, height: number, aspect: number, gap: number, captionH = 0): number {
  if (n <= 1) return 1;
  let bestCols = 1;
  let bestScale = -1;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * (rows - 1)) / rows - captionH;
    if (cellW <= 0 || cellH <= 0) continue;
    const imgW = Math.min(cellW, cellH * aspect);
    if (imgW > bestScale + 0.5) {
      bestScale = imgW;
      bestCols = cols;
    }
  }
  return bestCols;
}

// ---------------------------------------------------------------------------
// Freehand strokes
// ---------------------------------------------------------------------------

/** Ramer–Douglas–Peucker: drops points closer than `tolerance` to the simplified line. */
export function simplifyPolyline(points: readonly Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ ...p }));
}

/** Point of a polyline nearest the bottom of the frame — a ground path's near end. */
export function nearEndIndex(points: readonly Pt[]): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) if (points[i].y > points[best].y) best = i;
  return best;
}

/** Unit normal of the polyline at vertex `i` (average of the adjacent segment directions). */
export function normalAt(points: readonly Pt[], i: number): Pt {
  const prev = points[Math.max(0, i - 1)];
  const next = points[Math.min(points.length - 1, i + 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}
