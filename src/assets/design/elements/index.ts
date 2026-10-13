/**
 * The built-in design elements (one per ElementType, in ELEMENT_TYPES order)
 * and the plant lists behind plant options.
 */
import { ELEMENT_TYPES, type ElementDef, type ElementType } from '../../../../shared/types';
import { buildElements, optionKey, type ElementInput, type OptionPlants } from './build';
import { FENCE, EXTERIOR_PAINT, FRONT_DOOR, GARAGE_DOOR, PORCH, ROOF, WINDOWS_SHUTTERS } from './architecture';
import { BORDER_EDGING, DRIVEWAY, PATHWAY, PATIO, RETAINING_WALL, STEPS } from './hardscape';
import { CUSTOM, DECOR, FURNITURE, INTERIOR_LIGHTING, WINDOW_TREATMENTS } from './interior-furnishing';
import { BACKSPLASH, CABINETS, CEILING, COUNTERTOPS, FIREPLACE, FLOORING, WALL_PAINT } from './interior-surfaces';
import { OUTDOOR_FURNITURE, OUTDOOR_LIGHTING, WATER_FEATURE } from './outdoor-living';
import { LAWN, PLANTING_BED, TREES_SHRUBS } from './planting';

const INPUTS: Record<ElementType, ElementInput> = {
  pathway: PATHWAY,
  'border-edging': BORDER_EDGING,
  'planting-bed': PLANTING_BED,
  lawn: LAWN,
  'trees-shrubs': TREES_SHRUBS,
  patio: PATIO,
  driveway: DRIVEWAY,
  steps: STEPS,
  fence: FENCE,
  'retaining-wall': RETAINING_WALL,
  'water-feature': WATER_FEATURE,
  'outdoor-lighting': OUTDOOR_LIGHTING,
  'front-door': FRONT_DOOR,
  'exterior-paint': EXTERIOR_PAINT,
  roof: ROOF,
  porch: PORCH,
  'garage-door': GARAGE_DOOR,
  'windows-shutters': WINDOWS_SHUTTERS,
  'outdoor-furniture': OUTDOOR_FURNITURE,
  'wall-paint': WALL_PAINT,
  flooring: FLOORING,
  ceiling: CEILING,
  'interior-lighting': INTERIOR_LIGHTING,
  cabinets: CABINETS,
  countertops: COUNTERTOPS,
  backsplash: BACKSPLASH,
  furniture: FURNITURE,
  'window-treatments': WINDOW_TREATMENTS,
  decor: DECOR,
  fireplace: FIREPLACE,
  custom: CUSTOM,
};

const built = buildElements(ELEMENT_TYPES.map((t) => INPUTS[t]));

/** One ElementDef per ElementType (including 'custom'), in ELEMENT_TYPES order. */
export const ELEMENT_DEFS: ElementDef[] = built.defs;

/** Plants implied by built-in options, keyed by optionKey(type, dimensionId, optionId). */
const OPTION_PLANTS: ReadonlyMap<string, OptionPlants> = built.optionPlants;

export function optionPlants(type: ElementType, dimensionId: string, optionId: string): OptionPlants | undefined {
  return OPTION_PLANTS.get(optionKey(type, dimensionId, optionId));
}

/** Every option key that carries plants (for tests and diagnostics). */
export function plantOptionKeys(): string[] {
  return [...OPTION_PLANTS.keys()];
}

/**
 * Order of the element palette, most commonly wanted first. Exterior follows
 * the curb-appeal priorities (approach, planting, entry, color), interior the
 * biggest-impact surfaces first.
 */
export const ELEMENT_RELEVANCE: Record<'exterior' | 'interior', ElementType[]> = {
  exterior: [
    'pathway',
    'planting-bed',
    'border-edging',
    'lawn',
    'trees-shrubs',
    'front-door',
    'exterior-paint',
    'outdoor-lighting',
    'steps',
    'porch',
    'patio',
    'driveway',
    'fence',
    'windows-shutters',
    'garage-door',
    'roof',
    'retaining-wall',
    'water-feature',
    'outdoor-furniture',
  ],
  interior: [
    'wall-paint',
    'flooring',
    'interior-lighting',
    'furniture',
    'cabinets',
    'countertops',
    'backsplash',
    'window-treatments',
    'decor',
    'fireplace',
    'ceiling',
  ],
};

export type { OptionPlants } from './build';
