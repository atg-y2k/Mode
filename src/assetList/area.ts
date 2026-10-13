/** Real-world measurement helpers built on photo calibration and region planes. */
import type { AssetDef, Calibration, Photo, Region } from '../../shared/types';
import type { Mask } from '../engine/types';

/** Photo pixels per real foot from a calibration line, or null. */
export declare function pxPerFoot(cal: Calibration | undefined): number | null;

export type AreaMethod = 'override' | 'plane' | 'calibration' | 'none';

/**
 * Estimated area of a region in sq ft:
 * override → plane (mask coverage inside the quad × real quad area) →
 * calibration (coverage / pxPerFoot², a flat-on approximation) → none (null).
 */
export declare function regionAreaSqFt(
  region: Region,
  mask: Mask | undefined,
  photo: Pick<Photo, 'width' | 'height' | 'calibration'>,
): { sqft: number | null; method: AreaMethod };

/**
 * Default on-photo height (px) for a newly placed asset: realHeightFt × pxPerFoot
 * when calibrated, else a fraction of the photo height by category
 * (trees ~45%, shrubs ~18%, perennials ~10%, fixtures ~8%, decor ~15%).
 */
export declare function defaultObjectHeightPx(
  asset: AssetDef,
  photo: Pick<Photo, 'width' | 'height' | 'calibration'>,
): number;
