/** Small 2D geometry helpers: homographies (perspective), polygons. */
import type { Pt } from '../../shared/types';

/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

function isFinitePt(p: Pt | undefined): p is Pt {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Similarity transform (row-major Mat3) that moves the centroid to 0 and the mean distance to √2. */
function normalizingTransform(pts: readonly Pt[]): Mat3 {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let meanDist = 0;
  for (const p of pts) meanDist += Math.hypot(p.x - cx, p.y - cy);
  meanDist /= pts.length;
  const s = meanDist > 0 ? Math.SQRT2 / meanDist : 1;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

/**
 * Solves A·x = b in place (A is n×n row-major, b length n) by Gaussian
 * elimination with partial pivoting. Returns null when (numerically) singular.
 */
export function solveLinearSystem(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  let scale = 0;
  for (let i = 0; i < n * n; i++) scale = Math.max(scale, Math.abs(A[i]));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const eps = scale * 1e-12;
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (!(best > eps)) return null;
    if (piv !== col) {
      for (let k = col; k < n; k++) {
        const t = A[col * n + k];
        A[col * n + k] = A[piv * n + k];
        A[piv * n + k] = t;
      }
      const t = b[col];
      b[col] = b[piv];
      b[piv] = t;
    }
    const d = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) A[r * n + k] -= f * A[col * n + k];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
    x[r] = s / A[r * n + r];
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(x[i])) return null;
  return x;
}

/**
 * Homography H with H·src[i] ≅ dst[i] for 4 point pairs. Throws if degenerate.
 *
 * Points are first normalized (Hartley) for numerical conditioning, then the
 * standard 8×8 DLT system (h33 = 1) is solved with partial pivoting. The
 * result is scaled so that H[8] = 1 whenever possible.
 */
export function computeHomography(src: readonly Pt[], dst: readonly Pt[]): Mat3 {
  if (!src || !dst || src.length < 4 || dst.length < 4) {
    throw new Error('computeHomography needs 4 source and 4 destination points');
  }
  const s = src.slice(0, 4);
  const d = dst.slice(0, 4);
  if (!s.every(isFinitePt) || !d.every(isFinitePt)) throw new Error('computeHomography: non-finite point');

  const Ts = normalizingTransform(s);
  const Td = normalizingTransform(d);
  const A = new Float64Array(64);
  const b = new Float64Array(8);
  for (let i = 0; i < 4; i++) {
    const x = Ts[0] * s[i].x + Ts[2];
    const y = Ts[4] * s[i].y + Ts[5];
    const u = Td[0] * d[i].x + Td[2];
    const v = Td[4] * d[i].y + Td[5];
    const r0 = i * 2 * 8;
    const r1 = r0 + 8;
    // u = (h0 x + h1 y + h2) / (h6 x + h7 y + 1)
    A[r0] = x; A[r0 + 1] = y; A[r0 + 2] = 1;
    A[r0 + 6] = -u * x; A[r0 + 7] = -u * y;
    b[i * 2] = u;
    // v = (h3 x + h4 y + h5) / (h6 x + h7 y + 1)
    A[r1 + 3] = x; A[r1 + 4] = y; A[r1 + 5] = 1;
    A[r1 + 6] = -v * x; A[r1 + 7] = -v * y;
    b[i * 2 + 1] = v;
  }
  const h = solveLinearSystem(A, b, 8);
  if (!h) throw new Error('computeHomography: degenerate point configuration');
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const TdInv = invertMat3(Td);
  if (!TdInv) throw new Error('computeHomography: degenerate destination points');
  const H = mulMat3(mulMat3(TdInv, Hn), Ts);
  const scale = Math.abs(H[8]) > 1e-12 ? 1 / H[8] : 1;
  const out = H.map((v) => v * scale) as Mat3;
  if (!out.every(Number.isFinite)) throw new Error('computeHomography: degenerate point configuration');
  // Reject configurations where three points are collinear (the solve can
  // still succeed but the mapping collapses the quad).
  if (!s.every((p, i) => {
    const q = applyHomography(out, p);
    return Math.hypot(q.x - d[i].x, q.y - d[i].y) <= 1e-6 * (1 + Math.hypot(d[i].x, d[i].y));
  })) {
    throw new Error('computeHomography: degenerate point configuration');
  }
  return out;
}

/** Inverse of a 3×3 matrix, or null when singular (relative to its scale). */
export function invertMat3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  let scale = 0;
  for (const v of m) scale = Math.max(scale, Math.abs(v));
  if (!Number.isFinite(det) || !(scale > 0) || Math.abs(det) <= 1e-14 * scale * scale * scale) return null;
  const inv = 1 / det;
  return [
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ];
}

/**
 * Projective transform of a point. Points on (or extremely near) the line at
 * infinity map to very large but finite coordinates instead of NaN/Infinity.
 */
export function applyHomography(m: Mat3, p: Pt): Pt {
  let w = m[6] * p.x + m[7] * p.y + m[8];
  if (Math.abs(w) < 1e-12) w = w < 0 ? -1e-12 : 1e-12;
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / w,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / w,
  };
}

/** Even-odd rule. Polygons with fewer than 3 points contain nothing. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** Absolute area (shoelace). */
export function polygonArea(poly: readonly Pt[]): number {
  const n = poly.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  const a = Math.abs(s) / 2;
  return Number.isFinite(a) ? a : 0;
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** True for a strictly convex, non-self-intersecting 4-gon (either winding). */
export function isConvexQuad(q: readonly Pt[]): boolean {
  if (q.length !== 4 || !q.every(isFinitePt)) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0 || !Number.isFinite(cross)) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Rotates `p` about `center`; positive degrees turn clockwise on screen (y down), like canvas rotate(). */
export function rotatePoint(p: Pt, center: Pt, degrees: number): Pt {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Distance from p to segment ab. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
