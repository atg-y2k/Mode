/**
 * Clean-up of Claude's structured outputs before they reach the app: hex
 * normalization, numeric ranges, catalog-id validation, region-id filtering
 * and de-duplication. Structured outputs guarantee the shape; these guarantee
 * the values make sense.
 */
import type {
  AnalyzeRequest,
  AssetListDraft,
  AssetListRequest,
  AssetListResult,
  DesignSuggestion,
  GenerateAssetRequest,
  GeneratedAssetMeta,
  SpaceAnalysisResult,
  SuggestRequest,
} from '../shared/api';
import { spaceKindOf, type AssetCategory, type PaintFinish, type SurfaceKind } from '../shared/types';

/** Catalog lookups used to validate ids (null = skip validation). */
export interface CatalogIndex {
  isMaterial(id: string): boolean;
  assetCategory(id: string): AssetCategory | undefined;
}

export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  return `#${hex}`;
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function nullableText(value: string | null | undefined): string | null {
  const t = text(value);
  return t ? t : null;
}

function strings(values: readonly string[], max = 20): string[] {
  const out: string[] = [];
  for (const v of values) {
    const t = text(v);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const DEFAULT_FINISH: Partial<Record<SurfaceKind, PaintFinish>> = {
  ceiling: 'flat',
  wall: 'eggshell',
  'accent-wall': 'eggshell',
  trim: 'semi-gloss',
  door: 'semi-gloss',
  'window-frame': 'semi-gloss',
  cabinet: 'semi-gloss',
  stair: 'semi-gloss',
  shutters: 'semi-gloss',
  'front-door': 'semi-gloss',
  'garage-door': 'satin',
  fascia: 'satin',
  siding: 'satin',
  foundation: 'satin',
  fence: 'satin',
  deck: 'satin',
  'retaining-wall': 'satin',
};

export function defaultFinishFor(surface: SurfaceKind | undefined): PaintFinish {
  return (surface && DEFAULT_FINISH[surface]) || 'eggshell';
}

function normPoints(points: readonly { x: number; y: number }[], max: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    out.push({ x: round(clamp(p.x, 0, 1, 0.5), 4), y: round(clamp(p.y, 0, 1, 0.5), 4) });
    if (out.length >= max) break;
  }
  return out;
}

function quantity(n: number): number {
  return round(clamp(n, 0, 100_000, 0), 2);
}

function validAssetId(
  id: string | null,
  catalog: CatalogIndex | null,
  accept: (category: AssetCategory) => boolean,
): string | null {
  const t = nullableText(id);
  if (!t || !catalog) return t;
  const category = catalog.assetCategory(t);
  return category && accept(category) ? t : null;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export function postprocessAnalysis(result: SpaceAnalysisResult, req: AnalyzeRequest): SpaceAnalysisResult {
  // The prompt asks Claude to keep the homeowner's label unless the photo clearly
  // shows another kind of space; fall back to the label if the model returned none.
  const spaceType = result.spaceType || req.spaceType || 'other-interior';
  const exterior = spaceKindOf(spaceType) === 'exterior';
  return {
    spaceType,
    summary: text(result.summary),
    style: text(result.style),
    surfaces: result.surfaces.map((s) => ({
      surface: s.surface,
      description: text(s.description),
      currentColorHex: normalizeHex(s.currentColorHex),
      condition: nullableText(s.condition),
    })),
    lighting: {
      natural: text(result.lighting.natural),
      artificial: text(result.lighting.artificial),
      issues: strings(result.lighting.issues),
    },
    landscaping:
      result.landscaping && exterior
        ? { features: strings(result.landscaping.features), issues: strings(result.landscaping.issues) }
        : null,
    opportunities: strings(result.opportunities, 12),
  };
}

// ---------------------------------------------------------------------------
// Asset list drafts
// ---------------------------------------------------------------------------

function draftKey(name: string, category: string): string {
  return `${category}|${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

export function postprocessDrafts(
  drafts: readonly AssetListDraft[],
  catalog: CatalogIndex | null,
  exclude: ReadonlySet<string> = new Set(),
): AssetListDraft[] {
  const seen = new Set(exclude);
  const out: AssetListDraft[] = [];
  for (const d of drafts) {
    const name = text(d.name);
    if (!name) continue;
    const key = draftKey(name, d.category);
    if (seen.has(key)) continue;
    seen.add(key);
    const unitCost = d.unitCostUsd == null || !Number.isFinite(d.unitCostUsd) || d.unitCostUsd < 0 ? null : round(d.unitCostUsd);
    let refId = nullableText(d.refId);
    if (refId && catalog && !catalog.isMaterial(refId) && !catalog.assetCategory(refId)) refId = null;
    out.push({
      name,
      category: d.category,
      quantity: quantity(d.quantity),
      unit: text(d.unit) || 'each',
      unitCostUsd: unitCost,
      specs: text(d.specs),
      vendor: nullableText(d.vendor),
      notes: text(d.notes),
      hex: normalizeHex(d.hex),
      refId,
      spaceNames: strings(d.spaceNames),
    });
  }
  return out;
}

export function postprocessAssetList(
  result: AssetListResult,
  req: AssetListRequest,
  catalog: CatalogIndex | null,
): AssetListResult {
  const existing = new Set(req.existingItems.map((i) => draftKey(i.name, i.category)));
  return {
    items: postprocessDrafts(result.items, catalog, existing),
    notes: strings(result.notes, 12),
  };
}

// ---------------------------------------------------------------------------
// Design suggestion
// ---------------------------------------------------------------------------

export function postprocessSuggestion(
  s: DesignSuggestion,
  req: SuggestRequest,
  catalog: CatalogIndex | null,
): DesignSuggestion {
  const regionSurface = new Map(req.regions.map((r) => [r.id, r.surface]));
  const treated = new Set<string>();
  const regionTreatments: DesignSuggestion['regionTreatments'] = [];
  for (const t of s.regionTreatments) {
    if (!regionSurface.has(t.regionId) || treated.has(t.regionId)) continue;
    treated.add(t.regionId);
    const reason = text(t.reason);
    const none = {
      regionId: t.regionId,
      kind: 'none' as const,
      hex: null,
      colorName: null,
      finish: null,
      materialId: null,
      reason,
    };
    if (t.kind === 'paint') {
      const hex = normalizeHex(t.hex);
      regionTreatments.push(
        hex
          ? {
              ...none,
              kind: 'paint',
              hex,
              colorName: nullableText(t.colorName),
              finish: t.finish ?? defaultFinishFor(regionSurface.get(t.regionId)),
            }
          : none,
      );
    } else if (t.kind === 'material') {
      const materialId = nullableText(t.materialId);
      const valid = materialId != null && (!catalog || catalog.isMaterial(materialId));
      regionTreatments.push(valid ? { ...none, kind: 'material', materialId } : none);
    } else {
      regionTreatments.push(none);
    }
  }

  const palette = s.palette.flatMap((p) => {
    const hex = normalizeHex(p.hex);
    return hex
      ? [{ role: text(p.role), name: text(p.name) || hex, hex, finish: p.finish, brandMatch: nullableText(p.brandMatch) }]
      : [];
  });

  const low = clamp(s.estimatedBudget.lowUsd, 0, 10_000_000, 0);
  const high = clamp(s.estimatedBudget.highUsd, 0, 10_000_000, 0);

  return {
    title: text(s.title) || 'Design option',
    concept: text(s.concept),
    palette,
    regionTreatments,
    lighting: {
      timeOfDay: s.lighting.timeOfDay,
      kelvin: Math.round(clamp(s.lighting.kelvin, 2200, 6500, 5500)),
      fixtures: s.lighting.fixtures.map((f) => ({
        assetId: validAssetId(f.assetId, catalog, (c) => c === 'lighting'),
        name: text(f.name) || 'Light fixture',
        quantity: Math.round(quantity(f.quantity)),
        kelvin: Math.round(clamp(f.kelvin, 1800, 6500, 2700)),
        placement: text(f.placement),
        positions: normPoints(f.positions, 40),
      })),
    },
    plants: s.plants.map((p) => ({
      assetId: validAssetId(p.assetId, catalog, (c) => c === 'plant'),
      name: text(p.name) || 'Plant',
      botanical: nullableText(p.botanical),
      quantity: Math.round(quantity(p.quantity)),
      placement: text(p.placement),
      why: text(p.why),
      positions: normPoints(p.positions, 40),
    })),
    decor: s.decor.map((d) => ({
      assetId: validAssetId(d.assetId, catalog, () => true),
      name: text(d.name) || 'Decor',
      quantity: Math.round(quantity(d.quantity)),
      placement: text(d.placement),
      positions: normPoints(d.positions, 40),
    })),
    assetList: postprocessDrafts(s.assetList, catalog),
    tips: strings(s.tips, 10),
    estimatedBudget: { lowUsd: Math.round(Math.min(low, high)), highUsd: Math.round(Math.max(low, high)) },
  };
}

// ---------------------------------------------------------------------------
// Generated asset metadata
// ---------------------------------------------------------------------------

const MIN_HEIGHT_FT = 0.1;
const MAX_HEIGHT_FT = 150;
const FALLBACK_HEIGHT_FT: Record<AssetCategory, number> = {
  plant: 3,
  lighting: 1.5,
  decor: 2,
  furniture: 3,
  hardscape: 2,
  other: 2,
};

export function postprocessAssetMeta(meta: GeneratedAssetMeta, req: GenerateAssetRequest): GeneratedAssetMeta {
  const name = text(meta.name) || text(req.description).slice(0, 48) || 'New asset';
  const height = Number.isFinite(meta.realHeightFt) && meta.realHeightFt >= MIN_HEIGHT_FT
    ? Math.min(MAX_HEIGHT_FT, round(meta.realHeightFt))
    : FALLBACK_HEIGHT_FT[req.category];
  const cost = (v: number | null) => (v == null || !Number.isFinite(v) || v < 0 ? null : round(v));
  let low = cost(meta.costLowUsd);
  let high = cost(meta.costHighUsd);
  if (low != null && high != null && low > high) [low, high] = [high, low];
  if (low == null && high != null) low = high;
  if (high == null && low != null) high = low;
  return {
    name,
    // The user picked the category; keep it even if the model disagrees.
    category: req.category,
    subcategory: nullableText(meta.subcategory)?.toLowerCase() ?? null,
    description: text(meta.description) || text(req.description),
    realHeightFt: height,
    tags: strings(meta.tags.map((t) => t.toLowerCase()), 10),
    costLowUsd: low,
    costHighUsd: high,
  };
}
