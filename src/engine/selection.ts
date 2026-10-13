/**
 * Color-aware selection tools: magic wand (flood fill by perceptual color
 * distance) and smart brush (a brush that only paints pixels similar to the
 * color under the cursor when the stroke started).
 */
import type { Pt } from '../../shared/types';
import { rgbaToLabArray } from './color';
import { brushFalloff, brushProfile, createMask, type BrushOptions } from './mask';
import type { ImageDataLike, Lab, Mask } from './types';

/**
 * Per-pixel Lab cache (3 floats per pixel: L, a, b). Computing it once per photo
 * keeps the wand / smart brush interactive.
 */
export type LabImage = { width: number; height: number; data: Float32Array };

export function computeLabImage(img: ImageDataLike): LabImage {
  const { width, height, data } = img;
  const out = new Float32Array(width * height * 3);
  rgbaToLabArray(data, out, width * height);
  return { width, height, data: out };
}

export interface WandOptions {
  /** Max color distance (CIE76 ΔE) from the seed color, typical 4..40. */
  tolerance: number;
  /** true = flood fill from the seed; false = every similar pixel in the photo. */
  contiguous: boolean;
  /** Seed color = average of a (2r+1)² window around the click (default r = 2). */
  sampleRadius?: number;
}

/** Average Lab of the (2r+1)² window around pixel (cx, cy), clipped to the image. */
export function sampleLab(lab: LabImage, cx: number, cy: number, r: number): Lab {
  const { width: w, height: h, data } = lab;
  const rr = Number.isFinite(r) ? Math.max(0, Math.floor(r)) : 0;
  const x0 = Math.max(0, cx - rr), x1 = Math.min(w - 1, cx + rr);
  const y0 = Math.max(0, cy - rr), y1 = Math.min(h - 1, cy + rr);
  let sl = 0, sa = 0, sb = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * w + x) * 3;
      sl += data[o];
      sa += data[o + 1];
      sb += data[o + 2];
      n++;
    }
  }
  if (n === 0) return { l: 50, a: 0, b: 0 };
  return { l: sl / n, a: sa / n, b: sb / n };
}

/** Pixel coordinates of a point, or null when it lies outside the image. */
function pixelOf(lab: LabImage, p: Pt): { x: number; y: number } | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= lab.width || y >= lab.height) return null;
  return { x, y };
}

const ST_UNKNOWN = 0;
const ST_FILLED = 1;
const ST_REJECTED = 2;
const ST_MATCH = 3; // within tolerance, not yet part of a filled span

/**
 * Returns a NEW mask (255 selected, 0 not, with 1px anti-aliased edge).
 *
 * - Contiguous: 4-connected scanline flood fill from the seed pixel over
 *   pixels within `tolerance` (ΔE76) of the seed color. The seed pixel itself
 *   is always selected, even when it is an outlier.
 * - Global: every pixel within tolerance, plus the seed pixel.
 * - Edge: each unselected pixel touching the selection gets partial coverage
 *   from a tiny two-color matte — how far it sits between the seed color and
 *   its most different unselected neighbour — so blended edge pixels (e.g. a
 *   wall meeting white trim) are neither left as a halo nor fully taken.
 * A seed outside the image yields an empty mask.
 */
export function magicWand(lab: LabImage, seed: Pt, opts: WandOptions): Mask {
  const { width: w, height: h, data } = lab;
  const mask = createMask(w, h);
  const sp = pixelOf(lab, seed);
  if (!sp) return mask;
  const tol = Number.isFinite(opts.tolerance) ? Math.max(0, opts.tolerance) : 0;
  const tol2 = tol * tol;
  const ref = sampleLab(lab, sp.x, sp.y, opts.sampleRadius ?? 2);
  const rl = ref.l, ra = ref.a, rb = ref.b;
  const n = w * h;
  const st = new Uint8Array(n);
  const seedIdx = sp.y * w + sp.x;

  const dist2 = (i: number) => {
    const o = i * 3;
    const dl = data[o] - rl, da = data[o + 1] - ra, db = data[o + 2] - rb;
    return dl * dl + da * da + db * db;
  };

  if (opts.contiguous) {
    let stack = new Int32Array(1024);
    let sp2 = 0;
    const push = (i: number) => {
      if (sp2 === stack.length) {
        const next = new Int32Array(stack.length * 2);
        next.set(stack);
        stack = next;
      }
      stack[sp2++] = i;
    };
    /** Classifies an unknown pixel; returns true when it is within tolerance and unfilled. */
    const isMatch = (i: number) => {
      let s = st[i];
      if (s === ST_UNKNOWN) {
        s = dist2(i) <= tol2 ? ST_MATCH : ST_REJECTED;
        st[i] = s;
      }
      return s === ST_MATCH;
    };
    st[seedIdx] = ST_MATCH; // the seed is always part of the selection
    push(seedIdx);
    while (sp2 > 0) {
      const i = stack[--sp2];
      if (st[i] !== ST_MATCH) continue; // already filled by another span
      const y = (i / w) | 0;
      const row = y * w;
      let xl = i - row;
      let xr = xl;
      while (xl > 0 && isMatch(row + xl - 1)) xl--;
      while (xr < w - 1 && isMatch(row + xr + 1)) xr++;
      for (let x = xl; x <= xr; x++) st[row + x] = ST_FILLED;
      for (let ny = y - 1; ny <= y + 1; ny += 2) {
        if (ny < 0 || ny >= h) continue;
        const nrow = ny * w;
        let inRun = false;
        for (let x = xl; x <= xr; x++) {
          if (isMatch(nrow + x)) {
            if (!inRun) {
              push(nrow + x);
              inRun = true;
            }
          } else inRun = false;
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) if (dist2(i) <= tol2) st[i] = ST_FILLED;
    st[seedIdx] = ST_FILLED;
  }

  const md = mask.data;
  for (let i = 0; i < n; i++) if (st[i] === ST_FILLED) md[i] = 255;
  softenWandEdge(lab, md, st, ref);
  return mask;
}

/** Partial coverage for unselected pixels 4-adjacent to the selection (see magicWand). */
function softenWandEdge(lab: LabImage, md: Uint8Array, st: Uint8Array, ref: Lab): void {
  const { width: w, height: h, data } = lab;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (st[i] === ST_FILLED) continue;
      // Selected 4-neighbours; out-of-image sides count as selected for pinhole detection.
      let sel = 0;
      let inImage = 0;
      if (x > 0) { inImage++; if (st[i - 1] === ST_FILLED) sel++; }
      if (x < w - 1) { inImage++; if (st[i + 1] === ST_FILLED) sel++; }
      if (y > 0) { inImage++; if (st[i - w] === ST_FILLED) sel++; }
      if (y < h - 1) { inImage++; if (st[i + w] === ST_FILLED) sel++; }
      if (sel === 0) continue;
      if (sel === inImage) {
        // Single-pixel pinhole (noise speck, nail hole): paint covers it.
        md[i] = 255;
        continue;
      }
      const o = i * 3;
      const pl = data[o] - ref.l, pa = data[o + 1] - ref.a, pb = data[o + 2] - ref.b;
      // "Other" color: the unselected 8-neighbour (or the pixel itself) farthest from the seed color.
      let vl = pl, va = pa, vb = pb;
      let best = pl * pl + pa * pa + pb * pb;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (st[j] === ST_FILLED) continue;
          const q = j * 3;
          const ql = data[q] - ref.l, qa = data[q + 1] - ref.a, qb = data[q + 2] - ref.b;
          const d = ql * ql + qa * qa + qb * qb;
          if (d > best) {
            best = d;
            vl = ql;
            va = qa;
            vb = qb;
          }
        }
      }
      if (best < 1e-6) continue;
      // Position of p along seed → other: 0 at the seed color, 1 at the other color.
      const t = (pl * vl + pa * va + pb * vb) / best;
      const alpha = 1 - t;
      if (alpha > 0) md[i] = Math.round(Math.min(1, alpha) * 255);
    }
  }
}

export interface SmartBrushOptions extends BrushOptions {
  /** Max ΔE from the reference color. */
  tolerance: number;
}

/**
 * Capsule brush (segment a→b, or a round stamp when a == b) gated by color:
 * full effect for pixels within 75% of the tolerance, ramping to none at the
 * tolerance. Max-combines for 'add', min-combines for 'erase'.
 */
function smartCapsule(
  lab: LabImage,
  mask: Mask,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  opts: SmartBrushOptions,
  ref: Lab,
): void {
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return;
  const w = Math.min(lab.width, mask.width);
  const h = Math.min(lab.height, mask.height);
  const mw = mask.width;
  const lw = lab.width;
  const md = mask.data;
  const ld = lab.data;
  const prof = brushProfile(opts.radius, opts.hardness);
  const opacity = opts.opacity === undefined ? 1 : Number.isFinite(opts.opacity) ? Math.min(1, Math.max(0, opts.opacity)) : 1;
  if (opacity <= 0 || w === 0 || h === 0) return;
  const tol = Number.isFinite(opts.tolerance) ? Math.max(0, opts.tolerance) : 0;
  const full = tol * 0.75;
  const full2 = full * full;
  const tol2 = tol * tol;
  const ramp = tol - full;
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
  const rl = ref.l, ra = ref.a, rb = ref.b;

  for (let y = yMin; y <= yMax; y++) {
    const py = y + 0.5;
    for (let x = xMin; x <= xMax; x++) {
      const px = x + 0.5;
      let t = ((px - ax) * dx + (py - ay) * dy) * inv;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const ex = px - (ax + t * dx);
      const ey = py - (ay + t * dy);
      const d2 = ex * ex + ey * ey;
      if (d2 >= outer2) continue;
      const o = (y * lw + x) * 3;
      const cl = ld[o] - rl, ca = ld[o + 1] - ra, cb = ld[o + 2] - rb;
      const c2 = cl * cl + ca * ca + cb * cb;
      if (c2 > tol2) continue;
      const colorCov = c2 <= full2 ? 1 : ramp > 0 ? (tol - Math.sqrt(c2)) / ramp : 0;
      const cov = (d2 <= inner2 ? 1 : brushFalloff(Math.sqrt(d2), prof)) * colorCov;
      const v = Math.round(cov * scale);
      if (v === 0) continue;
      const i = y * mw + x;
      if (erase) {
        const lim = 255 - v;
        if (md[i] > lim) md[i] = lim;
      } else if (md[i] < v) md[i] = v;
    }
  }
}

/**
 * One smart-brush stamp: like stampBrush but only affects pixels whose color is
 * within tolerance of `reference` (default: the color under (x, y), averaged
 * over its 3×3 neighbourhood to ignore sensor noise; clamped to the image).
 * Coverage ramps down over the last 25% of the tolerance, giving soft but
 * clean wall/trim separation.
 * Returns the reference used so a drag stroke can keep it constant.
 */
export function smartBrushStamp(
  lab: LabImage,
  mask: Mask,
  x: number,
  y: number,
  opts: SmartBrushOptions,
  reference?: Lab,
): Lab {
  let ref = reference;
  if (!ref) {
    if (lab.width === 0 || lab.height === 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { l: 50, a: 0, b: 0 };
    }
    const cx = Math.min(lab.width - 1, Math.max(0, Math.floor(x)));
    const cy = Math.min(lab.height - 1, Math.max(0, Math.floor(y)));
    ref = sampleLab(lab, cx, cy, 1);
  }
  smartCapsule(lab, mask, x, y, x, y, opts, ref);
  return ref;
}

/**
 * Smart-brush along a segment (spacing ≈ radius/4) — implemented as the
 * continuous limit of the stamps (see strokeBrush). A zero-length segment
 * does nothing (its point was stamped already).
 */
export function smartBrushStroke(
  lab: LabImage,
  mask: Mask,
  from: Pt,
  to: Pt,
  opts: SmartBrushOptions,
  reference: Lab,
): void {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-9) return;
  smartCapsule(lab, mask, from.x, from.y, to.x, to.y, opts, reference);
}
