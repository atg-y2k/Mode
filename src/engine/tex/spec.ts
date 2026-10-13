/**
 * Sanitized texture parameters and palette sampling shared by all pattern
 * generators. Specs come from the catalog, the design knowledge base and the
 * AI, so every field is validated and given a sensible default here once.
 */
import type { TexturePattern, TextureSpec } from '../../../shared/types';
import { Rng, seedToUint32 } from './rng';
import { clamp, hexToLinear, mix3, type Vec3 } from './surface';

export interface NormSpec {
  pattern: TexturePattern;
  /** Palette in linear RGB (≥ 1 entry). */
  palette: Vec3[];
  /** Unit size, inches (finite, positive). */
  uw: number;
  uh: number;
  /** Explicit joint from the spec, if any. */
  joint: { color: Vec3; widthIn: number } | null;
  /** 0..1 */
  variation: number;
  /** uint32 seed. */
  seed: number;
}

/** Fallback palettes when a spec has no valid colors. */
const DEFAULT_COLORS: Record<TexturePattern, string[]> = {
  'wood-planks': ['#a77b52', '#8f6441', '#b98d62'],
  herringbone: ['#a77b52', '#8f6441', '#b98d62'],
  chevron: ['#a77b52', '#8f6441', '#b98d62'],
  'tile-grid': ['#e8e4dc'],
  subway: ['#f2f0ea'],
  'hex-tile': ['#f0eee8'],
  brick: ['#9c4a32', '#86402c', '#a95a3c'],
  'stone-pavers': ['#9a958b', '#8a8379', '#aba395'],
  flagstone: ['#8e8576', '#9d917d', '#7d7468'],
  cobblestone: ['#7f7b74', '#8f8a81', '#6e6a64'],
  gravel: ['#b9ab94', '#9c9180', '#cfc4b0', '#7f776b'],
  mulch: ['#5b3a24', '#4a2e1c', '#6d4a30'],
  grass: ['#4f7a2c', '#5f8a34', '#6b9440'],
  concrete: ['#a9a59e'],
  stucco: ['#e3dccd'],
  'lap-siding': ['#d9d6cc'],
  'board-batten': ['#e9e7e1'],
  'shingle-siding': ['#9a7a5a', '#8a6b4e', '#a98a68'],
  'roof-shingles': ['#4a4a4a', '#3a3a3a', '#5a5753'],
  'standing-seam': ['#3d4348'],
  'deck-boards': ['#8a6446', '#7a573c', '#9a7354'],
  carpet: ['#b7ab98'],
  marble: ['#f1efeb', '#8f8f93', '#b9b7b4'],
  terrazzo: ['#ece8e0', '#3f3f3f', '#c9a27c', '#8a8f94', '#b04a3a'],
  'stone-veneer': ['#9b9184', '#857b6f', '#ab9f8d', '#77706a'],
  shiplap: ['#f3f1ec'],
};

/** Reasonable unit sizes (inches) when a spec's are missing or invalid. */
const DEFAULT_UNIT: Record<TexturePattern, [number, number]> = {
  'wood-planks': [7.5, 72],
  herringbone: [3, 15],
  chevron: [3, 15],
  'tile-grid': [12, 12],
  subway: [6, 3],
  'hex-tile': [4, 4],
  brick: [7.625, 2.25],
  'stone-pavers': [12, 12],
  flagstone: [20, 20],
  cobblestone: [4, 4],
  gravel: [0.375, 0.375],
  mulch: [1.5, 1.5],
  grass: [2, 2],
  concrete: [48, 48],
  stucco: [12, 12],
  'lap-siding': [144, 7],
  'board-batten': [12, 96],
  'shingle-siding': [6, 7],
  'roof-shingles': [12, 5.625],
  'standing-seam': [16, 120],
  'deck-boards': [5.5, 144],
  carpet: [0.25, 0.25],
  marble: [24, 24],
  terrazzo: [0.5, 0.5],
  'stone-veneer': [12, 3],
  shiplap: [96, 7.25],
};

function finitePos(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function normalizeSpec(spec: TextureSpec): NormSpec {
  const pattern = (spec?.pattern && spec.pattern in DEFAULT_COLORS ? spec.pattern : 'concrete') as TexturePattern;
  const palette: Vec3[] = [];
  for (const c of Array.isArray(spec?.colors) ? spec.colors : []) {
    const v = typeof c === 'string' ? hexToLinear(c) : null;
    if (v) palette.push(v);
  }
  if (palette.length === 0) for (const c of DEFAULT_COLORS[pattern]) palette.push(hexToLinear(c)!);
  const [dw, dh] = DEFAULT_UNIT[pattern];
  const uw = clamp(finitePos(spec?.unitWidthIn) ?? dw, 0.05, 1200);
  const uh = clamp(finitePos(spec?.unitHeightIn) ?? dh, 0.05, 1200);
  let joint: NormSpec['joint'] = null;
  if (spec?.joint && typeof spec.joint === 'object') {
    const color = typeof spec.joint.color === 'string' ? hexToLinear(spec.joint.color) : null;
    const width = typeof spec.joint.widthIn === 'number' && Number.isFinite(spec.joint.widthIn) ? spec.joint.widthIn : null;
    if (color && width !== null && width >= 0) joint = { color, widthIn: Math.min(width, 6) };
  }
  const variation = typeof spec?.variation === 'number' && Number.isFinite(spec.variation) ? clamp(spec.variation, 0, 1) : 0.4;
  return { pattern, palette, uw, uh, joint, variation, seed: seedToUint32(spec?.seed ?? 0) };
}

/** Linear-RGB average of the palette. */
export function paletteMean(p: Vec3[]): Vec3 {
  const m: Vec3 = [0, 0, 0];
  for (const c of p) {
    m[0] += c[0] / p.length;
    m[1] += c[1] / p.length;
    m[2] += c[2] / p.length;
  }
  return m;
}

export interface ToneOptions {
  /** Std-dev of log-lightness jitter at variation = 1. Default 0.22. */
  light?: number;
  /** Std-dev of per-channel (hue) jitter at variation = 1. Default 0.05. */
  hue?: number;
  /** Max blend toward a second palette color at variation = 1. Default 0.45. */
  blend?: number;
}

/**
 * A per-element color: a palette entry, partly blended toward another entry
 * and jittered in lightness and hue — scaled by the spec's variation, with a
 * small floor so even variation 0 is not perfectly flat (real materials never are).
 */
export function pickTone(rng: Rng, spec: NormSpec, opts: ToneOptions = {}): Vec3 {
  const pal = spec.palette;
  const v = 0.12 + 0.88 * spec.variation;
  let c = pal[rng.int(pal.length)];
  if (pal.length > 1) c = mix3(c, pal[rng.int(pal.length)], rng.next() * (opts.blend ?? 0.45) * v);
  const l = Math.exp(rng.normal() * (opts.light ?? 0.22) * v);
  // Hue jitter scaled by saturation, so whites and grays don't pick up tints.
  const mx = Math.max(c[0], c[1], c[2]);
  const sat = mx > 1e-6 ? (mx - Math.min(c[0], c[1], c[2])) / mx : 0;
  const hs = (opts.hue ?? 0.05) * v * (0.2 + 0.8 * sat);
  return [
    c[0] * l * Math.exp(rng.normal() * hs),
    c[1] * l * Math.exp(rng.normal() * hs),
    c[2] * l * Math.exp(rng.normal() * hs),
  ];
}

/**
 * A blended per-element tone for materials whose palette describes a mix
 * (granule blends, weathered cedar): the palette mean pulled part-way
 * (`pull`) toward one random entry, with lightness jitter.
 */
export function blendTone(rng: Rng, spec: NormSpec, pull: number, light: number): Vec3 {
  const m = paletteMean(spec.palette);
  const c = spec.palette[rng.int(spec.palette.length)];
  const v = 0.12 + 0.88 * spec.variation;
  const t = pull * (0.4 + 0.6 * rng.next()) * v;
  const l = Math.exp(rng.normal() * light * v);
  return [(m[0] + (c[0] - m[0]) * t) * l, (m[1] + (c[1] - m[1]) * t) * l, (m[2] + (c[2] - m[2]) * t) * l];
}

/** Root RNG for a spec, separated per purpose by `tag`. */
export function specRng(spec: NormSpec, tag: number): Rng {
  return new Rng(spec.seed).fork(tag);
}

/** Joint color: the spec's joint, else `fallback`. */
export function jointColor(spec: NormSpec, fallback: Vec3): Vec3 {
  return spec.joint ? spec.joint.color : fallback;
}

/** Joint width (inches): the spec's joint, else `fallback`. */
export function jointWidth(spec: NormSpec, fallback: number): number {
  return spec.joint ? spec.joint.widthIn : fallback;
}
