/** Quantity estimators used to turn a design into a shopping list. */
import type { MaterialDef } from '../../shared/types';

/** Typical coverage of one gallon of wall paint per coat. */
export declare const PAINT_COVERAGE_SQFT_PER_GAL: number;

/**
 * Paint to buy for `areaSqFt` × `coats`, rounded up to whole gallons plus at
 * most 3 quarts (e.g. 1.6 gal -> { gallons: 1, quarts: 3 }; 0.2 gal -> { gallons: 0, quarts: 1 }).
 * Uses 5-gallon buckets when ≥ 5 gal is needed (label only).
 */
export declare function paintToBuy(
  areaSqFt: number,
  coats: number,
): { gallonsNeeded: number; gallons: number; quarts: number; label: string };

/** Primer recommended when going much lighter over dark, or for big hue changes (ΔE > 40) on dark bases. */
export declare function needsPrimer(fromHex: string | null, toHex: string): boolean;

/** Purchase quantity for a material (adds waste: 10% straight lay, 15% herringbone/chevron/flagstone). */
export declare function materialToBuy(
  material: MaterialDef,
  areaSqFt: number,
): { quantity: number; unit: string; wastePct: number };

export declare function mulchCubicYards(areaSqFt: number, depthIn?: number): number;
export declare function gravelTons(areaSqFt: number, depthIn?: number): number;
/** Number of plants to fill an area at mature width spacing (min 1). */
export declare function plantsToFill(areaSqFt: number, matureWidthFt: number): number;
