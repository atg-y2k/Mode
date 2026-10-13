/**
 * Editor-side geometry: placed-object frames (anchor at the base, rotation
 * about the anchor), handle positions, light handles, quads, dirty rects,
 * angle snapping and real-length units. Pure — unit tested.
 */
import type { PlacedLight, Pt, Quad } from '../../../shared/types';

const DEG = Math.PI / 180;

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Rotate a vector about the origin (degrees, clockwise on screen since y points down). */
export function rotateVec(p: Pt, degrees: number): Pt {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Normalize to (-180, 180]. */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Snap to multiples of `step` when `snap` is on; otherwise only a gentle
 * magnet toward multiples of 90° (within `magnet` degrees).
 */
export function snapAngle(deg: number, snap: boolean, step = 15, magnet = 2.5): number {
  const d = normalizeDeg(deg);
  if (snap) return normalizeDeg(Math.round(d / step) * step);
  const right = Math.round(d / 90) * 90;
  return Math.abs(d - right) <= magnet ? normalizeDeg(right) : d;
}

/** Point `to` constrained so the segment from→to lies on a multiple of `stepDeg`. Length is kept. */
export function constrainAngle(from: Pt, to: Pt, stepDeg = 45): Pt {
  const len = dist(from, to);
  if (len === 0) return { ...to };
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const step = stepDeg * DEG;
  const snapped = Math.round(a / step) * step;
  return { x: from.x + Math.cos(snapped) * len, y: from.y + Math.sin(snapped) * len };
}

// ---------------------------------------------------------------------------
// Placed objects
// ---------------------------------------------------------------------------

/** The parts of a PlacedObject that define where it is drawn. */
export interface ObjectFrame {
  /** Anchor (base / ground contact) in photo px. */
  x: number;
  y: number;
  /** Rendered height in photo px. */
  height: number;
  /** Degrees, about the anchor. */
  rotation: number;
}

/** Unrotated rect relative to the anchor. `anchorY` = 0..1 from the top of the art. */
export function localRect(height: number, aspect: number, anchorY: number) {
  const w = height * aspect;
  return { left: -w / 2, right: w / 2, top: -anchorY * height, bottom: (1 - anchorY) * height };
}

export function toLocal(p: Pt, obj: ObjectFrame): Pt {
  return rotateVec({ x: p.x - obj.x, y: p.y - obj.y }, -obj.rotation);
}

export function toWorld(local: Pt, obj: ObjectFrame): Pt {
  const r = rotateVec(local, obj.rotation);
  return { x: obj.x + r.x, y: obj.y + r.y };
}

/** Corners of the drawn rect in photo px: top-left, top-right, bottom-right, bottom-left. */
export function objectCorners(obj: ObjectFrame, aspect: number, anchorY: number): Quad {
  const r = localRect(obj.height, aspect, anchorY);
  return [
    toWorld({ x: r.left, y: r.top }, obj),
    toWorld({ x: r.right, y: r.top }, obj),
    toWorld({ x: r.right, y: r.bottom }, obj),
    toWorld({ x: r.left, y: r.bottom }, obj),
  ];
}

/** True when `p` lies within the object's drawn rect, grown by `tolerance` photo px. */
export function hitObject(p: Pt, obj: ObjectFrame, aspect: number, anchorY: number, tolerance = 0): boolean {
  const l = toLocal(p, obj);
  const r = localRect(obj.height, aspect, anchorY);
  return l.x >= r.left - tolerance && l.x <= r.right + tolerance && l.y >= r.top - tolerance && l.y <= r.bottom + tolerance;
}

/** Rotation handle: above the top-center of the rect by `offset` photo px. */
export function rotateHandlePos(obj: ObjectFrame, aspect: number, anchorY: number, offset: number): Pt {
  const r = localRect(obj.height, aspect, anchorY);
  return toWorld({ x: 0, y: r.top - offset }, obj);
}

/** Top-center of the rect (where the rotation handle's stem starts). */
export function topCenter(obj: ObjectFrame, aspect: number, anchorY: number): Pt {
  const r = localRect(obj.height, aspect, anchorY);
  return toWorld({ x: 0, y: r.top }, obj);
}

/** Angle of `p` around `anchor` in degrees, 0 = straight up, clockwise positive. */
export function angleFromAnchor(anchor: Pt, p: Pt): number {
  return normalizeDeg((Math.atan2(p.y - anchor.y, p.x - anchor.x) * 180) / Math.PI + 90);
}

/** New height when a corner handle is dragged: scales by the distance ratio to the anchor. */
export function scaledHeight(anchor: Pt, start: Pt, current: Pt, startHeight: number, min: number, max: number): number {
  const d0 = Math.max(1e-3, dist(anchor, start));
  const h = (startHeight * dist(anchor, current)) / d0;
  return Math.max(min, Math.min(max, h));
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

export type LightLike = Pick<PlacedLight, 'x' | 'y' | 'x2' | 'y2' | 'beam' | 'radius' | 'angle'>;

export function isLineBeam(beam: PlacedLight['beam']): boolean {
  return beam === 'strip' || beam === 'string';
}

/** Second end point of a strip/string light (defaults to 120 px to the right). */
export function lightEnd(l: LightLike): Pt {
  return { x: l.x2 ?? l.x + 120, y: l.y2 ?? l.y };
}

export function lightMid(l: LightLike): Pt {
  const e = lightEnd(l);
  return { x: (l.x + e.x) / 2, y: (l.y + e.y) / 2 };
}

/** Handle that sets the glow radius of a strip/string light: perpendicular to the segment at its middle. */
export function lineRadiusKnob(l: LightLike): Pt {
  const a = { x: l.x, y: l.y };
  const b = lightEnd(l);
  const len = Math.max(1e-6, dist(a, b));
  // Normal pointing "down" on screen for a left→right segment.
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const m = lightMid(l);
  return { x: m.x + nx * l.radius, y: m.y + ny * l.radius };
}

/** Handle that aims a spot light: along its direction at 45% of the radius. */
export function spotAngleKnob(l: LightLike): Pt {
  const a = ((l.angle ?? 90) * Math.PI) / 180;
  const r = l.radius * 0.45;
  return { x: l.x + Math.cos(a) * r, y: l.y + Math.sin(a) * r };
}

/** Degrees (0 = right, 90 = down) from `center` toward `p`. */
export function directionDeg(center: Pt, p: Pt): number {
  return normalizeDeg((Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI);
}

// ---------------------------------------------------------------------------
// Quads / polygons
// ---------------------------------------------------------------------------

export function quadFromRect(r: { x: number; y: number; w: number; h: number }): Quad {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Convex, non-degenerate quad (all turns in the same direction). */
export function isConvexQuad(q: readonly Pt[]): boolean {
  if (q.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function translateQuad(q: Quad, dx: number, dy: number): Quad {
  return q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
}

/** Even-odd point in polygon. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Absolute polygon area (shoelace). */
export function polygonArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(s) / 2;
}

/** Apply a row-major 3×3 homography. */
export function applyMat3(m: readonly number[], p: Pt): Pt {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  const iw = Math.abs(w) < 1e-12 ? 0 : 1 / w;
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) * iw, y: (m[3] * p.x + m[4] * p.y + m[5]) * iw };
}

export function clampToImage(p: Pt, width: number, height: number): Pt {
  return { x: Math.max(0, Math.min(width, p.x)), y: Math.max(0, Math.min(height, p.y)) };
}

export function insideImage(p: Pt, width: number, height: number): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
}

// ---------------------------------------------------------------------------
// Integer pixel rects (dirty regions)
// ---------------------------------------------------------------------------

export interface IRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Integer rect covering a segment thickened by `r` px. */
export function segmentRect(a: Pt, b: Pt, r: number): IRect {
  const x0 = Math.floor(Math.min(a.x, b.x) - r);
  const y0 = Math.floor(Math.min(a.y, b.y) - r);
  const x1 = Math.ceil(Math.max(a.x, b.x) + r);
  const y1 = Math.ceil(Math.max(a.y, b.y) + r);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a: IRect | null, b: IRect | null): IRect | null {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Intersect with the image; null when nothing is left. */
export function clipRect(r: IRect, width: number, height: number): IRect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** True when two equally sized byte arrays differ inside `rect` (row-major, `width` wide). */
export function bytesDifferInRect(a: Uint8Array, b: Uint8Array, width: number, rect: IRect): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const row = y * width;
    for (let x = rect.x; x < rect.x + rect.w; x++) if (a[row + x] !== b[row + x]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Real lengths
// ---------------------------------------------------------------------------

export const LENGTH_UNITS = ['ft', 'in', 'm', 'cm'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

const FEET_PER: Record<LengthUnit, number> = { ft: 1, in: 1 / 12, m: 3.280839895, cm: 0.03280839895 };

export function toFeet(value: number, unit: LengthUnit): number {
  return value * FEET_PER[unit];
}

/** 6.6667 → 6′ 8″, 12 → 12′, 0.5 → 6″, 42.3 → 42.3 ft. */
export function formatFeet(ft: number): string {
  if (!Number.isFinite(ft) || ft <= 0) return '—';
  if (ft >= 30) return `${Math.round(ft * 10) / 10} ft`;
  let whole = Math.floor(ft);
  let inches = Math.round((ft - whole) * 12);
  if (inches === 12) {
    whole += 1;
    inches = 0;
  }
  if (whole === 0) return `${inches}″`;
  return inches ? `${whole}′ ${inches}″` : `${whole}′`;
}
