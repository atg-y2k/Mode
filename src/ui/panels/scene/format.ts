/**
 * Pure formatting helpers and labels for the Lighting and Library panels
 * (costs, color temperatures, plant facts, light beams). No DOM, no store.
 */
import type {
  AssetCategory,
  AssetDef,
  CostEstimate,
  CostUnit,
  LightBeam,
  PlantInfo,
  PlantType,
  SunExposure,
  TimeOfDay,
  WaterNeed,
} from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const COST_UNIT_LABELS: Record<CostUnit, string> = {
  each: 'each',
  gal: 'gal',
  sqft: 'sq ft',
  lnft: 'lin ft',
  cuyd: 'cu yd',
  ton: 'ton',
  bag: 'bag',
  flat: 'flat',
  hour: 'hr',
};

/** Short USD for cards: 4.5 → "$4.50", 12 → "$12", 24.98 → "$25", 1450 → "$1,450". */
export function compactUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const v = Math.max(0, value);
  if (v >= 10 || Number.isInteger(v)) return `$${Math.round(v).toLocaleString('en-US')}`;
  return `$${v.toFixed(2)}`;
}

/**
 * "$12–$25", "$40", "$3–$5 / sq ft". Null when there is no usable price
 * (missing, non-finite or zero).
 */
export function formatCostRange(cost: CostEstimate | undefined | null): string | null {
  if (!cost) return null;
  const vals = [cost.low, cost.high].filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const range = compactUsd(lo) === compactUsd(hi) ? compactUsd(lo) : `${compactUsd(lo)}–${compactUsd(hi)}`;
  return cost.unit === 'each' ? range : `${range} / ${COST_UNIT_LABELS[cost.unit] ?? cost.unit}`;
}

// ---------------------------------------------------------------------------
// Color temperature
// ---------------------------------------------------------------------------

/** "2700 K" (rounded to 10 K). */
export function formatKelvin(kelvin: number): string {
  if (!Number.isFinite(kelvin)) return '— K';
  return `${Math.round(kelvin / 10) * 10} K`;
}

/** Plain-language name of a lamp's color temperature. */
export function lampColorName(kelvin: number): string {
  if (kelvin < 2400) return 'Candlelight';
  if (kelvin < 2850) return 'Warm white';
  if (kelvin < 3500) return 'Soft white';
  if (kelvin < 4500) return 'Neutral white';
  if (kelvin < 5800) return 'Daylight';
  return 'Cool daylight';
}

/** Plain-language name of the ambient white balance (5500 K = neutral). */
export function whiteBalanceName(kelvin: number): string {
  if (kelvin < 3600) return 'Very warm';
  if (kelvin < 4900) return 'Warm';
  if (kelvin <= 6200) return 'Neutral';
  if (kelvin <= 7600) return 'Cool';
  return 'Very cool';
}

/** Lamp color presets offered for placed lights. */
export const KELVIN_PRESETS: readonly { kelvin: number; label: string }[] = [
  { kelvin: 2200, label: 'Candle' },
  { kelvin: 2700, label: 'Warm' },
  { kelvin: 3000, label: 'Soft' },
  { kelvin: 4000, label: 'Neutral' },
  { kelvin: 5000, label: 'Daylight' },
];

// ---------------------------------------------------------------------------
// Lighting scene
// ---------------------------------------------------------------------------

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  day: 'Day',
  golden: 'Golden',
  dusk: 'Dusk',
  night: 'Night',
};

export const TIME_OF_DAY_HINTS: Record<TimeOfDay, string> = {
  day: 'Daylight as photographed',
  golden: 'Warm, low evening sun',
  dusk: 'Blue hour — lights start to glow',
  night: 'After dark — lights take over',
};

/** "+0.5 EV", "0 EV", "−1.2 EV". */
export function formatEv(value: number): string {
  const v = Math.round(value * 10) / 10;
  if (v === 0) return '0 EV';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} EV`;
}

/** -1..1 slider → "+20", "0", "−35". */
export function formatSigned100(value: number): string {
  const v = Math.round(value * 100);
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${Math.abs(v)}`;
}

/** 0..1 → "75%"; 0..2 intensity → "150%". */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export const BEAM_LABELS: Record<LightBeam, string> = {
  omni: 'Glow',
  down: 'Downlight',
  up: 'Uplight',
  spot: 'Spotlight',
  strip: 'Strip',
  string: 'String',
};

export const BEAM_HINTS: Record<LightBeam, string> = {
  omni: 'Round glow in every direction',
  down: 'Wash of light below the fixture',
  up: 'Cone of light above — trees, walls, columns',
  spot: 'Aimed cone you can rotate',
  strip: 'Even line of light — under cabinets, coves, steps',
  string: 'Bulbs hanging between two points',
};

// ---------------------------------------------------------------------------
// Assets & plants
// ---------------------------------------------------------------------------

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  plant: 'Plant',
  lighting: 'Light fixture',
  decor: 'Decor',
  furniture: 'Furniture',
  hardscape: 'Hardscape',
  other: 'Other',
};

export const PLANT_TYPE_LABELS: Record<PlantType, string> = {
  tree: 'Tree',
  shrub: 'Shrub',
  perennial: 'Perennial',
  annual: 'Annual',
  grass: 'Grass',
  groundcover: 'Groundcover',
  succulent: 'Succulent',
  vine: 'Vine',
  fern: 'Fern',
  houseplant: 'Houseplant',
  hedge: 'Hedge',
};

export const SUN_LABELS: Record<SunExposure, string> = {
  'full-sun': 'Full sun',
  'part-sun': 'Part sun',
  shade: 'Shade',
};

export const WATER_LABELS: Record<WaterNeed, string> = {
  low: 'Low water',
  medium: 'Moderate water',
  high: 'High water',
};

/** Number of drops to draw for a water need. */
export const WATER_DROPS: Record<WaterNeed, number> = { low: 1, medium: 2, high: 3 };

/** "Z5–9", "Z7+", "Z–8"; null when the plant has no zone range (houseplants). */
export function zoneShortLabel(plant: PlantInfo | undefined): string | null {
  if (!plant) return null;
  const { zoneMin: lo, zoneMax: hi } = plant;
  if (lo === undefined && hi === undefined) return null;
  if (lo !== undefined && hi !== undefined) return lo === hi ? `Z${lo}` : `Z${lo}–${hi}`;
  return lo !== undefined ? `Z${lo}+` : `Z–${hi}`;
}

export type ZoneFit = 'fits' | 'outside' | 'unknown';

/** Whether a plant is hardy in the given USDA zone number. */
export function zoneFit(plant: PlantInfo | undefined, zone: number | undefined): ZoneFit {
  if (!plant || zone === undefined || !Number.isFinite(zone)) return 'unknown';
  if (plant.zoneMin === undefined && plant.zoneMax === undefined) return 'unknown';
  if (plant.zoneMin !== undefined && zone < plant.zoneMin) return 'outside';
  if (plant.zoneMax !== undefined && zone > plant.zoneMax) return 'outside';
  return 'fits';
}

/** Feet with sensible precision: 0.5 → "6 in", 2.25 → "2.3 ft", 14 → "14 ft". */
export function formatFeetShort(ft: number): string {
  if (!Number.isFinite(ft) || ft <= 0) return '—';
  if (ft < 1) return `${Math.max(1, Math.round(ft * 12))} in`;
  if (ft < 10) return `${Number(ft.toFixed(1))} ft`;
  return `${Math.round(ft)} ft`;
}

/** "3–4 ft tall × 3 ft wide" style mature size line. */
export function matureSizeLabel(plant: PlantInfo): string {
  return `${formatFeetShort(plant.matureHeightFt)} tall × ${formatFeetShort(plant.matureWidthFt)} wide`;
}

/** Short subtitle used under an asset's name (botanical name, else category/subcategory). */
export function assetSubtitle(asset: AssetDef): string {
  if (asset.plant?.botanical) return asset.plant.botanical;
  if (asset.subcategory) return asset.subcategory.replace(/[-_]+/g, ' ');
  return ASSET_CATEGORY_LABELS[asset.category] ?? 'Item';
}

/** True when the asset is drawn from vector data (built-in art or AI SVG), so it can be tinted. */
export function isVectorAsset(asset: AssetDef | undefined): boolean {
  return !!asset && (!!asset.art || !!asset.svg);
}

/** True for anything that can be shown on the photo. */
export function hasVisual(asset: AssetDef | undefined): boolean {
  return !!asset && (!!asset.art || !!asset.svg || !!asset.imageId);
}

/** Pixels → "4.2 ft" when calibrated, else "220 px". */
export function formatSize(px: number, pxPerFoot: number | null): string {
  if (pxPerFoot && pxPerFoot > 0) return formatFeetShort(px / pxPerFoot);
  return `${Math.round(px)} px`;
}

/** Degrees → "−35°". */
export function formatDegrees(value: number): string {
  const v = Math.round(value);
  return `${v < 0 ? '−' : ''}${Math.abs(v)}°`;
}
