/**
 * Helpers for option visuals (the swatches the Design panel shows so options
 * can be compared at a glance): procedural texture specs with realistic unit
 * sizes, color swatches, diagrams and vector art — plus conversion of AI
 * option drafts into visuals.
 */
import type { OptionVisualDraft } from '../../../shared/api';
import type { DecorArt, DecorForm, FixtureArt, FixtureForm, PlantArt, PlantForm } from '../../../shared/art';
import { TEXTURE_PATTERNS, type OptionVisual, type TexturePattern, type TextureSpec } from '../../../shared/types';
import type { DiagramId } from './diagrams';

/** FNV-1a 32-bit hash, used for stable texture seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/** '#ABC' / 'abc' / '#aabbcc' → '#aabbcc'; anything else → undefined. */
export function normalizeHex(input: string | null | undefined): string | undefined {
  if (typeof input !== 'string') return undefined;
  const s = input.trim();
  const six = HEX6.exec(s);
  if (six) return `#${six[1].toLowerCase()}`;
  const three = HEX3.exec(s);
  if (three) return `#${three[1]}${three[1]}${three[2]}${three[2]}${three[3]}${three[3]}`.toLowerCase();
  return undefined;
}

export function isHex(s: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(s);
}

interface PatternDefaults {
  /** Typical repeat unit, inches (width = across the swatch, height = down). */
  unitWidthIn: number;
  unitHeightIn: number;
  /** Joint / grout / gap; omitted for continuous materials (gravel, grass, concrete…). */
  joint?: { color: string; widthIn: number };
  variation: number;
  /** Neutral, believable default palette. */
  colors: string[];
}

const OAK = ['#c29a6b', '#b48c5f', '#cda77a', '#a88257'];

/**
 * Realistic defaults per pattern: used when an AI draft omits sizes or colors
 * and as the base for the built-in option textures.
 */
export const PATTERN_DEFAULTS: Record<TexturePattern, PatternDefaults> = {
  'wood-planks': { unitWidthIn: 7, unitHeightIn: 60, joint: { color: '#4a3826', widthIn: 0.04 }, variation: 0.45, colors: OAK },
  herringbone: { unitWidthIn: 3, unitHeightIn: 18, joint: { color: '#4a3826', widthIn: 0.04 }, variation: 0.4, colors: OAK },
  chevron: { unitWidthIn: 3, unitHeightIn: 18, joint: { color: '#4a3826', widthIn: 0.04 }, variation: 0.4, colors: OAK },
  'tile-grid': { unitWidthIn: 12, unitHeightIn: 12, joint: { color: '#cfcbc4', widthIn: 0.125 }, variation: 0.12, colors: ['#e4e0d8', '#ddd8cf', '#e9e5de'] },
  subway: { unitWidthIn: 6, unitHeightIn: 3, joint: { color: '#d6d2ca', widthIn: 0.0625 }, variation: 0.12, colors: ['#f4f3ef', '#edebe6', '#f8f7f4'] },
  'hex-tile': { unitWidthIn: 4, unitHeightIn: 4, joint: { color: '#d3cfc8', widthIn: 0.0625 }, variation: 0.15, colors: ['#eeece8', '#e3e0da', '#f4f2ee'] },
  brick: { unitWidthIn: 7.625, unitHeightIn: 2.25, joint: { color: '#b9b2a5', widthIn: 0.375 }, variation: 0.4, colors: ['#8e4632', '#9c5038', '#7f3e2d', '#a35b42'] },
  'stone-pavers': { unitWidthIn: 16, unitHeightIn: 16, joint: { color: '#8e897f', widthIn: 0.375 }, variation: 0.35, colors: ['#a19c92', '#aea99f', '#948f86', '#b7b2a8'] },
  flagstone: { unitWidthIn: 20, unitHeightIn: 18, joint: { color: '#6f6a60', widthIn: 1 }, variation: 0.5, colors: ['#8a8f94', '#7c8288', '#969a9c', '#85807a'] },
  cobblestone: { unitWidthIn: 4, unitHeightIn: 4, joint: { color: '#6e685e', widthIn: 0.5 }, variation: 0.45, colors: ['#7d7a75', '#8a8781', '#6f6c67', '#94918b'] },
  gravel: { unitWidthIn: 0.5, unitHeightIn: 0.5, variation: 0.6, colors: ['#a8a196', '#bdb6aa', '#8f887d', '#c7c0b4'] },
  mulch: { unitWidthIn: 1.5, unitHeightIn: 0.75, variation: 0.5, colors: ['#4a3527', '#3b2a20', '#5a4130', '#2e2119'] },
  grass: { unitWidthIn: 1, unitHeightIn: 4, variation: 0.45, colors: ['#4e7a32', '#5c8a3a', '#6b9842', '#456e2c'] },
  concrete: { unitWidthIn: 48, unitHeightIn: 48, variation: 0.2, colors: ['#b9b4aa', '#c3beb4', '#afaaa0'] },
  stucco: { unitWidthIn: 6, unitHeightIn: 6, variation: 0.25, colors: ['#e6dfd3', '#ddd5c8', '#ebe5da'] },
  'lap-siding': { unitWidthIn: 96, unitHeightIn: 7, variation: 0.15, colors: ['#c9c3b6', '#c3bdb0', '#cfc9bc'] },
  'board-batten': { unitWidthIn: 12, unitHeightIn: 96, variation: 0.12, colors: ['#c9c3b6', '#c3bdb0', '#cfc9bc'] },
  'shingle-siding': { unitWidthIn: 6, unitHeightIn: 7, variation: 0.35, colors: ['#9a8a74', '#8c7b67', '#a69680', '#7f705d'] },
  'roof-shingles': { unitWidthIn: 12, unitHeightIn: 5.625, joint: { color: '#1f2021', widthIn: 0.25 }, variation: 0.3, colors: ['#3a3b3d', '#444547', '#333436', '#4c4d4f'] },
  'standing-seam': { unitWidthIn: 16, unitHeightIn: 120, variation: 0.08, colors: ['#2f3133', '#36383a', '#2b2d2f'] },
  'deck-boards': { unitWidthIn: 5.5, unitHeightIn: 96, joint: { color: '#2a2420', widthIn: 0.1875 }, variation: 0.4, colors: ['#8a6a4e', '#7e5f45', '#96755a', '#735740'] },
  carpet: { unitWidthIn: 1, unitHeightIn: 1, variation: 0.15, colors: ['#cfc6b6', '#c8bfaf', '#d6cdbd'] },
  marble: { unitWidthIn: 24, unitHeightIn: 24, variation: 0.3, colors: ['#f2f0ec', '#e3dfd8', '#b8b3aa'] },
  terrazzo: { unitWidthIn: 1, unitHeightIn: 1, variation: 0.5, colors: ['#ede9e2', '#b9b2a6', '#8e8779', '#c47a5a'] },
  'stone-veneer': { unitWidthIn: 12, unitHeightIn: 6, joint: { color: '#4e4a44', widthIn: 0.25 }, variation: 0.45, colors: ['#8a8176', '#9a9083', '#6f685f', '#a99e8f'] },
  shiplap: { unitWidthIn: 96, unitHeightIn: 6, joint: { color: '#5a554e', widthIn: 0.125 }, variation: 0.08, colors: ['#f2f0ea', '#eeebe4', '#f5f3ee'] },
};

export interface TexOptions {
  /** Joint override; `null` = no joint; omitted = the pattern default. */
  joint?: { color: string; widthIn: number } | null;
  variation?: number;
  seed?: number;
}

/** A texture visual with a deterministic seed derived from its parameters. */
export function tex(pattern: TexturePattern, colors: string[], unitWidthIn: number, unitHeightIn: number, opts: TexOptions = {}): OptionVisual {
  const d = PATTERN_DEFAULTS[pattern];
  const joint = opts.joint === null ? undefined : (opts.joint ?? d.joint);
  const texture: TextureSpec = {
    pattern,
    colors: colors.map((c) => normalizeHex(c) ?? c),
    unitWidthIn,
    unitHeightIn,
    variation: opts.variation ?? d.variation,
    seed: opts.seed ?? hashString(`${pattern}|${colors.join(',')}|${unitWidthIn}x${unitHeightIn}`) % 100000,
  };
  if (joint) texture.joint = { color: normalizeHex(joint.color) ?? joint.color, widthIn: joint.widthIn };
  return { kind: 'texture', texture };
}

export function color(hex: string): OptionVisual {
  return { kind: 'color', hex: normalizeHex(hex) ?? hex };
}

export function colors(...hexes: string[]): OptionVisual {
  return { kind: 'colors', hexes: hexes.map((h) => normalizeHex(h) ?? h) };
}

export function diagram(id: DiagramId): OptionVisual {
  return { kind: 'diagram', diagram: id };
}

export function plantArt(form: PlantForm, foliage: string, extra: Omit<PlantArt, 'kind' | 'form' | 'foliage' | 'seed'> & { seed?: number } = {}): OptionVisual {
  const { seed, ...rest } = extra;
  const art: PlantArt = { kind: 'plant', form, foliage, ...rest, seed: seed ?? hashString(`${form}|${foliage}`) % 1000 };
  return { kind: 'art', art };
}

export function fixtureArt(form: FixtureForm, finish: string, shade?: string): OptionVisual {
  const art: FixtureArt = shade ? { kind: 'fixture', form, finish, shade } : { kind: 'fixture', form, finish };
  return { kind: 'art', art };
}

export function decorArt(form: DecorForm, primary: string, secondary?: string): OptionVisual {
  const art: DecorArt = secondary ? { kind: 'decor', form, color: primary, color2: secondary } : { kind: 'decor', form, color: primary };
  return { kind: 'art', art };
}

/** Unit sizes outside this range (inches) are treated as nonsense from the AI. */
const MIN_UNIT_IN = 0.1;
const MAX_UNIT_IN = 240;

function saneUnit(v: number | null | undefined): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  return Math.min(MAX_UNIT_IN, Math.max(MIN_UNIT_IN, v));
}

function isPattern(p: unknown): p is TexturePattern {
  return typeof p === 'string' && (TEXTURE_PATTERNS as readonly string[]).includes(p);
}

function colorVisual(hexes: string[]): OptionVisual | undefined {
  if (hexes.length === 0) return undefined;
  return hexes.length === 1 ? { kind: 'color', hex: hexes[0] } : { kind: 'colors', hexes };
}

/**
 * Converts an AI option visual into an OptionVisual. Textures get realistic
 * defaults for missing / implausible unit sizes (keeping the pattern's aspect
 * when only one side is given), a pattern-appropriate joint and a stable seed.
 * Invalid colors are dropped; a texture without a valid pattern degrades to a
 * color swatch. Returns undefined when there is nothing to show.
 */
export function visualFromDraft(v: OptionVisualDraft | null | undefined): OptionVisual | undefined {
  if (!v || v.kind === 'none') return undefined;
  const hexes = (v.colors ?? []).map((c) => normalizeHex(c)).filter((c): c is string => !!c).slice(0, 6);
  if (v.kind === 'color' || !isPattern(v.pattern)) return colorVisual(hexes);

  const pattern = v.pattern;
  const d = PATTERN_DEFAULTS[pattern];
  const aspect = d.unitHeightIn / d.unitWidthIn;
  let w = saneUnit(v.unitWidthIn);
  let h = saneUnit(v.unitHeightIn);
  if (w === undefined && h === undefined) {
    w = d.unitWidthIn;
    h = d.unitHeightIn;
  } else if (w === undefined) {
    w = saneUnit((h as number) / aspect) ?? d.unitWidthIn;
  } else if (h === undefined) {
    h = saneUnit(w * aspect) ?? d.unitHeightIn;
  }
  const texture: TextureSpec = {
    pattern,
    colors: hexes.length > 0 ? hexes : [...d.colors],
    unitWidthIn: w as number,
    unitHeightIn: h as number,
    variation: d.variation,
    seed: hashString(JSON.stringify(v)) % 100000,
  };
  if (d.joint) texture.joint = { ...d.joint };
  return { kind: 'texture', texture };
}
