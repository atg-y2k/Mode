/**
 * Stone patterns: mixed-size pavers, flagstone, cobblestone, gravel and
 * stone veneer (ledgestone / fieldstone courses).
 */
import { addFbm, addWhiteNoise, cellsFor, fbmField } from './noise';
import type { PatternFactory } from './plan';
import type { Rng } from './rng';
import { jointColor, jointWidth, paletteMean, pickTone, specRng, type NormSpec } from './spec';
import { clamp, mix3, scale3, wrap, type Surface, type Vec3 } from './surface';
import { makeSites, voronoiMap } from './voronoi';

/** Sandy / mortar joint fill a little darker than the stone. */
function defaultJoint(spec: NormSpec, k: number): Vec3 {
  const m = paletteMean(spec.palette);
  const l = 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  return scale3(mix3(m, [l * 1.02, l, l * 0.92], 0.65), k);
}

/** Per-element offsets into shared periodic fields so neighbours don't share texture. */
function offsets(rng: Rng, n: number, w: number, h: number): Int32Array {
  const o = new Int32Array(n * 2);
  for (let k = 0; k < n; k++) {
    o[k * 2] = rng.int(w);
    o[k * 2 + 1] = rng.int(h);
  }
  return o;
}

/** Index of pixel (x, y) shifted by an element's offset, wrapped into the tile. */
function shifted(x: number, y: number, ox: number, oy: number, w: number, h: number): number {
  let xx = x + ox;
  if (xx >= w) xx -= w;
  let yy = y + oy;
  if (yy >= h) yy -= h;
  return yy * w + xx;
}

// ---------------------------------------------------------------------------
// Mixed-size pavers
// ---------------------------------------------------------------------------

interface Paver {
  c: number;
  r: number;
  cw: number;
  ch: number;
}

/** Toroidal greedy packing of a g×g module grid with rectangles of mixed sizes. */
function packPavers(rng: Rng, gx: number, gy: number): { owner: Int32Array; pavers: Paver[] } {
  const owner = new Int32Array(gx * gy).fill(-1);
  const pavers: Paver[] = [];
  // Shapes in modules with relative frequency.
  const shapes: [number, number, number][] = [
    [2, 2, 5],
    [3, 2, 3],
    [2, 3, 3],
    [2, 1, 2],
    [1, 2, 2],
    [3, 3, 1.2],
    [1, 1, 0.6],
  ];
  const total = shapes.reduce((a, s) => a + s[2], 0);
  const fits = (c: number, r: number, cw: number, ch: number) => {
    for (let dr = 0; dr < ch; dr++)
      for (let dc = 0; dc < cw; dc++) if (owner[wrap(r + dr, gy) * gx + wrap(c + dc, gx)] !== -1) return false;
    return true;
  };
  const start = rng.int(gx * gy);
  for (let n = 0; n < gx * gy; n++) {
    const cell = (start + n) % (gx * gy);
    if (owner[cell] !== -1) continue;
    const c = cell % gx;
    const r = Math.floor(cell / gx);
    let placed = false;
    for (let attempt = 0; attempt < 6 && !placed; attempt++) {
      let pick = rng.next() * total;
      let sh = shapes[0];
      for (const s of shapes) {
        pick -= s[2];
        if (pick <= 0) {
          sh = s;
          break;
        }
      }
      if (sh[0] <= gx && sh[1] <= gy && fits(c, r, sh[0], sh[1])) {
        const id = pavers.length;
        pavers.push({ c, r, cw: sh[0], ch: sh[1] });
        for (let dr = 0; dr < sh[1]; dr++)
          for (let dc = 0; dc < sh[0]; dc++) owner[wrap(r + dr, gy) * gx + wrap(c + dc, gx)] = id;
        placed = true;
      }
    }
    if (!placed) {
      // Grow a 1×1 into a free right or lower neighbour when possible, else keep it.
      const id = pavers.length;
      const right = wrap(c + 1, gx);
      const wide = gx > 1 && owner[r * gx + right] === -1 && rng.chance(0.7);
      pavers.push({ c, r, cw: wide ? 2 : 1, ch: 1 });
      owner[cell] = id;
      if (wide) owner[r * gx + right] = id;
    }
  }
  return { owner, pavers };
}

export const stonePavers: PatternFactory = (spec) => {
  const mx = clamp(spec.uw, 1, 48) / 2;
  const my = clamp(spec.uh, 1, 48) / 2;
  const joint = jointWidth(spec, 0.3);
  const gx = clamp(Math.round(66 / (mx + joint / 2)), 4, 24);
  const gy = clamp(Math.round(66 / (my + joint / 2)), 4, 24);
  const pmx = mx + joint / 2;
  const pmy = my + joint / 2;
  return {
    spanX: gx * pmx,
    spanY: gy * pmy,
    minFeatureIn: Math.max(0.12, joint),
    render(s) {
      const rng = specRng(spec, 20);
      const { owner, pavers } = packPavers(rng, gx, gy);
      const tones = pavers.map(() => pickTone(rng, spec, { light: 0.14, hue: 0.04, blend: 0.6 }));
      const lift = pavers.map(() => rng.range(-0.04, 0.04));
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const off = offsets(rng, pavers.length, w, h);
      const mottle = fbmField(w, h, cellsFor(w, 4 * sx), cellsFor(h, 4 * sy), 4, 0.55, spec.seed ^ 0x201);
      const grain = new Float32Array(w * h);
      addWhiteNoise(grain, w, h, spec.seed ^ 0x202, 1);
      const chip = fbmField(w, h, cellsFor(w, 0.7 * sx), cellsFor(h, 0.7 * sy), 2, 0.5, spec.seed ^ 0x203);
      const jc = jointColor(spec, defaultJoint(spec, 0.55));
      const half = joint / 2;
      const spanX = gx * pmx;
      const spanY = gy * pmy;
      for (let y = 0; y < h; y++) {
        const yIn = (y + 0.5) / sy;
        const mr = Math.min(gy - 1, Math.floor(yIn / pmy));
        for (let x = 0; x < w; x++) {
          const xIn = (x + 0.5) / sx;
          const mc = Math.min(gx - 1, Math.floor(xIn / pmx));
          const id = owner[mr * gx + mc];
          const pv = pavers[id];
          // Position on this paver (unwrapped relative to its origin module).
          let u = xIn - pv.c * pmx;
          if (u < 0) u += spanX;
          let v = yIn - pv.r * pmy;
          if (v < 0) v += spanY;
          u -= half;
          v -= half;
          const fw = pv.cw * pmx - joint;
          const fh = pv.ch * pmy - joint;
          const i = y * w + x;
          const edge = Math.min(u, fw - u, v, fh - v) + chip[i] * 0.06;
          const cov = clamp(edge * ppi + 0.5, 0, 1);
          const j = shifted(x, y, off[id * 2], off[id * 2 + 1], w, h);
          const t = tones[id];
          const k = 1 + mottle[j] * 0.1 + grain[i] * 0.035;
          const jk = 1 + grain[i] * 0.1;
          const p = i * 3;
          rgb[p] = jc[0] * jk * (1 - cov) + t[0] * k * cov;
          rgb[p + 1] = jc[1] * jk * (1 - cov) + t[1] * k * cov;
          rgb[p + 2] = jc[2] * jk * (1 - cov) + t[2] * k * cov;
          const e = clamp(edge / 0.3, 0, 1);
          height[i] = (lift[id] - 0.1 * (1 - e) * (1 - e) + mottle[j] * 0.02) * cov - 0.25 * (1 - cov);
        }
      }
      return { bump: 1, ao: 1.6, aoRadiusIn: Math.max(0.3, joint * 1.6) };
    },
  };
};

// ---------------------------------------------------------------------------
// Voronoi stones: flagstone, cobblestone, gravel
// ---------------------------------------------------------------------------

interface VoronoiStoneOptions {
  /** Cell size, inches. */
  cell: number;
  /** Cells across the tile (x, y). */
  gx: number;
  gy: number;
  jitter: number;
  weight: number;
  stagger: boolean;
  joint: number;
  jointColor: Vec3;
  /** Edge irregularity (warp amplitude, inches) and its feature size. */
  warp: number;
  warpScale: number;
  /** Relief: rounded profile radius and height (inches), surface roughness. */
  round: number;
  dome: number;
  rough: number;
  roughScale: number;
  /** Color: per-stone tone options, mottling and speckle. */
  toneLight: number;
  toneHue: number;
  mottle: number;
  speckle: number;
  /** Fraction of the cell kept as the stone (shrinks it inside its cell; gravel). */
  ao: number;
}

function voronoiStones(spec: NormSpec, o: VoronoiStoneOptions) {
  return {
    spanX: o.gx * o.cell,
    spanY: o.gy * o.cell,
    minFeatureIn: Math.max(0.05, Math.min(o.joint, o.cell * 0.15)),
    render(s: Surface) {
      const rng = specRng(spec, 30);
      const sites = makeSites(rng, o.gx, o.gy, o.cell, o.cell, o.jitter, o.weight, o.stagger);
      const { w, h, sx, sy, rgb, height } = s;
      const n = o.gx * o.gy;
      let wx: Float32Array | undefined;
      let wy: Float32Array | undefined;
      if (o.warp > 0) {
        const cx = cellsFor(w, o.warpScale * sx);
        const cy = cellsFor(h, o.warpScale * sy);
        wx = fbmField(w, h, cx, cy, 3, 0.5, spec.seed ^ 0x301);
        wy = fbmField(w, h, cx, cy, 3, 0.5, spec.seed ^ 0x302);
        for (let i = 0; i < wx.length; i++) {
          wx[i] *= o.warp;
          wy[i] *= o.warp;
        }
      }
      const map = voronoiMap(s, sites, wx, wy);
      const tones: Vec3[] = [];
      const lift: number[] = [];
      for (let k = 0; k < n; k++) {
        tones.push(pickTone(rng, spec, { light: o.toneLight, hue: o.toneHue, blend: 0.7 }));
        lift.push(rng.range(-1, 1));
      }
      const off = offsets(rng, n, w, h);
      const rough = fbmField(w, h, cellsFor(w, o.roughScale * sx), cellsFor(h, o.roughScale * sy), 4, 0.55, spec.seed ^ 0x303);
      const mott = fbmField(w, h, cellsFor(w, o.cell * 0.6 * sx), cellsFor(h, o.cell * 0.6 * sy), 3, 0.55, spec.seed ^ 0x304);
      const speck = new Float32Array(w * h);
      addWhiteNoise(speck, w, h, spec.seed ^ 0x305, 1);
      const ppi = (sx + sy) / 2;
      const half = o.joint / 2;
      const jc = o.jointColor;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const id = map.id[i];
          const edge = map.edge[i] - half;
          const cov = clamp(edge * ppi + 0.5, 0, 1);
          const j = shifted(x, y, off[id * 2], off[id * 2 + 1], w, h);
          const t = tones[id];
          const k = 1 + mott[j] * o.mottle + speck[i] * o.speckle + rough[j] * o.mottle * 0.5;
          const jk = 1 + speck[i] * 0.12;
          const p = i * 3;
          rgb[p] = jc[0] * jk * (1 - cov) + t[0] * k * cov;
          rgb[p + 1] = jc[1] * jk * (1 - cov) + t[1] * k * cov;
          rgb[p + 2] = jc[2] * jk * (1 - cov) + t[2] * k * cov;
          const e = clamp(edge / o.round, 0, 1);
          const profile = 1 - (1 - e) * (1 - e);
          height[i] = (o.dome * (profile + lift[id] * 0.15) + rough[j] * o.rough) * cov - o.dome * 0.4 * (1 - cov);
        }
      }
      return { bump: 1, ao: o.ao, aoRadiusIn: Math.max(0.1, Math.min(o.cell * 0.3, 2)) };
    },
  };
}

export const flagstone: PatternFactory = (spec) => {
  const cell = clamp((spec.uw + spec.uh) / 2, 4, 60);
  const g = clamp(Math.round(80 / cell), 3, 10);
  const joint = jointWidth(spec, clamp(cell * 0.05, 0.4, 1.5));
  return voronoiStones(spec, {
    cell,
    gx: g,
    gy: g,
    jitter: 0.85,
    weight: 0.12,
    stagger: false,
    joint,
    jointColor: jointColor(spec, defaultJoint(spec, 0.42)),
    warp: cell * 0.035,
    warpScale: cell * 0.45,
    round: clamp(cell * 0.025, 0.2, 0.6),
    dome: 0.35,
    rough: 0.12,
    roughScale: cell * 0.35,
    toneLight: 0.2,
    toneHue: 0.06,
    mottle: 0.11,
    speckle: 0.03,
    ao: 1.6,
  });
};

export const cobblestone: PatternFactory = (spec) => {
  const cell = clamp((spec.uw + spec.uh) / 2, 1.5, 16);
  const g = clamp(Math.round(40 / cell / 2) * 2, 4, 24);
  const joint = jointWidth(spec, clamp(cell * 0.1, 0.25, 1));
  return voronoiStones(spec, {
    cell,
    gx: g,
    gy: g,
    jitter: 0.35,
    weight: 0.05,
    stagger: true,
    joint,
    jointColor: jointColor(spec, defaultJoint(spec, 0.35)),
    warp: cell * 0.05,
    warpScale: cell * 0.5,
    round: cell * 0.32,
    dome: cell * 0.18,
    rough: cell * 0.02,
    roughScale: cell * 0.3,
    toneLight: 0.2,
    toneHue: 0.05,
    mottle: 0.08,
    speckle: 0.08,
    ao: 1.6 / Math.max(0.5, cell * 0.25),
  });
};

export const gravel: PatternFactory = (spec) => {
  const cell = clamp((spec.uw + spec.uh) / 2, 0.15, 6);
  const g = clamp(Math.round(18 / cell), 10, 72);
  return voronoiStones(spec, {
    cell,
    gx: g,
    gy: g,
    jitter: 0.9,
    weight: 0.1,
    stagger: true,
    joint: jointWidth(spec, cell * 0.12),
    jointColor: jointColor(spec, scale3(paletteMean(spec.palette), 0.22)),
    warp: cell * 0.12,
    warpScale: cell * 0.6,
    round: cell * 0.4,
    dome: cell * 0.3,
    rough: cell * 0.015,
    roughScale: cell * 0.4,
    toneLight: 0.3,
    toneHue: 0.08,
    mottle: 0.06,
    speckle: 0.05,
    ao: 2.5 / cell,
  });
};

// ---------------------------------------------------------------------------
// Stone veneer: rough coursed stones of varying height and length
// ---------------------------------------------------------------------------

/** n random sizes around `mean` (±spread) that sum exactly to `total`. */
function partition(rng: Rng, total: number, mean: number, spread: number): number[] {
  const n = Math.max(1, Math.round(total / mean));
  const raw: number[] = [];
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const v = mean * (1 + (rng.next() * 2 - 1) * spread);
    raw.push(v);
    sum += v;
  }
  return raw.map((v) => (v * total) / sum);
}

export const stoneVeneer: PatternFactory = (spec) => {
  const len = clamp(Math.max(spec.uw, spec.uh), 2, 48);
  const course = clamp(Math.min(spec.uw, spec.uh), 1, 24);
  const joint = jointWidth(spec, clamp(course * 0.12, 0.2, 0.75));
  const spanY = course * clamp(Math.round(40 / course), 5, 16);
  const spanX = len * clamp(Math.round(48 / len), 3, 10);
  return {
    spanX,
    spanY,
    minFeatureIn: Math.max(0.1, joint * 0.8),
    render(s) {
      const rng = specRng(spec, 40);
      const heights = partition(rng, spanY, course, 0.45);
      const courses = heights.map((hh) => {
        const lens = partition(rng, spanX, len * (0.7 + 0.6 * rng.next()), 0.55);
        const starts: number[] = [];
        let acc = rng.next() * spanX;
        for (const l of lens) {
          starts.push(acc % spanX);
          acc += l;
        }
        // Sorted by start for the scanline lookup.
        const order = starts.map((st, k) => ({ st, l: lens[k] })).sort((a, b) => a.st - b.st);
        return { h: hh, starts: order.map((q) => q.st), lens: order.map((q) => q.l) };
      });
      let nStones = 0;
      const base: number[] = [];
      for (const c of courses) {
        base.push(nStones);
        nStones += c.starts.length;
      }
      const tones: Vec3[] = [];
      const proud: number[] = [];
      const inset: number[] = [];
      for (let k = 0; k < nStones; k++) {
        tones.push(pickTone(rng, spec, { light: 0.24, hue: 0.06, blend: 0.8 }));
        proud.push(rng.range(0, 0.6));
        inset.push(rng.range(0, 0.18) * course);
      }
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const off = offsets(rng, nStones, w, h);
      const rough = fbmField(w, h, cellsFor(w, 1.6 * sx), cellsFor(h, 1.6 * sy), 4, 0.6, spec.seed ^ 0x401);
      const edgeN = fbmField(w, h, cellsFor(w, 1.2 * sx), cellsFor(h, 1.2 * sy), 3, 0.5, spec.seed ^ 0x402);
      const speck = new Float32Array(w * h);
      addWhiteNoise(speck, w, h, spec.seed ^ 0x403, 1);
      addFbm(speck, w, h, cellsFor(w, 0.3 * sx), cellsFor(h, 0.3 * sy), 2, 0.5, spec.seed ^ 0x404, 0.7);
      const jc = jointColor(spec, defaultJoint(spec, 0.3));
      const half = joint / 2;
      const cum: number[] = [];
      let yAcc = 0;
      for (const c of courses) {
        cum.push(yAcc);
        yAcc += c.h;
      }
      let ci = 0;
      for (let y = 0; y < h; y++) {
        const yIn = (y + 0.5) / sy;
        while (ci + 1 < courses.length && yIn >= cum[ci + 1]) ci++;
        const c = courses[ci];
        const v = yIn - cum[ci];
        const n = c.starts.length;
        let k = -1;
        for (let x = 0; x < w; x++) {
          const xIn = (x + 0.5) / sx;
          while (k + 1 < n && xIn >= c.starts[k + 1]) k++;
          const kk = k < 0 ? n - 1 : k;
          let u = xIn - c.starts[kk];
          if (u < 0) u += spanX;
          const id = base[ci] + kk;
          const i = y * w + x;
          // Rough rounded-rectangle face with an irregular outline.
          const ins = half + inset[id] * 0.25;
          const du = Math.min(u - ins, c.lens[kk] - ins - u);
          const dv = Math.min(v - half, c.h - half - v - inset[id] * 0.5);
          const rr = Math.min(1.2, course * 0.3);
          const ax = Math.max(rr - du, 0);
          const ay = Math.max(rr - dv, 0);
          const edge = rr - Math.sqrt(ax * ax + ay * ay) + edgeN[i] * (0.18 + joint * 0.4);
          const cov = clamp(Math.min(edge, Math.min(du, dv) + rr) * ppi + 0.5, 0, 1);
          const j = shifted(x, y, off[id * 2], off[id * 2 + 1], w, h);
          const t = tones[id];
          const kk2 = 1 + rough[j] * 0.12 + speck[i] * 0.06;
          const jk = 1 + speck[i] * 0.1;
          const p = i * 3;
          rgb[p] = jc[0] * jk * (1 - cov) + t[0] * kk2 * cov;
          rgb[p + 1] = jc[1] * jk * (1 - cov) + t[1] * kk2 * cov;
          rgb[p + 2] = jc[2] * jk * (1 - cov) + t[2] * kk2 * cov;
          const e = clamp(edge / 0.9, 0, 1);
          const face = 0.5 + proud[id] * 0.6 + (1 - (1 - e) * (1 - e)) * 0.45 + rough[j] * 0.35;
          height[i] = face * cov - 0.4 * (1 - cov);
        }
      }
      return { bump: 1, ao: 1.2, aoRadiusIn: Math.max(0.5, course * 0.25) };
    },
  };
};

