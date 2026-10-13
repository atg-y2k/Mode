/**
 * Plant growth stages (borrowed from iScape / PRO Landscape's growth slider):
 * the brief's plantMaturity as three stops — as planted, ~3 years, mature —
 * plus rough plant heights at each stage from the built-in plant profiles,
 * so the slider shows what "as planted" actually means for the chosen plants
 * ("Boxwood: 1 ft → 2½ ft → 4 ft"). Pure; unit-tested.
 *
 * Heights are nursery rules of thumb, not a growth model: perennials and
 * grasses fill out in 2–3 years ("sleep, creep, leap"), shrubs reach about
 * 60% of mature height by year 3, trees go in at 6–8 ft and grow ~1½ ft a
 * year. Mature sizes are the profiles' (~10 years for shrubs and trees).
 */
import type { DesignBrief, ElementDimension, ElementSpec, PlantType } from '../../../../shared/types';
import { getPlantProfile, type PlantProfile } from '../../../assets/design';
import { optionPlants } from '../../../assets/design/elements';

export type Maturity = DesignBrief['plantMaturity'];

export interface GrowthStop {
  value: Maturity;
  /** Slider label. */
  label: string;
  /** What the image shows at this stop. */
  hint: string;
}

export const GROWTH_STOPS: readonly GrowthStop[] = [
  { value: 'new', label: 'As planted', hint: 'Nursery sizes as installed — young plants with mulch between them.' },
  { value: 'established', label: '~3 years', hint: 'About three years in — filled out, not yet full size.' },
  { value: 'mature', label: 'Mature', hint: 'Full grown — check the plants still fit the space and stay below the windows.' },
];

export function growthIndex(m: Maturity | undefined): number {
  const i = GROWTH_STOPS.findIndex((s) => s.value === m);
  return i < 0 ? 1 : i;
}

export function growthAt(index: number): Maturity {
  return GROWTH_STOPS[Math.min(GROWTH_STOPS.length - 1, Math.max(0, Math.round(index)))].value;
}

/** Types that fill out within ~3 years. */
const FAST: readonly PlantType[] = ['perennial', 'annual', 'grass', 'groundcover', 'fern', 'succulent', 'vine'];

/** Rough height (ft) of a plant at a growth stage. */
export function heightAt(p: Pick<PlantProfile, 'type' | 'matureHeightFt'>, stage: Maturity): number {
  const mature = Math.max(0, p.matureHeightFt);
  if (stage === 'mature' || mature === 0) return mature;
  if (p.type === 'tree') {
    const planted = Math.min(mature, Math.max(4, Math.min(8, mature * 0.3)));
    return stage === 'new' ? planted : Math.min(mature, planted + 3 * 1.5);
  }
  if (FAST.includes(p.type)) {
    // 1-gal perennials go in at about a third of their size and fill out by year 3.
    return stage === 'new' ? Math.max(0.3, Math.min(mature, mature * 0.35)) : mature;
  }
  // Shrubs & hedges: 3-gal (~1–2 ft) at planting, ~60% by year 3.
  const planted = Math.min(mature, Math.max(0.75, Math.min(2, mature * 0.3)));
  return stage === 'new' ? planted : Math.max(planted, mature * 0.6);
}

/** 0.4 → "5 in", 1 → "1 ft", 2.5 → "2½ ft", 12.3 → "12 ft". */
export function formatHeight(ft: number): string {
  if (!(ft > 0)) return '—';
  if (ft < 1) return `${Math.max(1, Math.round((ft * 12) / 2) * 2)} in`;
  if (ft >= 6) return `${Math.round(ft)} ft`;
  const halves = Math.round(ft * 2) / 2;
  const whole = Math.floor(halves);
  return `${whole}${halves - whole ? '½' : ''} ft`;
}

export interface GrowthExample {
  name: string;
  /** Heights at each GROWTH_STOPS stop, in ft. */
  heights: number[];
}

/** The plant's everyday name: "Boxwood 'Green Velvet'" → "Boxwood", "Panicle hydrangea 'Little Lime'" → "Panicle hydrangea". */
function commonName(name: string): string {
  return name.replace(/\s*['‘’"].*$/, '').replace(/\s*\(.*$/, '').trim() || name;
}

/**
 * Up to `max` plants of the element's chosen plant options (distinct, tallest
 * first — the ones whose size matters most), with their heights per stage.
 * Lawn grasses are skipped (mowed).
 */
export function growthExamples(el: Pick<ElementSpec, 'type' | 'choices'>, dims: readonly Pick<ElementDimension, 'id'>[], max = 2): GrowthExample[] {
  const profiles = new Map<string, PlantProfile>();
  for (const d of dims) {
    for (const optionId of el.choices[d.id] ?? []) {
      const entry = optionPlants(el.type, d.id, optionId);
      for (const id of entry?.plants ?? []) {
        const p = getPlantProfile(id);
        if (p && p.matureHeightFt > 0 && p.matureWidthFt > 0) profiles.set(p.id, p);
      }
    }
  }
  return [...profiles.values()]
    .sort((a, b) => b.matureHeightFt - a.matureHeightFt)
    .slice(0, max)
    .map((p) => ({ name: commonName(p.name), heights: GROWTH_STOPS.map((s) => heightAt(p, s.value)) }));
}
