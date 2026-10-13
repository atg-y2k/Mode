/**
 * Built-in catalog: paint colors, materials (textures), plants, light fixtures
 * and decor — plus lookup and search. Pure data + functions (also imported by
 * the server to give Claude the catalog ids), so this module must stay free of
 * DOM APIs.
 *
 * Data lives in sibling files: paints.ts, materials.ts, plants.ts, fixtures.ts, decor.ts.
 */
import type {
  AssetCategory,
  AssetDef,
  ColorFamily,
  CostEstimate,
  MaterialCategory,
  MaterialDef,
  PaintColor,
  PlantInfo,
  PlantType,
  SunExposure,
  SurfaceKind,
  WaterNeed,
} from '../../../shared/types';
import { deltaE, hexToLab, normalizeHex } from '../../engine/color';
import type { Lab } from '../../engine/types';
import { DECOR } from './decor';
import { FIXTURES } from './fixtures';
import { MATERIALS } from './materials';
import { PAINT_COLORS } from './paints';
import { PLANTS } from './plants';

export { PAINT_COLORS, PAINT_COLLECTIONS } from './paints';
export { MATERIALS } from './materials';
export { PLANTS } from './plants';
export { FIXTURES } from './fixtures';
export { DECOR } from './decor';

/** PLANTS + FIXTURES + DECOR */
export const BUILTIN_ASSETS: AssetDef[] = [...PLANTS, ...FIXTURES, ...DECOR];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const PAINT_BY_ID = new Map(PAINT_COLORS.map((p) => [p.id, p]));
const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));
const ASSET_BY_ID = new Map(BUILTIN_ASSETS.map((a) => [a.id, a]));

export function getPaint(id: string): PaintColor | undefined {
  return PAINT_BY_ID.get(id);
}

export function getMaterial(id: string): MaterialDef | undefined {
  return MATERIAL_BY_ID.get(id);
}

export function getBuiltinAsset(id: string): AssetDef | undefined {
  return ASSET_BY_ID.get(id);
}

/** Built-in first, then the user's library. */
export function findAsset(id: string, library: readonly AssetDef[]): AssetDef | undefined {
  return ASSET_BY_ID.get(id) ?? library.find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Text matching helpers
// ---------------------------------------------------------------------------

/** Lowercase, accents and apostrophes removed, everything else non-alphanumeric → single spaces. */
function norm(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘"“”]/g, '')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();
}

/** `needle` starts `hay` or starts one of its words. */
function wordPrefix(hay: string, needle: string): boolean {
  return hay.startsWith(needle) || hay.includes(' ' + needle);
}

/** The token plus naive singular forms ("ferns" → "fern", "grasses" → "grass"). */
function variants(token: string): string[] {
  const out = [token];
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) out.push(token.slice(0, -1));
  if (token.length > 4 && token.endsWith('es')) out.push(token.slice(0, -2));
  return out;
}

/** Substring (mid-word) matches only count for tokens this long — "red" must not match "louvered". */
const MIN_INFIX = 4;

/** Best score of a token against one field: word-prefix beats substring. */
function fieldScore(field: string, token: string, prefixScore: number, containsScore: number): number {
  if (!field) return 0;
  let best = 0;
  for (const v of variants(token)) {
    if (wordPrefix(field, v)) return prefixScore;
    if (containsScore > 0 && v.length >= MIN_INFIX && field.includes(v)) best = containsScore;
  }
  return best;
}

/** Best score of a token against a list of short fields (tags, keywords). */
function listScore(list: readonly string[], token: string, exact: number, prefix: number, contains: number): number {
  let best = 0;
  for (const item of list) {
    for (const v of variants(token)) {
      if (item === v) return exact;
      if (wordPrefix(item, v)) best = Math.max(best, prefix);
      else if (contains > 0 && v.length >= MIN_INFIX && item.includes(v)) best = Math.max(best, contains);
    }
  }
  return best;
}

function tokens(q: string): string[] {
  return q.split(' ').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Asset search
// ---------------------------------------------------------------------------

export interface AssetFilters {
  category?: AssetCategory;
  subcategory?: string;
  plantType?: PlantType;
  sun?: SunExposure;
  water?: WaterNeed;
  /** USDA zone number; keeps plants whose range includes it (and non-plants). */
  zone?: number;
  /** 'indoor' keeps houseplants / indoor fixtures; 'outdoor' the opposite. */
  setting?: 'indoor' | 'outdoor';
  source?: AssetDef['source'];
}

const SUN_WORDS: Record<SunExposure, string> = { 'full-sun': 'full sun', 'part-sun': 'part sun', shade: 'shade' };
const INDOOR_LIGHT_WORDS: Record<SunExposure, string> = {
  'full-sun': 'bright light',
  'part-sun': 'bright indirect light',
  shade: 'low light',
};

/** Normalized searchable fields of an asset (cached; assets are treated as immutable). */
interface AssetIndex {
  name: string;
  botanical: string;
  subcategory: string;
  tags: string[];
  /** Derived facts: category, plant type, light, water, flags, bloom, native range, beam… */
  keywords: string[];
  description: string;
}

const assetIndexCache = new WeakMap<AssetDef, AssetIndex>();

function plantKeywords(p: PlantInfo): string[] {
  const k: string[] = [p.type];
  for (const s of p.sun) k.push(p.indoor ? INDOOR_LIGHT_WORDS[s] : SUN_WORDS[s]);
  k.push(`${p.water} water`);
  if (p.water === 'low') k.push('drought tolerant');
  if (p.evergreen) k.push('evergreen');
  else if (!p.indoor) k.push('deciduous');
  if (p.deerResistant) k.push('deer resistant');
  if (p.native) k.push(`native ${p.native}`);
  if (p.bloom) k.push(`bloom ${p.bloom}`, 'flowering');
  k.push(p.indoor ? 'indoor houseplant' : 'outdoor');
  return k;
}

function assetIndex(a: AssetDef): AssetIndex {
  let idx = assetIndexCache.get(a);
  if (idx) return idx;
  const keywords: string[] = [a.category];
  if (a.category === 'lighting') keywords.push('light', 'fixture');
  if (a.plant) keywords.push(...plantKeywords(a.plant));
  if (a.light) {
    keywords.push(`${a.light.beam} light`, `${a.light.kelvin}k`);
    if (a.light.indoor) keywords.push('indoor');
    if (a.light.outdoor) keywords.push('outdoor');
  }
  if (a.product) keywords.push(a.product.store, a.product.brand ?? '');
  idx = {
    name: norm(a.name),
    botanical: norm(a.plant?.botanical),
    subcategory: norm(a.subcategory),
    tags: a.tags.map(norm).filter(Boolean),
    keywords: keywords.map(norm).filter(Boolean),
    description: norm(a.description),
  };
  assetIndexCache.set(a, idx);
  return idx;
}

/** 0 = no match. Whole-query matches on the name dominate, then per-token evidence. */
function scoreAsset(a: AssetDef, q: string, toks: string[]): number {
  const ix = assetIndex(a);
  let score = 0;
  if (ix.name === q) score += 1000;
  else if (ix.name.startsWith(q)) score += 800;
  else if (wordPrefix(ix.name, q)) score += 600;
  else if (ix.name.includes(q)) score += 400;
  else if (ix.botanical && wordPrefix(ix.botanical, q)) score += 350;
  else if (ix.botanical.includes(q)) score += 300;
  else if (toks.length > 1 && (ix.tags.includes(q) || ix.subcategory === q)) score += 200;

  for (const t of toks) {
    const s = Math.max(
      fieldScore(ix.name, t, 60, 40),
      fieldScore(ix.botanical, t, 35, 0),
      listScore(ix.tags, t, 30, 25, 12),
      fieldScore(ix.subcategory, t, 25, 12),
      listScore(ix.keywords, t, 18, 15, 0),
      fieldScore(ix.description, t, 8, 0),
    );
    if (s === 0) return 0; // every word of the query must match somewhere
    score += s;
  }
  return score;
}

/** USDA zone fit; plants without a zone range (houseplants) are not zone-limited. */
function zoneFits(p: PlantInfo, zone: number): boolean {
  const z = Math.floor(zone);
  if (p.zoneMin !== undefined && z < p.zoneMin) return false;
  if (p.zoneMax !== undefined && z > p.zoneMax) return false;
  return true;
}

/**
 * Indoor / outdoor scope: plants by `plant.indoor`, fixtures by their light
 * ratings, other objects by an 'indoor' / 'outdoor' tag when they carry one
 * (objects without any of that information fit both).
 */
function fitsSetting(a: AssetDef, setting: 'indoor' | 'outdoor'): boolean {
  if (a.plant) return setting === 'indoor' ? a.plant.indoor : !a.plant.indoor;
  if (a.light) return setting === 'indoor' ? a.light.indoor : a.light.outdoor;
  const hasIndoor = a.tags.includes('indoor');
  const hasOutdoor = a.tags.includes('outdoor');
  if (!hasIndoor && !hasOutdoor) return true;
  return setting === 'indoor' ? hasIndoor : hasOutdoor;
}

function passesFilters(a: AssetDef, f: AssetFilters): boolean {
  if (f.category && a.category !== f.category) return false;
  if (f.subcategory && a.subcategory !== f.subcategory) return false;
  if (f.source && a.source !== f.source) return false;
  // Plant facts only keep assets that have them.
  if (f.plantType && a.plant?.type !== f.plantType) return false;
  if (f.sun && !a.plant?.sun.includes(f.sun)) return false;
  if (f.water && a.plant?.water !== f.water) return false;
  if (f.zone !== undefined && Number.isFinite(f.zone) && a.plant && !zoneFits(a.plant, f.zone)) return false;
  if (f.setting && !fitsSetting(a, f.setting)) return false;
  return true;
}

/** Case-insensitive match on name, botanical name, tags, subcategory; ranked (name prefix first). */
export function searchAssets(all: readonly AssetDef[], query: string, filters?: AssetFilters): AssetDef[] {
  const pool = filters ? all.filter((a) => passesFilters(a, filters)) : [...all];
  const q = norm(query);
  if (!q) return pool;
  const toks = tokens(q);
  const scored: { a: AssetDef; s: number; i: number }[] = [];
  pool.forEach((a, i) => {
    const s = scoreAsset(a, q, toks);
    if (s > 0) scored.push({ a, s, i });
  });
  scored.sort((x, y) => y.s - x.s || x.i - y.i);
  return scored.map((x) => x.a);
}

// ---------------------------------------------------------------------------
// Paints
// ---------------------------------------------------------------------------

interface PaintIndex {
  name: string;
  collection: string;
  tags: string[];
}

const paintIndexCache = new WeakMap<PaintColor, PaintIndex>();

function paintIndex(p: PaintColor): PaintIndex {
  let idx = paintIndexCache.get(p);
  if (!idx) {
    idx = { name: norm(p.name), collection: norm(p.collection), tags: p.tags.map(norm).filter(Boolean) };
    paintIndexCache.set(p, idx);
  }
  return idx;
}

function scorePaint(p: PaintColor, q: string, toks: string[]): number {
  const ix = paintIndex(p);
  let score = 0;
  if (ix.name === q) score += 1000;
  else if (ix.name.startsWith(q)) score += 800;
  else if (wordPrefix(ix.name, q)) score += 600;
  else if (ix.name.includes(q)) score += 400;
  for (const t of toks) {
    const s = Math.max(
      fieldScore(ix.name, t, 60, 40),
      t.startsWith('#') && t.length > 1 && p.hex.startsWith(t) ? 50 : 0,
      listScore(ix.tags, t, 30, 25, 12),
      fieldScore(ix.collection, t, 25, 12),
      variants(t).includes(p.family) ? 25 : 0,
    );
    if (s === 0) return 0;
    score += s;
  }
  return score;
}

/**
 * A complete hex color typed as a query: '#a1b2c3', '#abc', or a bare
 * 'a1b2c3' with at least one digit (so words like "facade" stay text).
 */
function queryHex(query: string): string | null {
  const s = query.trim();
  const ok = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) || (/^[0-9a-f]{6}$/i.test(s) && /\d/.test(s));
  return ok ? normalizeHex(s) : null;
}

/**
 * Text search over name, tags, collection, family and hex prefix (name
 * matches first). A complete hex query ('#d8cfc0') returns the closest
 * catalog colors instead, nearest first.
 */
export function searchPaints(query: string, family?: ColorFamily): PaintColor[] {
  const inFamily = (p: PaintColor) => !family || p.family === family;
  const hex = queryHex(query);
  if (hex) {
    return nearestPaints(hex, PAINT_COLORS.length)
      .filter((r) => r.deltaE <= 20 && inFamily(r.paint))
      .slice(0, 24)
      .map((r) => r.paint);
  }
  const q = norm(query);
  const pool = PAINT_COLORS.filter(inFamily);
  if (!q) return pool;
  const toks = tokens(q);
  const scored: { p: PaintColor; s: number; i: number }[] = [];
  pool.forEach((p, i) => {
    const s = scorePaint(p, q, toks);
    if (s > 0) scored.push({ p, s, i });
  });
  scored.sort((x, y) => y.s - x.s || x.i - y.i);
  return scored.map((x) => x.p);
}

let paintLabs: Lab[] | null = null;

/** Closest catalog paints by ΔE2000. Invalid hex → []. */
export function nearestPaints(hex: string, n = 8): { paint: PaintColor; deltaE: number }[] {
  const h = normalizeHex(hex);
  if (!h || !(n > 0)) return [];
  paintLabs ??= PAINT_COLORS.map((p) => hexToLab(p.hex));
  const target = hexToLab(h);
  const labs = paintLabs;
  return PAINT_COLORS.map((paint, i) => ({ paint, deltaE: deltaE(target, labs[i]), i }))
    .sort((a, b) => a.deltaE - b.deltaE || a.i - b.i)
    .slice(0, Math.floor(n))
    .map(({ paint, deltaE: d }) => ({ paint, deltaE: d }));
}

// ---------------------------------------------------------------------------
// Materials by surface
// ---------------------------------------------------------------------------

/**
 * Material categories in order of how typical they are for each surface.
 * Surfaces missing here (trim, doors, cabinets, shutters…) are normally
 * painted; materials still offered for them come after these.
 */
const SURFACE_CATEGORIES: Partial<Record<SurfaceKind, readonly MaterialCategory[]>> = {
  floor: ['flooring', 'tile', 'countertop'],
  stair: ['flooring', 'decking', 'hardscape', 'tile'],
  wall: ['wall-finish', 'tile', 'siding'],
  'accent-wall': ['wall-finish', 'tile', 'siding', 'countertop'],
  ceiling: ['wall-finish'],
  backsplash: ['tile', 'countertop'],
  countertop: ['countertop'],
  siding: ['siding', 'roofing'],
  roof: ['roofing'],
  foundation: ['siding'],
  'garage-door': ['siding'],
  fence: ['siding', 'decking'],
  deck: ['decking', 'hardscape'],
  patio: ['hardscape', 'tile', 'decking'],
  path: ['hardscape', 'ground-cover', 'siding'],
  driveway: ['hardscape'],
  lawn: ['ground-cover', 'hardscape'],
  'planting-bed': ['ground-cover', 'hardscape'],
  'retaining-wall': ['siding', 'hardscape'],
};

const surfaceCache = new Map<SurfaceKind, MaterialDef[]>();

/**
 * Materials offered for a surface, most typical first: ranked by the
 * surface's preferred material categories, then by how primary the surface
 * is for the material (its position in `material.surfaces`), then catalog
 * order. 'other' offers every material.
 */
export function materialsForSurface(surface: SurfaceKind): MaterialDef[] {
  const hit = surfaceCache.get(surface);
  if (hit) return [...hit];
  let list: MaterialDef[];
  if (surface === 'other') list = [...MATERIALS];
  else {
    const cats = SURFACE_CATEGORIES[surface] ?? [];
    const catRank = (c: MaterialCategory) => {
      const i = cats.indexOf(c);
      return i === -1 ? cats.length : i;
    };
    list = MATERIALS.map((m, i) => ({ m, i, s: m.surfaces.indexOf(surface) }))
      .filter((x) => x.s !== -1)
      .sort((a, b) => catRank(a.m.category) - catRank(b.m.category) || a.s - b.s || a.i - b.i)
      .map((x) => x.m);
  }
  surfaceCache.set(surface, list);
  return [...list];
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/** "7a" -> 7, "10b" -> 10, invalid -> undefined. Also accepts "Zone 7b", "USDA zone 6", "8". */
export function parseZone(zone: string | undefined | null): number | undefined {
  if (typeof zone !== 'string') return undefined;
  const m = /^\s*(?:usda\s*)?(?:(?:hardiness\s*)?zone\s*)?(\d{1,2})\s*([ab])?\s*$/i.exec(zone);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 13 ? n : undefined;
}

// ---------------------------------------------------------------------------
// AI summary
// ---------------------------------------------------------------------------

/** Compact decimal: 7.5 → "7.5", 6 → "6", 0.3333 → "0.33". */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function costText(c: CostEstimate | undefined, per?: string): string {
  if (!c) return '';
  const range = c.low === c.high ? `$${num(c.low)}` : `$${num(c.low)}-${num(c.high)}`;
  const unit = per ?? (c.unit === 'each' ? '' : `/${c.unit}`);
  return range + unit;
}

const SUN_SHORT: Record<SunExposure, string> = { 'full-sun': 'full', 'part-sun': 'part', shade: 'shade' };
const LIGHT_SHORT: Record<SunExposure, string> = { 'full-sun': 'bright', 'part-sun': 'indirect', shade: 'low' };
const WATER_SHORT: Record<WaterNeed, string> = { low: 'low', medium: 'med', high: 'high' };

/** North American natives get a "native" flag (useful for native / pollinator themes). */
function nativeFlag(native: string | undefined): string | null {
  if (!native || /^hybrid/i.test(native)) return null;
  return /\b(US|Canada|Texas|Arizona|New Mexico|Mexico|Rocky Mountains|Americas?|Florida)\b/.test(native)
    ? `native: ${native}`
    : null;
}

function plantLine(a: AssetDef): string {
  const p = a.plant as PlantInfo;
  const parts = [`plant ${a.id}`, a.name, p.type];
  if (p.indoor) parts.push(`indoor light: ${p.sun.map((s) => LIGHT_SHORT[s]).join(',')}`);
  else parts.push(`sun: ${p.sun.map((s) => SUN_SHORT[s]).join(',')}`);
  parts.push(`water: ${WATER_SHORT[p.water]}`);
  if (p.zoneMin !== undefined || p.zoneMax !== undefined) {
    parts.push(p.type === 'annual' ? 'annual (all zones)' : `z${p.zoneMin ?? '?'}-${p.zoneMax ?? '?'}`);
  }
  parts.push(`${num(p.matureHeightFt)}x${num(p.matureWidthFt)}ft`);
  const flags: string[] = [];
  if (p.evergreen) flags.push('evergreen');
  if (p.deerResistant) flags.push('deer-resistant');
  const nat = p.indoor ? null : nativeFlag(p.native);
  if (nat) flags.push(nat);
  if (flags.length) parts.push(flags.join(', '));
  if (p.bloom) parts.push(`bloom: ${p.bloom}`);
  const cost = costText(a.cost);
  if (cost) parts.push(p.containerSize ? `${cost}/${p.containerSize}` : cost);
  return parts.join(' | ');
}

function materialLine(m: MaterialDef): string {
  const t = m.texture;
  return [
    `material ${m.id}`,
    m.name,
    m.category,
    m.surfaces.join(','),
    `${t.pattern} ${num(t.unitWidthIn)}x${num(t.unitHeightIn)}in`,
    costText(m.cost),
  ].join(' | ');
}

function fixtureLine(a: AssetDef): string {
  const l = a.light;
  const parts = [`fixture ${a.id}`, a.name, a.subcategory ?? 'light'];
  if (l) {
    parts.push(l.indoor && l.outdoor ? 'indoor+outdoor' : l.indoor ? 'indoor' : 'outdoor');
    parts.push(`${l.beam} ${l.kelvin}K ${l.lumens}lm reach ${num(l.reachFt)}ft`);
    if (l.mountHeightFt !== undefined && l.mountHeightFt > 0) parts.push(`mount ${num(l.mountHeightFt)}ft`);
  }
  const cost = costText(a.cost);
  if (cost) parts.push(cost);
  return parts.join(' | ');
}

function objectLine(a: AssetDef): string {
  const where = a.tags.includes('indoor') && a.tags.includes('outdoor') ? 'indoor+outdoor' : a.tags.includes('indoor') ? 'indoor' : a.tags.includes('outdoor') ? 'outdoor' : '';
  const parts = [`${a.category} ${a.id}`, a.name, a.subcategory ?? a.category];
  if (where) parts.push(where);
  parts.push(`${num(a.realHeightFt)}ft tall, ${num(a.realHeightFt * a.aspect)}ft wide`);
  const cost = costText(a.cost);
  if (cost) parts.push(cost);
  return parts.join(' | ');
}

let summaryCache: string | null = null;

/**
 * Compact plain-text listing of material, plant, fixture and decor ids with key
 * attributes, used in Claude prompts so suggestions reference real catalog ids.
 * Stable across calls (prompt caching).
 */
export function catalogSummaryForAI(): string {
  if (summaryCache !== null) return summaryCache;
  const lines: string[] = [
    'BUILT-IN CATALOG — reference items only by these exact ids. Format: kind id | name | facts | typical US retail cost.',
    '',
    `MATERIALS (${MATERIALS.length}) — category | surfaces | texture pattern & unit size | material cost per sqft (loose fill per cuyd)`,
    ...MATERIALS.map(materialLine),
    '',
    `PLANTS (${PLANTS.length}) — type | sun (houseplants: indoor light) | water | USDA zones | mature height x width | flags | bloom | cost/container`,
    ...PLANTS.map(plantLine),
    '',
    `LIGHT FIXTURES (${FIXTURES.length}) — kind | setting | beam, color temperature, lumens, reach | mounting height | cost`,
    ...FIXTURES.map(fixtureLine),
    '',
    `DECOR, FURNITURE & HARDSCAPE (${DECOR.length}) — kind | setting | real size | cost`,
    ...DECOR.map(objectLine),
  ];
  summaryCache = lines.join('\n');
  return summaryCache;
}
