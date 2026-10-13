/**
 * Paint-picking logic for the Paint panel: collections, filtering, colors
 * already used in the project and building PaintTreatments. Pure — the
 * catalog is passed in — so it is unit-tested without the catalog module.
 */
import type {
  ColorFamily,
  PaintColor,
  PaintFinish,
  PaintTreatment,
  Project,
  SurfaceKind,
  Treatment,
} from '../../../../shared/types';
import { normalizeHex } from '../../../engine/color';
import { defaultFinishFor } from './surfaceKinds';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const FINISH_LABELS: Record<PaintFinish, string> = {
  flat: 'Flat',
  matte: 'Matte',
  eggshell: 'Eggshell',
  satin: 'Satin',
  'semi-gloss': 'Semi-gloss',
  gloss: 'Gloss',
};

/** Compact labels for the finish segmented control (fits a 360 px phone). */
export const FINISH_SHORT: Record<PaintFinish, string> = {
  flat: 'Flat',
  matte: 'Matte',
  eggshell: 'Egg',
  satin: 'Satin',
  'semi-gloss': 'Semi',
  gloss: 'Gloss',
};

export const FINISH_HINTS: Record<PaintFinish, string> = {
  flat: 'No sheen — hides wall flaws best; ideal for ceilings, less washable.',
  matte: 'A hint of sheen — rich, velvety color that cleans up better than flat.',
  eggshell: 'Soft low sheen — wipeable and forgiving; the go-to for living spaces.',
  satin: 'Pearl-like glow — durable for busy rooms, siding and exterior trim.',
  'semi-gloss': 'Noticeable shine — tough and scrubbable for trim, doors and cabinets.',
  gloss: 'High shine — a lacquered look for front doors and statement pieces.',
};

export const FAMILY_LABELS: Record<ColorFamily, string> = {
  white: 'Whites',
  neutral: 'Neutrals',
  gray: 'Grays',
  black: 'Blacks',
  beige: 'Beiges',
  brown: 'Browns',
  red: 'Reds',
  orange: 'Oranges',
  yellow: 'Yellows',
  green: 'Greens',
  blue: 'Blues',
  purple: 'Purples',
  pink: 'Pinks',
};

/** Representative chip colors for the family filter (data colors, not theme). */
export const FAMILY_SWATCH: Record<ColorFamily, string> = {
  white: '#f3f0e8',
  neutral: '#cfc6b6',
  gray: '#9b9d9c',
  black: '#2c2c2e',
  beige: '#d8c3a0',
  brown: '#7b5a3e',
  red: '#a93a32',
  orange: '#d9813a',
  yellow: '#e2c25a',
  green: '#5f8560',
  blue: '#46698f',
  purple: '#76598c',
  pink: '#dca3b2',
};

/** Paint-industry wording for a Light Reflectance Value (0..100). */
export function lrvLabel(lrv: number): string {
  if (lrv >= 75) return 'Very light';
  if (lrv >= 55) return 'Light';
  if (lrv >= 35) return 'Mid-tone';
  if (lrv >= 15) return 'Deep';
  return 'Very dark';
}

/** What an LRV means for a room, one short sentence. */
export function lrvHint(lrv: number): string {
  if (lrv >= 75) return 'Bounces lots of light — brightens small or dim spaces.';
  if (lrv >= 55) return 'Reads light and airy without going stark.';
  if (lrv >= 35) return 'Balanced — noticeable color that still reflects some light.';
  if (lrv >= 15) return 'Absorbs light — cozy and dramatic; best with good lighting.';
  return 'Very little light reflected — moody, enveloping; great on doors and accents.';
}

// ---------------------------------------------------------------------------
// Collections & filtering
// ---------------------------------------------------------------------------

/** Collections in catalog order with their color counts. */
export function paintCollections(paints: readonly PaintColor[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of paints) counts.set(p.collection, (counts.get(p.collection) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}

/** Families present in the catalog, in COLOR_FAMILIES order. */
export function paintFamilies(paints: readonly PaintColor[], order: readonly ColorFamily[]): ColorFamily[] {
  const present = new Set(paints.map((p) => p.family));
  return order.filter((f) => present.has(f));
}

export interface PaintFilter {
  /** null = every collection. */
  collection: string | null;
  /** null = every family. */
  family: ColorFamily | null;
  query: string;
}

/** Built-in fallback search: name, collection, tags, family and hex. Name-prefix matches rank first. */
export function localPaintSearch(paints: readonly PaintColor[], query: string, family?: ColorFamily): PaintColor[] {
  const q = query.trim().toLowerCase();
  const hexQ = q.replace(/^#/, '');
  const scored: { p: PaintColor; score: number; i: number }[] = [];
  paints.forEach((p, i) => {
    if (family && p.family !== family) return;
    if (!q) {
      scored.push({ p, score: 0, i });
      return;
    }
    const name = p.name.toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 3;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 1.5;
    else if (
      p.collection.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)) ||
      p.family === q ||
      (hexQ.length >= 3 && p.hex.toLowerCase().includes(hexQ))
    ) {
      score = 1;
    }
    if (score > 0) scored.push({ p, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.p);
}

/**
 * Applies collection, family and text filters. `search` (the catalog's
 * searchPaints) is used for non-empty queries when given.
 */
export function filterPaints(
  paints: readonly PaintColor[],
  filter: PaintFilter,
  search?: (query: string, family?: ColorFamily) => PaintColor[],
): PaintColor[] {
  const q = filter.query.trim();
  const family = filter.family ?? undefined;
  let list: PaintColor[];
  if (q) list = search ? search(q, family) : localPaintSearch(paints, q, family);
  else list = family ? paints.filter((p) => p.family === family) : [...paints];
  if (filter.collection) list = list.filter((p) => p.collection === filter.collection);
  return list;
}

/** Groups paints by collection, keeping the input order (fan-deck sections). */
export function groupByCollection(paints: readonly PaintColor[]): { collection: string; paints: PaintColor[] }[] {
  const groups = new Map<string, PaintColor[]>();
  for (const p of paints) {
    const g = groups.get(p.collection);
    if (g) g.push(p);
    else groups.set(p.collection, [p]);
  }
  return [...groups].map(([collection, list]) => ({ collection, paints: list }));
}

// ---------------------------------------------------------------------------
// Colors used in the project
// ---------------------------------------------------------------------------

export interface UsedColor {
  /** Stable key (catalog id or normalized hex + name). */
  key: string;
  hex: string;
  name?: string;
  paintId?: string;
  brand?: string;
  code?: string;
  /** Number of surfaces (across every photo and design option) using it. */
  uses: number;
}

/** Unique paint colors applied anywhere in the project, most used first. */
export function usedPaintColors(project: Pick<Project, 'spaces'> | null | undefined): UsedColor[] {
  if (!project) return [];
  const map = new Map<string, UsedColor>();
  let order = 0;
  const firstSeen = new Map<string, number>();
  for (const space of project.spaces) {
    for (const photo of space.photos) {
      for (const design of photo.designs) {
        for (const t of Object.values(design.treatments)) {
          if (t.type !== 'paint') continue;
          const hex = normalizeHex(t.hex);
          if (!hex) continue;
          const key = t.paintId ? `id:${t.paintId}` : `hex:${hex}|${(t.colorName ?? '').trim().toLowerCase()}`;
          const prev = map.get(key);
          if (prev) prev.uses += 1;
          else {
            map.set(key, {
              key,
              hex,
              name: t.colorName?.trim() || undefined,
              paintId: t.paintId,
              brand: t.brand?.trim() || undefined,
              code: t.code?.trim() || undefined,
              uses: 1,
            });
            firstSeen.set(key, order++);
          }
        }
      }
    }
  }
  return [...map.values()].sort((a, b) => b.uses - a.uses || firstSeen.get(a.key)! - firstSeen.get(b.key)!);
}

// ---------------------------------------------------------------------------
// Treatments
// ---------------------------------------------------------------------------

/** Settings kept when the color changes: finish, coats, strength of the current paint (else defaults for the surface). */
function paintBase(prev: Treatment | undefined, surface: SurfaceKind): Pick<PaintTreatment, 'finish' | 'coats' | 'strength'> {
  if (prev?.type === 'paint') return { finish: prev.finish, coats: prev.coats, strength: prev.strength };
  return { finish: defaultFinishFor(surface), coats: 2, strength: 1 };
}

/** Paint treatment for a catalog color. */
export function paintFromCatalog(paint: PaintColor, prev: Treatment | undefined, surface: SurfaceKind): PaintTreatment {
  return {
    type: 'paint',
    hex: normalizeHex(paint.hex) ?? paint.hex,
    colorName: paint.name,
    paintId: paint.id,
    ...paintBase(prev, surface),
  };
}

export interface CustomColor {
  hex: string;
  name?: string;
  brand?: string;
  code?: string;
}

/** Paint treatment for a custom / picked / previously used color. Returns null for an invalid hex. */
export function paintFromCustom(color: CustomColor & { paintId?: string }, prev: Treatment | undefined, surface: SurfaceKind): PaintTreatment | null {
  const hex = normalizeHex(color.hex);
  if (!hex) return null;
  const t: PaintTreatment = { type: 'paint', hex, ...paintBase(prev, surface) };
  const name = color.name?.trim();
  const brand = color.brand?.trim();
  const code = color.code?.trim();
  if (name) t.colorName = name;
  if (color.paintId) t.paintId = color.paintId;
  if (brand) t.brand = brand;
  if (code) t.code = code;
  return t;
}

/** Display name of a paint treatment. */
export function paintDisplayName(t: Pick<PaintTreatment, 'colorName' | 'hex'>): string {
  return t.colorName?.trim() || 'Custom color';
}

/** Whether a treatment shows this color (catalog id match, else same hex). */
export function isSamePaint(t: Treatment | undefined, color: { hex: string; paintId?: string }): boolean {
  if (!t || t.type !== 'paint') return false;
  if (color.paintId || t.paintId) return t.paintId === color.paintId;
  return normalizeHex(t.hex) === normalizeHex(color.hex);
}

/** "#C9B79C" display form. */
export function displayHex(hex: string): string {
  return (normalizeHex(hex) ?? hex).toUpperCase();
}

/** Wording for a ΔE2000 distance between two colors. */
export function deltaELabel(deltaE: number): string {
  if (deltaE < 1) return 'Identical';
  if (deltaE < 2.5) return 'Nearly identical';
  if (deltaE < 5) return 'Very close';
  if (deltaE < 10) return 'Close';
  return 'Similar';
}
