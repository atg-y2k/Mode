/**
 * Built-in catalog: paint colors, materials (textures), plants, light fixtures
 * and decor — plus lookup and search. Pure data + functions (also imported by
 * the server to give Claude the catalog ids).
 *
 * Data lives in sibling files: paints.ts, materials.ts, plants.ts, fixtures.ts, decor.ts.
 */
import type {
  AssetCategory,
  AssetDef,
  ColorFamily,
  MaterialDef,
  PaintColor,
  PlantType,
  SunExposure,
  SurfaceKind,
  WaterNeed,
} from '../../../shared/types';

export declare const PAINT_COLORS: PaintColor[];
export declare const MATERIALS: MaterialDef[];
export declare const PLANTS: AssetDef[];
export declare const FIXTURES: AssetDef[];
export declare const DECOR: AssetDef[];
/** PLANTS + FIXTURES + DECOR */
export declare const BUILTIN_ASSETS: AssetDef[];

export declare function getPaint(id: string): PaintColor | undefined;
export declare function getMaterial(id: string): MaterialDef | undefined;
export declare function getBuiltinAsset(id: string): AssetDef | undefined;
/** Built-in first, then the user's library. */
export declare function findAsset(id: string, library: readonly AssetDef[]): AssetDef | undefined;

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

/** Case-insensitive match on name, botanical name, tags, subcategory; ranked (name prefix first). */
export declare function searchAssets(all: readonly AssetDef[], query: string, filters?: AssetFilters): AssetDef[];
export declare function searchPaints(query: string, family?: ColorFamily): PaintColor[];
/** Materials offered for a surface, most typical first. */
export declare function materialsForSurface(surface: SurfaceKind): MaterialDef[];
/** Closest catalog paints by ΔE2000. */
export declare function nearestPaints(hex: string, n?: number): { paint: PaintColor; deltaE: number }[];
/** "7a" -> 7, "10b" -> 10, invalid -> undefined. */
export declare function parseZone(zone: string | undefined | null): number | undefined;
/**
 * Compact plain-text listing of material, plant, fixture and decor ids with key
 * attributes, used in Claude prompts so suggestions reference real catalog ids.
 * Stable across calls (prompt caching).
 */
export declare function catalogSummaryForAI(): string;
