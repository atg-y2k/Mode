/**
 * Coursed overlapping units: asphalt roof shingles (3-tab or architectural)
 * and cedar shingle siding. Each course is overlapped by the one above, so
 * the top of every course sits in the shadow of the butt edge above it.
 */
import { addFbm, addStreaks, addWhiteNoise, cellsFor, fbmField } from './noise';
import type { PatternFactory } from './plan';
import type { Rng } from './rng';
import { hash3 } from './rng';
import { blendTone, specRng, type NormSpec } from './spec';
import { clamp, smoothstep, type Surface, type Vec3 } from './surface';

interface Course {
  /** Sorted unit start positions (inches) and widths; units wrap around the tile. */
  starts: number[];
  widths: number[];
  /** First unit id of the course. */
  base: number;
}

/** Random unit widths around `mean` that sum exactly to `span`, starting at a random offset. */
function makeCourse(rng: Rng, span: number, mean: number, spread: number, base: number, offset: number): Course {
  const n = Math.max(1, Math.round(span / mean));
  const raw: number[] = [];
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const v = mean * (1 + (rng.next() * 2 - 1) * spread);
    raw.push(v);
    sum += v;
  }
  const widths = raw.map((v) => (v * span) / sum);
  const starts: number[] = [];
  let acc = offset;
  for (const wv of widths) {
    starts.push(((acc % span) + span) % span);
    acc += wv;
  }
  const order = starts.map((st, k) => ({ st, wv: widths[k] })).sort((a, b) => a.st - b.st);
  return { starts: order.map((o) => o.st), widths: order.map((o) => o.wv), base };
}

/** Index of the unit covering x in a course (scanline pointer helper). */
function unitAt(c: Course, xIn: number): number {
  const s = c.starts;
  let lo = 0;
  let hi = s.length - 1;
  if (xIn < s[0]) return s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid] <= xIn) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Distance (inches) from x to the nearest unit boundary in a course. */
function boundaryDist(c: Course, k: number, xIn: number, span: number): { u: number; d: number } {
  let u = xIn - c.starts[k];
  if (u < 0) u += span;
  return { u, d: Math.min(u, c.widths[k] - u) };
}

interface CoursedOptions {
  exposure: number;
  span: number;
  rows: number;
  /** Builds the courses (row r) — controls tab widths and stagger. */
  course: (rng: Rng, r: number, base: number) => Course;
  /** Keyway / gap width between units, inches. */
  gap: number;
  gapColor: Vec3;
  /** Shadow under the butt of the course above: length (inches) and darkness. */
  shadowLen: number;
  shadowDark: number;
  /** Per-unit vertical jitter of butt edges (inches). */
  buttJitter: number;
  /** Tone multiplier at (u, v) on a unit `width` inches wide. */
  shade: (s: Surface, i: number, unit: number, u: number, v: number, width: number) => number;
  tone: (rng: Rng, unit: number) => Vec3;
  thickness: number;
}

function coursed(spec: NormSpec, o: CoursedOptions) {
  return {
    spanX: o.span,
    spanY: o.exposure * o.rows,
    minFeatureIn: o.exposure / 3,
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const rng = specRng(spec, 130);
      const courses: Course[] = [];
      let nUnits = 0;
      for (let r = 0; r < o.rows; r++) {
        const c = o.course(rng, r, nUnits);
        courses.push(c);
        nUnits += c.starts.length;
      }
      const tones: Vec3[] = [];
      const butt: number[] = [];
      for (let k = 0; k < nUnits; k++) {
        tones.push(o.tone(rng, k));
        butt.push((rng.next() * 2 - 1) * o.buttJitter);
      }
      const e = o.exposure;
      for (let y = 0; y < h; y++) {
        const yIn = (y + 0.5) / sy;
        const r = Math.min(o.rows - 1, Math.floor(yIn / e));
        const v = yIn - r * e;
        const c = courses[r];
        const above = courses[(r - 1 + o.rows) % o.rows];
        for (let x = 0; x < w; x++) {
          const xIn = (x + 0.5) / sx;
          const k = unitAt(c, xIn);
          const { u, d } = boundaryDist(c, k, xIn, o.span);
          const id = c.base + k;
          // Butt edge of the unit above at this x (it overlaps the top of this course).
          const ka = unitAt(above, xIn);
          const buttAbove = butt[above.base + ka];
          const vb = v - buttAbove;
          const i = y * w + x;
          let t: Vec3;
          let kShade: number;
          let gcov: number;
          let hgt: number;
          if (vb < 0) {
            // Still on the unit above (its butt hangs lower here).
            const ida = above.base + ka;
            t = tones[ida];
            const ua = boundaryDist(above, ka, xIn, o.span);
            kShade = o.shade(s, i, ida, ua.u, e + v, above.widths[ka]);
            gcov = clamp((ua.d - o.gap / 2) * ppi + 0.5, 0, 1);
            hgt = o.thickness;
          } else {
            t = tones[id];
            kShade = o.shade(s, i, id, u, v, c.widths[k]);
            kShade *= 1 - o.shadowDark * (1 - smoothstep(0, o.shadowLen, vb));
            gcov = clamp((d - o.gap / 2) * ppi + 0.5, 0, 1);
            hgt = o.thickness * Math.min(1, vb / e) * gcov;
          }
          const gc = o.gapColor;
          const p = i * 3;
          rgb[p] = t[0] * kShade * gcov + gc[0] * (1 - gcov);
          rgb[p + 1] = t[1] * kShade * gcov + gc[1] * (1 - gcov);
          rgb[p + 2] = t[2] * kShade * gcov + gc[2] * (1 - gcov);
          height[i] = hgt;
        }
      }
      return { bump: 0.5, ao: 1, aoRadiusIn: 0.4 };
    },
  };
}

// ---------------------------------------------------------------------------
// Roof shingles
// ---------------------------------------------------------------------------

export const roofShingles: PatternFactory = (spec) => {
  const small = Math.min(spec.uw, spec.uh);
  const exposure = clamp(small <= 10 ? small : 5.625, 3, 12);
  const big = Math.max(spec.uw, spec.uh);
  const tab = clamp(big > 10 ? big : 12, 6, 40);
  const threeTab = spec.variation <= 0.2;
  const span = threeTab ? tab * clamp(Math.round(48 / tab), 2, 8) : 48;
  const rows = clamp(Math.ceil(36 / exposure / 2) * 2, 4, 16);
  let granules: Float32Array | null = null;
  let mottle: Float32Array | null = null;
  const bands: number[] = [];
  const cuts: number[] = [];
  return coursed(spec, {
    exposure,
    span,
    rows,
    course: (rng, r, base) =>
      threeTab
        ? makeCourse(rng, span, tab, 0, base, (r % 2) * tab * 0.5)
        : makeCourse(rng, span, Math.min(tab, 12) * 0.75, 0.55, base, rng.next() * span),
    gap: threeTab ? 0.3 : 0.08,
    gapColor: [0.01, 0.01, 0.01],
    shadowLen: 0.55,
    shadowDark: 0.6,
    buttJitter: 0,
    thickness: 0.18,
    tone: (rng) => {
      // Architectural (laminated) tabs: the darker under-layer shows through a
      // cut-out at the end of each tab, and some tabs are a shade darker.
      bands.push(!threeTab && rng.chance(0.35) ? rng.range(0.1, 0.22) : 0);
      cuts.push(threeTab ? 0 : rng.range(1.2, 3.6));
      return blendTone(rng, spec, threeTab ? 0.2 : 0.55, threeTab ? 0.03 : 0.07);
    },
    shade: (s, i, unit, u, v, width) => {
      if (!granules) {
        granules = new Float32Array(s.w * s.h);
        addWhiteNoise(granules, s.w, s.h, spec.seed ^ 0xc01, 1);
        addFbm(granules, s.w, s.h, cellsFor(s.w, 0.3 * s.sx), cellsFor(s.h, 0.3 * s.sy), 2, 0.5, spec.seed ^ 0xc02, 0.6);
        mottle = fbmField(s.w, s.h, cellsFor(s.w, 10 * s.sx), cellsFor(s.h, 6 * s.sy), 3, 0.5, spec.seed ^ 0xc03);
      }
      const res = clamp((s.sx + s.sy) / 40, 0.35, 1);
      let k = 1 + granules[i] * 0.1 * res + mottle![i] * 0.04;
      k *= 1 - bands[unit];
      const cut = cuts[unit];
      if (cut > 0) {
        const ppi = (s.sx + s.sy) / 2;
        const inCut = clamp((u - (width - cut)) * ppi + 0.5, 0, 1) * clamp((v - exposure * 0.32) * ppi + 0.5, 0, 1);
        k *= 1 - 0.42 * inCut;
      }
      return k;
    },
  });
};

// ---------------------------------------------------------------------------
// Shingle siding (cedar shakes)
// ---------------------------------------------------------------------------

export const shingleSiding: PatternFactory = (spec) => {
  const exposure = clamp(spec.uh <= 14 ? spec.uh : 7, 3, 14);
  const avgW = clamp(spec.uw <= 18 ? spec.uw : 7, 2.5, 18);
  const span = 48;
  const rows = clamp(Math.ceil(42 / exposure), 4, 14);
  let grain: Float32Array | null = null;
  const seedK = spec.seed;
  return coursed(spec, {
    exposure,
    span,
    rows,
    course: (rng, _r, base) => makeCourse(rng, span, avgW, 0.6, base, rng.next() * span),
    gap: 0.2,
    gapColor: [0.015, 0.011, 0.008],
    shadowLen: 0.6,
    shadowDark: 0.6,
    buttJitter: 0.18 * spec.variation + 0.04,
    thickness: 0.4,
    tone: (rng) => blendTone(rng, spec, 0.7, 0.12),
    shade: (s, i, unit, u) => {
      if (!grain) {
        grain = new Float32Array(s.w * s.h);
        addStreaks(grain, s.w, s.h, s.sy * 3, spec.seed ^ 0xd01, 1, true);
        addStreaks(grain, s.w, s.h, s.sy * 0.8, spec.seed ^ 0xd02, 0.7, true);
      }
      // Per-shingle grain streaks plus a faint weathering split now and then.
      const split = (hash3(unit, Math.floor(u * 4), seedK) & 255) < 3 ? 0.75 : 1;
      return (1 + grain[i] * 0.09) * split;
    },
  });
};

