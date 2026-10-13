/**
 * Material-picking logic for the Materials panel: grouping, search, building
 * MaterialTreatments and describing pattern sizes. Pure (catalog passed in).
 */
import type { MaterialCategory, MaterialDef, MaterialTreatment, TexturePattern, Treatment } from '../../../../shared/types';

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  flooring: 'Flooring',
  tile: 'Tile',
  'wall-finish': 'Wall finishes',
  siding: 'Siding',
  roofing: 'Roofing',
  decking: 'Decking',
  hardscape: 'Hardscape & paving',
  'ground-cover': 'Lawn & ground cover',
  countertop: 'Countertops',
};

/** What one repeating unit of a pattern is called ("Each plank ≈ 7.5 × 72 in"). */
const UNIT_NOUNS: Partial<Record<TexturePattern, string>> = {
  'wood-planks': 'plank',
  herringbone: 'plank',
  chevron: 'plank',
  'tile-grid': 'tile',
  subway: 'tile',
  'hex-tile': 'tile',
  marble: 'tile',
  terrazzo: 'tile',
  brick: 'brick',
  'stone-pavers': 'paver',
  flagstone: 'stone',
  cobblestone: 'cobble',
  'stone-veneer': 'stone',
  gravel: 'stone',
  mulch: 'chip',
  concrete: 'panel',
  'lap-siding': 'board',
  'board-batten': 'board',
  'shingle-siding': 'shingle',
  'roof-shingles': 'shingle',
  'standing-seam': 'panel',
  'deck-boards': 'board',
  shiplap: 'board',
};

export function unitNoun(pattern: TexturePattern): string | null {
  return UNIT_NOUNS[pattern] ?? null;
}

/**
 * Groups materials by category, categories ordered by their first material
 * (so the most typical category for a surface comes first), materials in input order.
 */
export function groupMaterials(materials: readonly MaterialDef[]): { category: MaterialCategory; label: string; materials: MaterialDef[] }[] {
  const groups = new Map<MaterialCategory, MaterialDef[]>();
  for (const m of materials) {
    const g = groups.get(m.category);
    if (g) g.push(m);
    else groups.set(m.category, [m]);
  }
  return [...groups].map(([category, list]) => ({ category, label: MATERIAL_CATEGORY_LABELS[category] ?? category, materials: list }));
}

/** Case-insensitive match on name, description, tags, category and pattern; name-prefix matches first. */
export function searchMaterials(materials: readonly MaterialDef[], query: string): MaterialDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...materials];
  const scored: { m: MaterialDef; score: number; i: number }[] = [];
  materials.forEach((m, i) => {
    const name = m.name.toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 1.5;
    else if (
      m.tags.some((t) => t.toLowerCase().includes(q)) ||
      m.description.toLowerCase().includes(q) ||
      (MATERIAL_CATEGORY_LABELS[m.category] ?? m.category).toLowerCase().includes(q) ||
      m.texture.pattern.replace(/-/g, ' ').includes(q)
    ) {
      score = 1;
    }
    if (score > 0) scored.push({ m, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.m);
}

export const DEFAULT_MATERIAL_ADJUST = { scale: 1, rotation: 0, strength: 1 } as const;

/**
 * Treatment for a newly picked material. Rotation and strength carry over
 * from the current material; scale returns to true size and the tint is
 * dropped (both are specific to the previous material).
 */
export function materialTreatmentFor(material: Pick<MaterialDef, 'id'>, prev: Treatment | undefined): MaterialTreatment {
  const base = prev?.type === 'material' ? prev : undefined;
  return {
    type: 'material',
    materialId: material.id,
    scale: DEFAULT_MATERIAL_ADJUST.scale,
    rotation: base && Number.isFinite(base.rotation) ? base.rotation : DEFAULT_MATERIAL_ADJUST.rotation,
    strength: base && Number.isFinite(base.strength) ? base.strength : DEFAULT_MATERIAL_ADJUST.strength,
  };
}

/** True when scale, rotation, tint and strength are all at their defaults. */
export function isDefaultAdjust(t: MaterialTreatment): boolean {
  return (
    t.scale === DEFAULT_MATERIAL_ADJUST.scale &&
    t.rotation === DEFAULT_MATERIAL_ADJUST.rotation &&
    t.strength === DEFAULT_MATERIAL_ADJUST.strength &&
    !t.tint
  );
}

/** Real size of one pattern unit after the treatment's scale. */
export function scaledUnitSize(material: Pick<MaterialDef, 'texture'>, scale: number): { w: number; h: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { w: material.texture.unitWidthIn * s, h: material.texture.unitHeightIn * s };
}

/** Snap a pattern-size multiplier to 1× when it is within ~4% (the slider's "true size" detent). */
export function snapScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  if (Math.abs(Math.log(scale)) < 0.04) return 1;
  return Math.round(scale * 100) / 100;
}

/** Normalize a rotation to -180..180 degrees. */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return Math.round(d);
}
