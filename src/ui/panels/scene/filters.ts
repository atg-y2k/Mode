/**
 * Library browsing logic: category chips, plant / setting filters and text
 * search. Pure functions — the text search itself is injected (the catalog's
 * `searchAssets`) so the filtering rules can be unit-tested on their own.
 */
import type { AssetCategory, AssetDef, PlantType, SunExposure, WaterNeed } from '../../../../shared/types';

export type LibraryChip = 'plants' | 'fixtures' | 'decor' | 'hardscape' | 'mine';

export interface LibraryChipDef {
  id: LibraryChip;
  label: string;
  /** Categories shown under the chip; undefined = the user's own library (any category). */
  categories?: readonly AssetCategory[];
  /** Noun used in empty states ("No plants match …"). */
  noun: string;
}

export const LIBRARY_CHIPS: readonly LibraryChipDef[] = [
  { id: 'plants', label: 'Plants', categories: ['plant'], noun: 'plants' },
  { id: 'fixtures', label: 'Fixtures', categories: ['lighting'], noun: 'fixtures' },
  { id: 'decor', label: 'Decor & furniture', categories: ['decor', 'furniture', 'other'], noun: 'decor or furniture' },
  { id: 'hardscape', label: 'Hardscape', categories: ['hardscape'], noun: 'hardscape items' },
  { id: 'mine', label: 'My assets', noun: 'saved items' },
];

export function chipDef(id: LibraryChip): LibraryChipDef {
  return LIBRARY_CHIPS.find((c) => c.id === id) ?? LIBRARY_CHIPS[0];
}

/** Indoor / outdoor scope; 'all' disables the setting filter. */
export type SettingScope = 'indoor' | 'outdoor' | 'all';

export interface LibraryFilterState {
  chip: LibraryChip;
  text: string;
  plantType: PlantType | null;
  sun: SunExposure | null;
  water: WaterNeed | null;
  /** Keep only plants hardy in `zone`. */
  fitsZone: boolean;
  /** USDA zone number of the project (from parseZone). */
  zone: number | undefined;
  setting: SettingScope;
}

/** The catalog's text search signature (searchAssets without filters). */
export type TextSearch = (all: readonly AssetDef[], query: string) => AssetDef[];

/** Default chip for a space: plants outdoors, decor & furniture indoors. */
export function defaultChipFor(kind: 'interior' | 'exterior' | undefined): LibraryChip {
  return kind === 'interior' ? 'decor' : 'plants';
}

export function defaultSettingFor(kind: 'interior' | 'exterior' | undefined): SettingScope {
  if (!kind) return 'all';
  return kind === 'interior' ? 'indoor' : 'outdoor';
}

/** Whether the chip offers plant-specific filters / the indoor-outdoor switch. */
export function chipHasPlantFilters(chip: LibraryChip): boolean {
  return chip === 'plants';
}
export function chipHasSettingFilter(chip: LibraryChip): boolean {
  return chip === 'plants' || chip === 'fixtures';
}

/** Does the asset belong in the indoor / outdoor scope? Items without that information always do. */
export function matchesSetting(asset: AssetDef, setting: SettingScope): boolean {
  if (setting === 'all') return true;
  if (asset.plant) return setting === 'indoor' ? asset.plant.indoor : !asset.plant.indoor;
  if (asset.light) return setting === 'indoor' ? asset.light.indoor : asset.light.outdoor;
  return true;
}

/** Plant hardy in `zone`? Houseplants and non-plants always pass. */
export function matchesZone(asset: AssetDef, zone: number | undefined): boolean {
  const p = asset.plant;
  if (!p || zone === undefined || !Number.isFinite(zone)) return true;
  if (p.zoneMin === undefined && p.zoneMax === undefined) return true;
  if (p.zoneMin !== undefined && zone < p.zoneMin) return false;
  if (p.zoneMax !== undefined && zone > p.zoneMax) return false;
  return true;
}

/**
 * Non-text filters. Plant facts (type / sun / water) only keep assets that
 * actually have them, so an uploaded photo without plant info is hidden while
 * such a filter is on.
 */
export function matchesFilters(asset: AssetDef, f: LibraryFilterState): boolean {
  if (chipHasPlantFilters(f.chip)) {
    if (f.plantType && asset.plant?.type !== f.plantType) return false;
    if (f.sun && !asset.plant?.sun.includes(f.sun)) return false;
    if (f.water && asset.plant?.water !== f.water) return false;
    if (f.fitsZone && !matchesZone(asset, f.zone)) return false;
  }
  if (chipHasSettingFilter(f.chip) && !matchesSetting(asset, f.setting)) return false;
  return true;
}

/** Assets the chip covers before filters: built-ins + library by category, or the library alone (newest first). */
export function chipPool(chip: LibraryChip, builtin: readonly AssetDef[], library: readonly AssetDef[]): AssetDef[] {
  const def = chipDef(chip);
  if (!def.categories) return [...library].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const cats = new Set<AssetCategory>(def.categories);
  // The user's own items first within their category, then the catalog.
  const mine = library.filter((a) => cats.has(a.category)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const seen = new Set(mine.map((a) => a.id));
  return [...mine, ...builtin.filter((a) => cats.has(a.category) && !seen.has(a.id))];
}

/** The cards to show for the current chip, filters and search text. */
export function filterLibrary(
  builtin: readonly AssetDef[],
  library: readonly AssetDef[],
  f: LibraryFilterState,
  search: TextSearch,
): AssetDef[] {
  const pool = chipPool(f.chip, builtin, library).filter((a) => matchesFilters(a, f));
  const q = f.text.trim();
  return q ? search(pool, q) : pool;
}

/** How many search hits each chip has (ignores plant filters) — used to point to other chips when one is empty. */
export function countMatchesByChip(
  builtin: readonly AssetDef[],
  library: readonly AssetDef[],
  text: string,
  search: TextSearch,
): Record<LibraryChip, number> {
  const q = text.trim();
  const out = {} as Record<LibraryChip, number>;
  for (const c of LIBRARY_CHIPS) {
    const pool = chipPool(c.id, builtin, library);
    out[c.id] = q ? search(pool, q).length : pool.length;
  }
  return out;
}

/** Number of active plant / setting filters (for the "Clear filters" affordance). */
export function activeFilterCount(f: LibraryFilterState, defaultSetting: SettingScope): number {
  let n = 0;
  if (chipHasPlantFilters(f.chip)) {
    if (f.plantType) n++;
    if (f.sun) n++;
    if (f.water) n++;
    if (f.fitsZone) n++;
  }
  if (chipHasSettingFilter(f.chip) && f.setting !== defaultSetting) n++;
  return n;
}

/** Fixtures for the Lighting panel: catalog + the user's lighting assets, scoped indoor/outdoor. */
export function fixturesFor(
  fixtures: readonly AssetDef[],
  library: readonly AssetDef[],
  setting: SettingScope,
): AssetDef[] {
  const mine = library.filter((a) => a.category === 'lighting');
  const seen = new Set(mine.map((a) => a.id));
  return [...mine, ...fixtures.filter((a) => !seen.has(a.id))].filter((a) => matchesSetting(a, setting));
}
