/**
 * Wood grain evaluated in board-local coordinates (u along the board, v
 * across it, inches), so it works for boards in any orientation (rows,
 * herringbone, chevron). Each board is a slice through a log: growth rings
 * are the intersection of nested cylinders with the face plane, which gives
 * straight grain, cathedral arches and knots for free.
 */
import type { Rng } from './rng';
import { pickTone, type NormSpec } from './spec';
import { clamp, smoothstep, type Vec3 } from './surface';

export interface Grain {
  color: Vec3;
  /** Pith offset across the board, inches. */
  vc: number;
  /** Depth of the face below the pith and its drift per inch along the board. */
  d0: number;
  tilt: number;
  spacing: number;
  phase: number;
  /** Late-wood contrast 0..1. */
  contrast: number;
  /** Slow wobble of the rings along the board. */
  w1: number;
  w2: number;
  /** Per-board hash seed for fibers / figure. */
  seed: number;
  knot: { u: number; v: number; ru: number; rv: number } | null;
}

export function makeGrain(rng: Rng, spec: NormSpec, boardW: number, len: number, contrast: number, toneScale = 1): Grain {
  const scaled: NormSpec = toneScale === 1 ? spec : { ...spec, variation: clamp(spec.variation * toneScale, 0, 1) };
  return {
    color: pickTone(rng, scaled, { light: 0.13, hue: 0.018 }),
    vc: rng.range(-0.6, 1.6) * boardW,
    d0: rng.range(0.4, 5) * (rng.chance(0.5) ? 1 : -1),
    tilt: rng.range(0.012, 0.07) * (rng.chance(0.5) ? 1 : -1),
    spacing: rng.range(0.16, 0.34) * clamp(boardW / 5, 0.75, 1.5),
    phase: rng.next() * 10,
    contrast: contrast * rng.range(0.6, 1.25),
    w1: rng.next() * 6.283,
    w2: rng.next() * 6.283,
    seed: (rng.next() * 4294967296) >>> 0,
    knot:
      len > 18 && rng.chance(0.04 + 0.22 * spec.variation)
        ? { u: rng.range(4, len - 4), v: rng.range(0.25, 0.75) * boardW, ru: rng.range(0.3, 0.6), rv: rng.range(0.18, 0.34) }
        : null,
  };
}

const TAU = Math.PI * 2;
const SIN_N = 2048;
const SIN_LUT: Float32Array = (() => {
  const t = new Float32Array(SIN_N + 1);
  for (let i = 0; i <= SIN_N; i++) t[i] = Math.sin((i / SIN_N) * TAU);
  return t;
})();

/** Table sine (error < 2e-6), several times cheaper than Math.sin in per-pixel loops. */
export function fastSin(x: number): number {
  const t = x * (SIN_N / TAU);
  const f = Math.floor(t);
  const i = f & (SIN_N - 1);
  return SIN_LUT[i] + (SIN_LUT[i + 1] - SIN_LUT[i]) * (t - f);
}

/** Small integer hash → [-1, 1). */
function h2(a: number, b: number, seed: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return h / 2147483648;
}

/**
 * Value noise stretched along the board: cells of `cu` inches along and `cv`
 * across, interpolated smoothly along and linearly across. Range [-1, 1].
 */
export function boardNoise(seed: number, u: number, v: number, cu: number, cv: number): number {
  const a = u / cu;
  const b = v / cv;
  const ia = Math.floor(a);
  const ib = Math.floor(b);
  let fa = a - ia;
  const fb = b - ib;
  fa = fa * fa * (3 - 2 * fa);
  const h00 = h2(ia, ib, seed);
  const h10 = h2(ia + 1, ib, seed);
  const h01 = h2(ia, ib + 1, seed);
  const h11 = h2(ia + 1, ib + 1, seed);
  const top = h00 + (h10 - h00) * fa;
  const bot = h01 + (h11 - h01) * fa;
  return top + (bot - top) * fb;
}

export interface GrainScale {
  /** Ring contrast fade by how well rings are resolved at this resolution. */
  ringFade: number;
  /** Fiber thickness, inches (about one pixel). */
  fiberIn: number;
  fiberAmp: number;
}

export function grainScale(ppi: number, fiberAmp: number): GrainScale {
  return { ringFade: smoothstep(0.7, 2.6, 0.22 * ppi), fiberIn: Math.max(0.03, 1 / ppi), fiberAmp };
}

/**
 * Tone of a painted or very plain board: fibers and a faint broad figure
 * only (no growth rings) — the cheap path for painted shiplap and siding.
 */
export function plainTone(g: Grain, sc: GrainScale, u: number, v: number): number {
  return 1 + boardNoise(g.seed, u, v, 9, 0.6) * 0.02 + fiberNoise(g.seed ^ 0x99, u, v, 1.2, sc.fiberIn) * sc.fiberAmp;
}

/** Late-wood band profile over one ring period (fraction 0..1 → darkness 0..1). */
const LATE_N = 256;
const LATE_LUT: Float32Array = (() => {
  const t = new Float32Array(LATE_N + 1);
  for (let i = 0; i <= LATE_N; i++) {
    const fr = i / LATE_N;
    t[i] = smoothstep(0.55, 0.8, fr) - smoothstep(0.84, 1, fr);
  }
  return t;
})();

/** 1D value noise along u for the fiber row containing v (2 hashes). Range [-1, 1]. */
function fiberNoise(seed: number, u: number, v: number, cu: number, cv: number): number {
  const a = u / cu;
  const ia = Math.floor(a);
  let fa = a - ia;
  fa = fa * fa * (3 - 2 * fa);
  const row = Math.floor(v / cv);
  const h0 = h2(ia, row, seed);
  return h0 + (h2(ia + 1, row, seed) - h0) * fa;
}

/** Tone multiplier of wood at board-face position (u along, v across). */
export function woodTone(g: Grain, sc: GrainScale, u: number, v: number): number {
  const wob = fastSin(u * 0.23 + g.w1) * 0.3;
  const d = g.d0 + g.tilt * u + wob * 0.6;
  const dv = v - g.vc + wob * 0.25;
  let ring = Math.sqrt(dv * dv + d * d) / g.spacing + g.phase;
  let knotDark = 0;
  if (g.knot) {
    const ku = (u - g.knot.u) / g.knot.ru;
    const kv = (v - g.knot.v) / g.knot.rv;
    const kd = ku * ku + kv * kv;
    if (kd < 25) {
      ring += 3.5 * Math.exp(-kd * 0.4);
      knotDark = 0.6 * Math.exp(-kd * 1.3);
    }
  }
  // Irregular growth: ring widths vary year to year.
  ring += 0.5 * fastSin(ring * 0.57 + g.w2);
  const fr = ring - Math.floor(ring);
  const late = LATE_LUT[(fr * LATE_N) | 0];
  // Broad figure (visible even when rings are not resolved) and fine fibers.
  const figure = boardNoise(g.seed, u, v, 6, 0.4);
  const fiber = fiberNoise(g.seed ^ 0x99, u, v, 1.2, sc.fiberIn);
  const ringK = late * g.contrast * (0.05 + 0.15 * sc.ringFade);
  return (1 - ringK) * (1 + figure * 0.08 * (0.4 + g.contrast) + fiber * sc.fiberAmp) * (1 - knotDark);
}
